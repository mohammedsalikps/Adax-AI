/** Today's clinic schedule. One appointment per patient per session. */

export type AppointmentStatus = 'waiting' | 'in-consultation' | 'completed'

export type VisitType = 'first-visit' | 'follow-up'

export interface Appointment {
  id: string
  patientId: string
  /** Scheduled slot, ISO-8601. */
  slotAt: string
  /** When the patient checked in at reception. Absent if not yet arrived. */
  arrivedAt?: string
  status: AppointmentStatus
  visitType: VisitType
  chiefComplaint: string
  /** Whether reception recorded pre-consultation vitals. */
  vitalsRecorded: boolean
}
