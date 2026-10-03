import { z } from 'zod'
import { OptionalText } from './common.ts'
import { VisitStatus } from './visits.ts'

// ---------------------------------------------------------------------------
// Status and transitions
// ---------------------------------------------------------------------------

export const AppointmentStatus = z.enum(['booked', 'checked_in', 'completed', 'cancelled', 'rescheduled', 'no_show'])
export type AppointmentStatus = z.infer<typeof AppointmentStatus>

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  no_show: 'Did not attend',
}

/** While an appointment is in one of these states its doctor and patient hold the slot. */
export const OPEN_APPOINTMENT_STATUSES: AppointmentStatus[] = ['booked', 'checked_in']

/**
 * What the database allows (migration 0022; a test checks that they agree).
 * Staff reach `checked_in` through check-in, `rescheduled` through reschedule,
 * and cancel or mark no-show only while `booked`: once checked in, the visit
 * decides how the appointment ends (completed, or cancelled / no_show with
 * the visit), so a checked-in appointment never changes by hand.
 */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ['checked_in', 'cancelled', 'rescheduled', 'no_show'],
  checked_in: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  rescheduled: [],
  no_show: [],
}

export const APPOINTMENT_SOURCE_LABELS: Record<string, string> = {
  booking: 'Booked',
  reschedule: 'Rescheduled',
  cancellation: 'Cancelled by staff',
  no_show: 'Marked as did not attend',
  appointment_check_in: 'Checked in',
  visit_status: 'Followed its visit',
  unspecified: 'Changed outside the app',
}

// ---------------------------------------------------------------------------
// Scheduling policy. No clinic hours, clinician calendars or capacity rules
// exist in the product, so these are conservative defaults, not clinical
// policy: they only keep bookings sane (see docs/adr/0010).
// ---------------------------------------------------------------------------

export const APPOINTMENT_POLICY = {
  /** Start times fall on multiples of this many minutes (facility local time). */
  slotMinutes: 5,
  durations: [10, 15, 20, 30, 45, 60],
  defaultDuration: 15,
  /** Furthest booking, in days from today (facility local date). */
  maxDaysAhead: 180,
  reasonMax: 300,
} as const

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30')
const Duration = z
  .number()
  .int()
  .refine((d) => (APPOINTMENT_POLICY.durations as readonly number[]).includes(d), 'Choose one of the listed durations')
const ChangeReason = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(300, 'At most 300 characters')
const Version = z.number().int().positive()

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * `date` and `time` are the facility's local calendar day and clock time; the
 * server turns them into an instant using the facility's timezone. A clock time
 * that does not exist there (a daylight-saving gap) is refused, never moved.
 * `idempotencyKey` makes a retry return the same appointment instead of a new one.
 */
/**
 * A day the clinic can book or look up. The lower bound is not clinical policy:
 * PostgreSQL has no year 0 and nothing before 1900 is a booking, so such dates
 * are refused as a field problem instead of reaching the database.
 */
const ClinicDate = z.iso.date('Choose a date').refine((d) => d >= '1900-01-01', { message: 'Choose a valid date', when: (p) => p.issues.length === 0 })

export const CreateAppointmentRequest = z.object({
  patientId: z.uuid(),
  departmentId: z.uuid('Choose a department'),
  doctorId: z.uuid().nullable().optional(),
  date: ClinicDate,
  time: Time,
  durationMinutes: Duration.default(APPOINTMENT_POLICY.defaultDuration),
  reason: OptionalText(APPOINTMENT_POLICY.reasonMax),
  idempotencyKey: z.uuid(),
})
export type CreateAppointmentRequest = z.input<typeof CreateAppointmentRequest>

/** Moving an appointment books a new one and closes this one as rescheduled; nothing is edited in place. */
export const RescheduleAppointmentRequest = z.object({
  version: Version,
  date: ClinicDate,
  time: Time,
  durationMinutes: Duration.optional(),
  departmentId: z.uuid().optional(),
  doctorId: z.uuid().nullable().optional(),
  reason: ChangeReason,
  idempotencyKey: z.uuid(),
})
export type RescheduleAppointmentRequest = z.input<typeof RescheduleAppointmentRequest>

export const CancelAppointmentRequest = z.object({ version: Version, reason: ChangeReason })
export type CancelAppointmentRequest = z.input<typeof CancelAppointmentRequest>

export const NoShowAppointmentRequest = z.object({ version: Version, reason: OptionalText(300) })
export type NoShowAppointmentRequest = z.input<typeof NoShowAppointmentRequest>

export const CheckInAppointmentRequest = z.object({ version: Version.optional() })
export type CheckInAppointmentRequest = z.input<typeof CheckInAppointmentRequest>

export const AppointmentQuery = z
  .object({
    /** today: the facility's current day; upcoming: after today; past: before today (newest first); date: one day. */
    scope: z.enum(['today', 'upcoming', 'past', 'date']).default('today'),
    date: ClinicDate.optional(),
    /** Comma-separated statuses. */
    status: z.string().optional(),
    doctorId: z.uuid().optional(),
    /** Doctor view: assigned to me, plus unassigned ones in my department. */
    mine: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(300).default(200),
  })
  .refine((q) => q.scope !== 'date' || !!q.date, { message: 'Give the date', path: ['date'] })
export type AppointmentQuery = z.input<typeof AppointmentQuery>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const AppointmentVisitLink = z.object({ id: z.uuid(), status: VisitStatus, tokenNumber: z.number().int(), visitDate: z.string() })
export type AppointmentVisitLink = z.infer<typeof AppointmentVisitLink>

export const Appointment = z.object({
  id: z.uuid(),
  status: AppointmentStatus,
  version: z.number().int(),
  /** The instant (UTC, ISO). `localDate`, `localTime` and `endsLocalTime` are the same moment on the facility's clock. */
  scheduledAt: z.string(),
  localDate: z.string(),
  localTime: z.string(),
  endsLocalTime: z.string(),
  durationMinutes: z.number().int(),
  /** Hidden from administrators, who see the schedule without patient identity or free text. */
  patient: z.object({ id: z.uuid(), mrn: z.string(), fullName: z.string() }).nullable(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  doctorId: z.uuid().nullable(),
  doctorName: z.string().nullable(),
  reason: z.string().nullable(),
  statusReason: z.string().nullable(),
  visit: AppointmentVisitLink.nullable(),
  /** Booked, and its start time has passed: it still needs an outcome (check in, did not attend, or reschedule). */
  overdue: z.boolean(),
  /** What the signed-in user may do now (the server decides; the UI only offers these). */
  actions: z.object({ checkIn: z.boolean(), reschedule: z.boolean(), cancel: z.boolean(), noShow: z.boolean() }),
  /** The newest message to the patient about this appointment, if it still holds of the appointment as it stands (see notificationIsCurrent): has the patient been told? Null when there is none. */
  patientMessage: z.object({ status: z.enum(['queued', 'delivered', 'undeliverable', 'failed']), code: z.string().nullable() }).nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
})
export type Appointment = z.infer<typeof Appointment>

export const AppointmentList = z.object({
  /** The facility's timezone: every date and time here is on its clock. */
  timezone: z.string(),
  today: z.string(),
  scope: z.enum(['today', 'upcoming', 'past', 'date']),
  /** The local days covered; null where open-ended (upcoming has no end, past no start). */
  from: z.string().nullable(),
  to: z.string().nullable(),
  items: z.array(Appointment),
  /** Per status, before the status filter is applied. */
  counts: z.record(z.string(), z.number().int()),
  /** True when more matched than were returned. */
  truncated: z.boolean(),
})
export type AppointmentList = z.infer<typeof AppointmentList>

export const AppointmentEvent = z.object({
  from: z.string().nullable(),
  to: z.string(),
  source: z.string(),
  reason: z.string().nullable(),
  actorName: z.string().nullable(),
  at: z.string(),
})
export type AppointmentEvent = z.infer<typeof AppointmentEvent>

export const NotificationStatus = z.enum(['queued', 'delivered', 'undeliverable', 'failed'])
export type NotificationStatus = z.infer<typeof NotificationStatus>

export const NOTIFICATION_KINDS = ['appointment.booked', 'appointment.rescheduled', 'appointment.cancelled'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** What "delivered" means here: the only channel is the patient portal. No SMS, email or push is sent. */
export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  queued: 'Queued',
  delivered: 'Available in the patient portal',
  undeliverable: 'Not delivered',
  failed: 'Delivery failed',
}

export const NOTIFICATION_FAILURE_LABELS: Record<string, string> = {
  no_active_portal_account: 'The patient has no active portal account.',
  portal_consent_withdrawn: 'The patient withdrew access to the portal.',
  portal_consent_not_recorded: 'The patient has not agreed to portal access.',
  delivery_error: 'The delivery channel reported an error.',
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  'appointment.booked': 'Appointment booked',
  'appointment.rescheduled': 'Appointment moved',
  'appointment.cancelled': 'Appointment cancelled',
}

/**
 * A message is worth delivering only while it is still true: "booked" and
 * "moved" while the appointment is open, "cancelled" once it is cancelled. A
 * message that was never delivered and is no longer true is not retried (the
 * patient would be told of a time that no longer stands).
 */
export function notificationIsCurrent(kind: string, appointmentStatus: AppointmentStatus): boolean {
  if (kind === 'appointment.cancelled') return appointmentStatus === 'cancelled'
  return appointmentStatus === 'booked' || appointmentStatus === 'checked_in'
}

export const StaffNotification = z.object({
  id: z.uuid(),
  kind: z.string(),
  /** Still true of the appointment as it stands now; if not, it is not retried. */
  current: z.boolean(),
  status: NotificationStatus,
  failureCode: z.string().nullable(),
  attempts: z.number().int(),
  lastAttemptAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})
export type StaffNotification = z.infer<typeof StaffNotification>

const AppointmentRef = z.object({ id: z.uuid(), scheduledAt: z.string(), localDate: z.string(), localTime: z.string(), status: AppointmentStatus })

export const AppointmentDetail = z.object({
  /** The clinic's timezone, for the times of the history and the messages. */
  timezone: z.string(),
  appointment: Appointment,
  history: z.array(AppointmentEvent),
  notifications: z.array(StaffNotification),
  /** The appointment this one replaced, and the one that replaced it. */
  previous: AppointmentRef.nullable(),
  next: AppointmentRef.nullable(),
})
export type AppointmentDetail = z.infer<typeof AppointmentDetail>

export const AppointmentOptions = z.object({
  timezone: z.string(),
  today: z.string(),
  maxDate: z.string(),
  durations: z.array(z.number().int()),
  defaultDuration: z.number().int(),
  slotMinutes: z.number().int(),
})
export type AppointmentOptions = z.infer<typeof AppointmentOptions>

/** How check-in reached its visit: a new one, an open one of the same patient that day, or it was already done. */
export const CheckInOutcome = z.enum(['created_visit', 'linked_open_visit', 'already_checked_in'])
export type CheckInOutcome = z.infer<typeof CheckInOutcome>
export const CHECK_IN_OUTCOME_LABELS: Record<CheckInOutcome, string> = {
  created_visit: 'A visit was created and added to today’s queue.',
  linked_open_visit: 'The patient already had an open visit today; the appointment is now linked to it.',
  already_checked_in: 'Already checked in; nothing was created.',
}

export const CheckInResult = z.object({ appointment: Appointment, visit: AppointmentVisitLink, outcome: CheckInOutcome })
export type CheckInResult = z.infer<typeof CheckInResult>

export const RetryNotificationsResult = z.object({ notifications: z.array(StaffNotification), retried: z.number().int() })
export type RetryNotificationsResult = z.infer<typeof RetryNotificationsResult>

// ---------------------------------------------------------------------------
// Notification content: built when shown, from non-clinical facts only
// ---------------------------------------------------------------------------

export const NotificationPayload = z.object({
  scheduledAt: z.string(),
  timezone: z.string(),
  durationMinutes: z.number().int(),
  departmentName: z.string(),
  doctorName: z.string().nullable(),
  /** For a moved appointment: when it was. */
  previousScheduledAt: z.string().nullable().optional(),
})
export type NotificationPayload = z.infer<typeof NotificationPayload>

const when = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(iso))

/** The text of a notification. It never carries a reason for the visit, a diagnosis or any clinical detail. */
export function notificationText(kind: string, p: NotificationPayload): { title: string; message: string } {
  const where = `${p.departmentName}${p.doctorName ? ` with ${p.doctorName}` : ''}`
  const at = when(p.scheduledAt, p.timezone)
  switch (kind) {
    case 'appointment.booked':
      return { title: 'Appointment booked', message: `Your appointment at ${where} is on ${at}.` }
    case 'appointment.rescheduled':
      return {
        title: 'Appointment moved',
        message: p.previousScheduledAt ? `Your appointment at ${where} was moved from ${when(p.previousScheduledAt, p.timezone)} to ${at}.` : `Your appointment at ${where} is now on ${at}.`,
      }
    case 'appointment.cancelled':
      return { title: 'Appointment cancelled', message: `Your appointment at ${where} on ${at} was cancelled. Contact the clinic to book another time.` }
    default:
      return { title: 'Message from the clinic', message: 'Open the clinic’s appointment list for details.' }
  }
}

// ---------------------------------------------------------------------------
// Patient portal
// ---------------------------------------------------------------------------

export const PortalAppointment = z.object({
  id: z.uuid(),
  status: AppointmentStatus,
  scheduledAt: z.string(),
  timezone: z.string(),
  localDate: z.string(),
  localTime: z.string(),
  durationMinutes: z.number().int(),
  departmentName: z.string(),
  doctorName: z.string().nullable(),
  /** Booked, but its time has passed and the clinic has recorded no outcome: not an upcoming appointment. */
  awaitingOutcome: z.boolean(),
})
export type PortalAppointment = z.infer<typeof PortalAppointment>

export const PortalNotification = z.object({
  id: z.uuid(),
  kind: z.string(),
  /** When the message became available in the portal (not when it was queued). */
  deliveredAt: z.string(),
  readAt: z.string().nullable(),
  appointmentId: z.uuid().nullable(),
  payload: NotificationPayload,
})
export type PortalNotification = z.infer<typeof PortalNotification>

export const PortalAppointmentList = z.object({ appointments: z.array(PortalAppointment) })
export type PortalAppointmentList = z.infer<typeof PortalAppointmentList>

export const PatientAppointments = z.object({ timezone: z.string(), today: z.string(), items: z.array(Appointment) })
export type PatientAppointments = z.infer<typeof PatientAppointments>

export const PortalNotifications = z.object({ unread: z.number().int(), /** The clinic's timezone, for the times of the messages. */ timezone: z.string(), notifications: z.array(PortalNotification) })
export type PortalNotifications = z.infer<typeof PortalNotifications>
