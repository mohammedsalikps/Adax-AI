import { z } from 'zod'
import { Text } from './common.ts'
import { Sex } from './patients.ts'
import { Observation } from './vitals.ts'

const NoteText = (max: number) => z.string().max(max, `At most ${max} characters`)

/** Free-text sections of the consultation note (SOAP-style). */
export const NoteFields = z.object({
  chiefComplaint: NoteText(1000),
  history: NoteText(8000),
  pastHistory: NoteText(4000),
  examination: NoteText(8000),
  assessment: NoteText(4000),
  plan: NoteText(8000),
  followUp: NoteText(1000),
})
export type NoteFields = z.infer<typeof NoteFields>
export const NOTE_SECTIONS: { key: keyof NoteFields; label: string; rows: number; hint?: string }[] = [
  { key: 'chiefComplaint', label: 'Chief complaint', rows: 2 },
  { key: 'history', label: 'History of present illness', rows: 5 },
  { key: 'pastHistory', label: 'Medical history', rows: 3, hint: 'Past illnesses, surgeries, current medicines, family and social history.' },
  { key: 'examination', label: 'Examination', rows: 5 },
  { key: 'assessment', label: 'Assessment', rows: 3 },
  { key: 'plan', label: 'Plan', rows: 4, hint: 'Investigations, treatment and advice.' },
  { key: 'followUp', label: 'Follow-up', rows: 2 },
]
export const EMPTY_NOTE: NoteFields = { chiefComplaint: '', history: '', pastHistory: '', examination: '', assessment: '', plan: '', followUp: '' }

export const DiagnosisKind = z.enum(['provisional', 'primary', 'secondary'])
const draftText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).default('')

/**
 * Draft rows are saved while the doctor is still typing, so they may be
 * incomplete. Completeness is enforced at signing (see signIssues).
 */
export const DiagnosisInput = z.object({
  description: draftText(300),
  /** ICD-10 code as typed by the doctor; format-checked at signing, not validated against a code set. */
  code: z
    .string()
    .trim()
    .max(12)
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable()
    .optional(),
  kind: DiagnosisKind.default('primary'),
})
export type DiagnosisInput = z.input<typeof DiagnosisInput>

export const PrescriptionItemInput = z.object({
  drugName: draftText(160),
  strength: draftText(60),
  form: draftText(40),
  dose: draftText(60),
  route: draftText(40),
  frequency: draftText(60),
  duration: draftText(60),
  instructions: draftText(300),
})
export type PrescriptionItemInput = z.input<typeof PrescriptionItemInput>
export type PrescriptionItem = z.output<typeof PrescriptionItemInput>
export const FREQUENCY_PRESETS = ['Once daily (OD)', 'Twice daily (BD)', 'Three times daily (TDS)', 'Four times daily (QID)', 'At night (HS)', 'When needed (SOS)', '1-0-1', '1-1-1', '0-0-1']

/** Autosave: the whole working draft is replaced. `version` detects concurrent edits. */
export const SaveDraftRequest = z.object({
  version: z.number().int().positive(),
  note: NoteFields,
  diagnoses: z.array(DiagnosisInput).max(20),
  prescription: z.array(PrescriptionItemInput).max(30),
})
export type SaveDraftRequest = z.input<typeof SaveDraftRequest>

export const ICD10_PATTERN = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/

/** What must be complete before a consultation can be signed. Used by both the API and the UI. */
export function signIssues(d: { note: { chiefComplaint: string }; diagnoses: { description?: string; code?: string | null }[]; prescription: PrescriptionItemInput[] }): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = []
  if (!d.note.chiefComplaint.trim()) issues.push({ path: 'note.chiefComplaint', message: 'Chief complaint is required to sign' })
  if (!d.diagnoses.length) issues.push({ path: 'diagnoses', message: 'Add at least one diagnosis (provisional is fine)' })
  d.diagnoses.forEach((x, i) => {
    if (!(x.description ?? '').trim()) issues.push({ path: `diagnoses.${i}.description`, message: `Diagnosis ${i + 1}: description is required` })
    if (x.code && !ICD10_PATTERN.test(x.code)) issues.push({ path: `diagnoses.${i}.code`, message: `Diagnosis ${i + 1}: ICD-10 format, e.g. J06.9` })
  })
  d.prescription.forEach((p, i) => {
    for (const [k, label] of [['drugName', 'medicine'], ['dose', 'dose'], ['frequency', 'frequency'], ['duration', 'duration']] as const) {
      if (!(p[k] ?? '').trim()) issues.push({ path: `prescription.${i}.${k}`, message: `Medicine ${i + 1}: ${label} is required` })
    }
  })
  return issues
}

export const SignRequest = z.object({ version: z.number().int().positive(), attestation: z.literal(true, 'Confirm that you have reviewed the record') })

export const AmendmentRequest = z.object({ reason: Text(300), content: Text(4000) })
export type AmendmentRequest = z.input<typeof AmendmentRequest>

export const Amendment = z.object({ id: z.uuid(), reason: z.string(), content: z.string(), authorName: z.string(), createdAt: z.string() })
export type Amendment = z.infer<typeof Amendment>

export const EncounterStatus = z.enum(['in_progress', 'signed'])

export const Encounter = z.object({
  id: z.uuid(),
  status: EncounterStatus,
  version: z.number().int(),
  visit: z.object({ id: z.uuid(), visitDate: z.string(), tokenNumber: z.number().int(), departmentName: z.string(), reasonForVisit: z.string().nullable() }),
  patient: z.object({
    id: z.uuid(),
    mrn: z.string(),
    fullName: z.string(),
    sex: Sex,
    dateOfBirth: z.string(),
    dateOfBirthEstimated: z.boolean(),
    phone: z.string(),
    noKnownAllergies: z.boolean(),
    activeAllergies: z.array(z.string()),
  }),
  doctor: z.object({ id: z.uuid(), fullName: z.string(), registrationNumber: z.string().nullable() }),
  facilityName: z.string(),
  note: NoteFields,
  diagnoses: z.array(z.object({ description: z.string(), code: z.string().nullable(), kind: DiagnosisKind })),
  prescription: z.array(PrescriptionItemInput.required()),
  vitals: z.array(Observation),
  amendments: z.array(Amendment),
  startedAt: z.string(),
  updatedAt: z.string(),
  signedAt: z.string().nullable(),
  /** SHA-256 of the signed content; shown on printouts so copies can be checked. */
  contentHash: z.string().nullable(),
  /** Whether the current user may edit (author doctor, not yet signed). */
  canEdit: z.boolean(),
})
export type Encounter = z.infer<typeof Encounter>

export const TimelineEntry = z.object({
  kind: z.enum(['encounter', 'visit']),
  id: z.uuid(),
  date: z.string(),
  title: z.string(),
  status: z.string(),
  doctorName: z.string().nullable(),
  departmentName: z.string().nullable(),
  diagnoses: z.array(z.string()),
  medications: z.array(z.string()),
  amendmentCount: z.number().int(),
  encounterId: z.uuid().nullable(),
})
export type TimelineEntry = z.infer<typeof TimelineEntry>
