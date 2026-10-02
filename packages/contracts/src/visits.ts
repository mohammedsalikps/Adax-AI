import { z } from 'zod'
import { OptionalText } from './common.ts'
import { Sex } from './patients.ts'
import { Observation } from './vitals.ts'

export const VisitStatus = z.enum(['waiting', 'in_triage', 'ready', 'in_consultation', 'completed', 'cancelled', 'no_show'])
export type VisitStatus = z.infer<typeof VisitStatus>

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  waiting: 'Waiting',
  in_triage: 'Nurse intake',
  ready: 'Ready for doctor',
  in_consultation: 'With doctor',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Did not attend',
}

export const OPEN_VISIT_STATUSES: VisitStatus[] = ['waiting', 'in_triage', 'ready', 'in_consultation']

/**
 * Allowed manual status changes. `completed` is not here on purpose: a visit
 * completes only when the doctor signs the encounter.
 */
export const VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  waiting: ['in_triage', 'ready', 'cancelled', 'no_show'],
  in_triage: ['ready', 'waiting', 'cancelled'],
  ready: ['in_triage', 'cancelled', 'no_show'],
  in_consultation: ['ready'],
  completed: [],
  cancelled: [],
  no_show: [],
}

export const Priority = z.enum(['normal', 'urgent'])

export const CreateVisitRequest = z.object({
  patientId: z.uuid(),
  departmentId: z.uuid('Choose a department'),
  assignedDoctorId: z.uuid().nullable().optional(),
  priority: Priority.default('normal'),
  chiefComplaint: OptionalText(300),
})
export type CreateVisitRequest = z.input<typeof CreateVisitRequest>

export const UpdateVisitRequest = z
  .object({ departmentId: z.uuid(), assignedDoctorId: z.uuid().nullable(), priority: Priority, chiefComplaint: OptionalText(300) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied')
export type UpdateVisitRequest = z.input<typeof UpdateVisitRequest>

export const ChangeVisitStatusRequest = z.object({ status: VisitStatus, reason: OptionalText(200) })

export const Visit = z.object({
  id: z.uuid(),
  visitDate: z.string(),
  tokenNumber: z.number().int(),
  status: VisitStatus,
  priority: Priority,
  chiefComplaint: z.string().nullable(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  assignedDoctorId: z.uuid().nullable(),
  assignedDoctorName: z.string().nullable(),
  checkedInAt: z.string(),
  updatedAt: z.string(),
  encounterId: z.uuid().nullable(),
  patient: z.object({ id: z.uuid(), mrn: z.string(), fullName: z.string(), sex: Sex, dateOfBirth: z.string(), noKnownAllergies: z.boolean(), activeAllergies: z.array(z.string()) }),
  latestVitals: z.array(Observation),
  abnormalVitalCount: z.number().int(),
})
export type Visit = z.infer<typeof Visit>

export const VisitQuery = z.object({
  date: z.iso.date().optional(),
  status: z.string().optional(),
  departmentId: z.uuid().optional(),
  /** Doctor view: visits assigned to me, plus unassigned ones in my department. */
  mine: z.enum(['true', 'false']).optional(),
})
