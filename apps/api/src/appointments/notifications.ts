import { type AppointmentStatus, notificationIsCurrent, type NotificationKind, type NotificationPayload, type StaffNotification } from '@adaxai/contracts'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { consentState } from '../consents/service.ts'
import type { Db, DbOrTx } from '../db/client.ts'
import { appointments, notificationAttempts, notifications, users } from '../db/schema.ts'

/**
 * Notification outbox. A message is queued in the same transaction as the
 * change that causes it (one row per appointment and event: a retried request
 * cannot queue it twice), then handed to a delivery channel. The only channel
 * that exists is the patient portal ("in_app"): delivered means the message is
 * available there. No SMS, email or push provider is configured, so none is
 * used or claimed. Every attempt and its outcome is recorded; a message that
 * could not be delivered can be retried without ever being delivered twice.
 */

export type NotificationRow = typeof notifications.$inferSelect

export type DeliveryResult = { status: 'delivered' } | { status: 'undeliverable' | 'failed'; code: string }

/** A way of delivering a message. Tests supply their own to simulate failures. */
export interface NotificationChannel {
  readonly name: 'in_app'
  deliver(db: DbOrTx, n: NotificationRow): Promise<DeliveryResult>
}

/**
 * The patient portal: the message is delivered when the patient has an active
 * portal account and their portal consent is still in force (withdrawing it
 * switches the account off as well; this is the second check). Otherwise it
 * is recorded as undeliverable with the reason, and can be retried later.
 */
export const inAppChannel: NotificationChannel = {
  name: 'in_app',
  async deliver(db, n) {
    const [account] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.patientId, n.patientId), eq(users.role, 'patient'), eq(users.isActive, true)))
      .limit(1)
    if (!account) return { status: 'undeliverable', code: 'no_active_portal_account' }
    const { state } = await consentState(db, n.patientId, 'portal_access')
    if (state !== 'granted' && state !== 'outdated') return { status: 'undeliverable', code: state === 'withdrawn' ? 'portal_consent_withdrawn' : 'portal_consent_not_recorded' }
    return { status: 'delivered' }
  },
}

export interface NewNotification {
  facilityId: string
  patientId: string
  appointmentId: string
  kind: NotificationKind
  payload: NotificationPayload
}

/** Queues a message once per (appointment, event). Returns its id, or null if it was already queued. */
export async function enqueueNotification(tx: DbOrTx, n: NewNotification): Promise<string | null> {
  const [row] = await tx
    .insert(notifications)
    .values({ facilityId: n.facilityId, patientId: n.patientId, appointmentId: n.appointmentId, kind: n.kind, channel: 'in_app', dedupKey: `${n.appointmentId}:${n.kind}`, payload: n.payload })
    .onConflictDoNothing({ target: notifications.dedupKey })
    .returning({ id: notifications.id })
  return row?.id ?? null
}

const RETRYABLE = ['queued', 'undeliverable', 'failed']

export interface Dispatched {
  id: string
  status: NotificationRow['status']
  code: string | null
}

/**
 * One delivery attempt for one message, made exclusively: the row is locked for
 * the whole attempt (claim, channel call, outcome and attempt record in one
 * transaction), and a request that finds it locked skips it. So two requests
 * retrying together, or a retry racing the first automatic attempt, make one
 * attempt between them; a delivered message is never attempted again; and an
 * attempt that dies half-way leaves no trace, so the count and the attempt log
 * always agree. A channel that throws is recorded as a failed attempt, not as
 * an error of the request that asked for it. The channel runs on the same
 * connection, in a savepoint (so a database error inside it is rolled back to
 * the savepoint and cannot poison the attempt's own transaction, and no second
 * connection is needed while the row is locked).
 *
 * Whether the message still holds (see notificationIsCurrent) is decided under
 * the locks: the message row is locked for update, and the appointment row is
 * share-locked and its status read after that, so a change of the appointment
 * (a cancel or a move) either committed before the check, and the message is
 * not delivered, or waits until this attempt has committed. Returns null when
 * nothing was attempted.
 *
 * The lock is held while the channel runs. The portal channel is a few indexed
 * reads; a channel that calls out over the network must bound its own time.
 */
export async function dispatchNotification(db: Db, channel: NotificationChannel, id: string, actorId: string | null): Promise<Dispatched | null> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ n: notifications, appointmentStatus: appointments.status })
      .from(notifications)
      .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
      .where(eq(notifications.id, id))
      .for('update', { of: notifications, skipLocked: true })
    if (!found || !RETRYABLE.includes(found.n.status) || !notificationIsCurrent(found.n.kind, found.appointmentStatus)) return null
    const appointmentId = found.n.appointmentId
    if (!appointmentId) return null
    const [live] = await tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, appointmentId)).for('share')
    if (!live || !notificationIsCurrent(found.n.kind, live.status)) return null
    const current = found.n
    const attemptNo = current.attempts + 1
    let result: DeliveryResult
    try {
      result = await tx.transaction((savepoint) => channel.deliver(savepoint, current))
    } catch {
      // The error text is not kept: it could echo message content.
      result = { status: 'failed', code: 'delivery_error' }
    }
    const code = result.status === 'delivered' ? null : result.code
    await tx
      .update(notifications)
      .set({ status: result.status, failureCode: code, deliveredAt: result.status === 'delivered' ? sql`now()` : null, attempts: attemptNo, lastAttemptAt: sql`now()` })
      .where(eq(notifications.id, id))
    await tx.insert(notificationAttempts).values({ notificationId: id, attemptNo, outcome: result.status, code, actorUserId: actorId })
    return { id, status: result.status, code }
  })
}

export interface DispatchSummary {
  attempted: number
  delivered: number
  undeliverable: number
  failed: number
}

/**
 * Tries each message. One message's infrastructure failure (no connection, a failed record) does not stop the others and is
 * reported through `onError` (callers log its code: it is not a delivery outcome, and nothing was recorded for it).
 */
export async function dispatchAll(db: Db, channel: NotificationChannel, ids: string[], actorId: string | null, onError?: (e: unknown) => void): Promise<DispatchSummary> {
  const out: DispatchSummary = { attempted: 0, delivered: 0, undeliverable: 0, failed: 0 }
  for (const id of ids) {
    const r = await dispatchNotification(db, channel, id, actorId).catch((e: unknown): Dispatched => {
      onError?.(e)
      return { id, status: 'failed', code: 'delivery_error' }
    })
    if (!r) continue
    out.attempted++
    if (r.status === 'delivered') out.delivered++
    else if (r.status === 'undeliverable') out.undeliverable++
    else if (r.status === 'failed') out.failed++
  }
  return out
}

/** The messages of one appointment that have not been delivered yet and are still true of it. */
export async function undeliveredFor(db: DbOrTx, appointmentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: notifications.id, kind: notifications.kind, appointmentStatus: appointments.status })
    .from(notifications)
    .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
    .where(and(eq(notifications.appointmentId, appointmentId), inArray(notifications.status, RETRYABLE)))
    .orderBy(asc(notifications.createdAt))
  return rows.filter((r) => notificationIsCurrent(r.kind, r.appointmentStatus)).map((r) => r.id)
}

export function toStaffNotification(n: NotificationRow, appointmentStatus: AppointmentStatus): StaffNotification {
  return {
    id: n.id,
    kind: n.kind,
    current: notificationIsCurrent(n.kind, appointmentStatus),
    status: n.status as StaffNotification['status'],
    failureCode: n.failureCode,
    attempts: n.attempts,
    lastAttemptAt: n.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: n.deliveredAt?.toISOString() ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }
}
