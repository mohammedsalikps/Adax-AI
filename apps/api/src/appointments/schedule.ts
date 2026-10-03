import { APPOINTMENT_POLICY } from '@adaxai/contracts'
import { eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { facilities } from '../db/schema.ts'
import { badRequest, notFound } from '../http/errors.ts'

/**
 * Appointment times. A booking is an instant; the facility's timezone gives
 * its calendar day and clock time. The conversions run in PostgreSQL (the
 * same timezone database that decides "today" for the queue), and a clock
 * time that does not exist there is refused, never silently moved.
 */

/** Calendar arithmetic on YYYY-MM-DD, independent of any timezone. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export interface FacilityClock {
  timezone: string
  /** The facility's current calendar day. */
  today: string
}

export async function facilityClock(db: DbOrTx, facilityId: string): Promise<FacilityClock> {
  const [row] = await db
    .select({ timezone: facilities.timezone, today: sql<string>`(now() at time zone ${facilities.timezone})::date::text` })
    .from(facilities)
    .where(eq(facilities.id, facilityId))
  if (!row) throw notFound('Facility')
  return row
}

/**
 * The instant of a local day and clock time. `exists` is false when that
 * clock time is skipped on that day (a daylight-saving gap): PostgreSQL then
 * answers with the instant after the gap, which would read back as a
 * different clock time. A repeated time (the clocks go back) resolves to
 * PostgreSQL's choice, the later occurrence (standard time); a test pins it.
 */
export async function localInstant(db: DbOrTx, timezone: string, date: string, time: string): Promise<{ instant: Date; exists: boolean }> {
  const result = await db.execute(sql`
    select
      ((${date}::date + ${time}::time)::timestamp at time zone ${timezone}) as instant,
      (((${date}::date + ${time}::time)::timestamp at time zone ${timezone}) at time zone ${timezone}) = (${date}::date + ${time}::time)::timestamp as exact`)
  const row = result.rows[0] as { instant: Date; exact: boolean }
  return { instant: new Date(row.instant), exists: row.exact }
}

/**
 * Checks a requested local day and time for a new booking and returns its
 * instant. Problems come back as field issues for the form.
 */
export async function resolveSlot(db: DbOrTx, clock: FacilityClock, date: string, time: string, now: Date = new Date()): Promise<Date> {
  const minutes = Number(time.slice(3, 5))
  if (minutes % APPOINTMENT_POLICY.slotMinutes !== 0) {
    throw badRequest('Some fields are invalid', [{ path: 'time', message: `Start times are on every ${APPOINTMENT_POLICY.slotMinutes} minutes, e.g. 09:00, 09:05` }])
  }
  if (date > addDays(clock.today, APPOINTMENT_POLICY.maxDaysAhead)) {
    throw badRequest('Some fields are invalid', [{ path: 'date', message: `Appointments can be booked up to ${APPOINTMENT_POLICY.maxDaysAhead} days ahead` }])
  }
  const { instant, exists } = await localInstant(db, clock.timezone, date, time)
  if (!exists) {
    throw badRequest('Some fields are invalid', [{ path: 'time', message: `${time} does not exist on ${date} at the clinic (the clocks change). Choose another time.` }])
  }
  if (instant.getTime() <= now.getTime()) {
    throw badRequest('Some fields are invalid', [{ path: 'date', message: 'Choose a time that has not passed yet' }])
  }
  return instant
}
