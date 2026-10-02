import { z } from 'zod'
import { OptionalText, Text } from './common.ts'

export const Sex = z.enum(['female', 'male', 'other', 'unknown'])
export type Sex = z.infer<typeof Sex>
export const SEX_LABELS: Record<Sex, string> = { female: 'Female', male: 'Male', other: 'Other', unknown: 'Unknown' }

/**
 * Phone numbers are stored as + and digits. A bare 10-digit number is treated
 * as Indian (+91), the deployment assumption for this MVP.
 */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[\s\-().]/g, '')
  if (/^\d{10}$/.test(s)) return `+91${s}`
  if (/^\+\d{10,15}$/.test(s)) return s
  if (/^00\d{10,15}$/.test(s)) return `+${s.slice(2)}`
  return null
}
export const Phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = normalizePhone(v)
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit mobile number or an international number starting with +' })
      return z.NEVER
    }
    return p
  })
export const OptionalPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    const p = normalizePhone(v)
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' })
      return z.NEVER
    }
    return p
  })
  .nullable()
  .optional()

/** ABHA number: 14 digits (hyphens allowed). Stored as digits; not verified with ABDM. */
export const OptionalAbha = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null
    const d = v.replace(/[\s-]/g, '')
    if (!/^\d{14}$/.test(d)) {
      ctx.addIssue({ code: 'custom', message: 'ABHA number has 14 digits' })
      return z.NEVER
    }
    return d
  })
  .nullable()
  .optional()

export const BloodGroup = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])

const DateOfBirth = z.iso.date('Use the date picker (YYYY-MM-DD)').refine((d) => {
  const t = new Date(`${d}T00:00:00Z`).getTime()
  return t <= Date.now() && t >= Date.UTC(1900, 0, 1)
}, 'Date of birth must be in the past and after 1900')

export const PatientInput = z.object({
  givenName: Text(80),
  familyName: OptionalText(80),
  dateOfBirth: DateOfBirth,
  dateOfBirthEstimated: z.boolean().default(false),
  sex: Sex,
  phone: Phone,
  email: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .pipe(z.email('Enter a valid email').nullable())
    .nullable()
    .optional(),
  addressLine: OptionalText(200),
  city: OptionalText(80),
  state: OptionalText(80),
  postalCode: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .pipe(z.string().regex(/^\d{6}$/, 'PIN code has 6 digits').nullable())
    .nullable()
    .optional(),
  abhaNumber: OptionalAbha,
  bloodGroup: BloodGroup.nullable().optional(),
  preferredLanguage: OptionalText(40),
  emergencyContactName: OptionalText(120),
  emergencyContactPhone: OptionalPhone,
})
export type PatientInput = z.input<typeof PatientInput>
export type PatientInputParsed = z.output<typeof PatientInput>

export const CreatePatientRequest = PatientInput.extend({
  /** Set after the user has seen and dismissed possible-duplicate warnings. */
  confirmNotDuplicate: z.boolean().optional(),
})
export type CreatePatientRequest = z.input<typeof CreatePatientRequest>
export const UpdatePatientRequest = PatientInput.partial().refine((v) => Object.keys(v).length > 0, 'No changes supplied')

export const PatientSummary = z.object({
  id: z.uuid(),
  mrn: z.string(),
  fullName: z.string(),
  sex: Sex,
  dateOfBirth: z.string(),
  dateOfBirthEstimated: z.boolean(),
  phone: z.string(),
  lastVisitDate: z.string().nullable(),
})
export type PatientSummary = z.infer<typeof PatientSummary>

export const AllergySeverity = z.enum(['mild', 'moderate', 'severe', 'unknown'])
export const Allergy = z.object({
  id: z.uuid(),
  substance: z.string(),
  reaction: z.string().nullable(),
  severity: AllergySeverity,
  status: z.enum(['active', 'inactive']),
  recordedAt: z.string(),
  recordedByName: z.string().nullable(),
})
export type Allergy = z.infer<typeof Allergy>
export const AllergyInput = z.object({ substance: Text(120), reaction: OptionalText(200), severity: AllergySeverity.default('unknown') })
export type AllergyInput = z.input<typeof AllergyInput>

export const ConsentType = z.enum(['data_processing', 'ai_recording', 'thermal_imaging', 'device_monitoring', 'portal_access', 'research_use', 'clinical_photography', 'ai_image_analysis', 'ai_record_assistant'])
export type ConsentType = z.infer<typeof ConsentType>
export const CONSENT_LABELS: Record<ConsentType, { title: string; description: string }> = {
  data_processing: { title: 'Care records', description: 'Store and use health records for this clinic’s care of the patient.' },
  ai_recording: {
    title: 'Consultation recording & AI assistance',
    description: 'Record the consultation audio and process it, with relevant parts of the patient’s record (without name or contact details), using external speech-to-text and AI services to draft notes, extract findings and suggest points for the doctor to review.',
  },
  thermal_imaging: { title: 'Thermal imaging', description: 'Capture and store thermal images for review by the care team.' },
  device_monitoring: { title: 'Device readings', description: 'Store readings from wearable or bedside devices.' },
  portal_access: { title: 'Patient portal', description: 'Online access to the patient’s own approved records.' },
  research_use: { title: 'De-identified research use', description: 'Use de-identified data to develop and evaluate tools. Optional; care is not affected.' },
  clinical_photography: { title: 'Clinical photographs', description: 'Take and store photographs (for example of a wound or skin condition) for the care team.' },
  ai_image_analysis: { title: 'AI description of photographs', description: 'Send clinical photographs (without name or contact details) to an external AI service that describes them for the doctor to review.' },
  ai_record_assistant: {
    title: 'Mana AI record summaries',
    description: 'When the doctor asks a question about the patient’s record, send the relevant parts of the record (without name or contact details) to an external AI service that writes a summary with references, for the doctor to check. Answers read directly from the record do not need this consent.',
  },
}

/**
 * Version of the wording read to the patient. Bump when the wording changes in
 * substance; features that rely on the new wording require that version.
 */
export const CONSENT_VERSIONS: Record<ConsentType, string> = {
  data_processing: '2026-10-v1',
  ai_recording: '2026-10-v2',
  thermal_imaging: '2026-10-v1',
  device_monitoring: '2026-10-v1',
  portal_access: '2026-10-v1',
  research_use: '2026-10-v1',
  clinical_photography: '2026-10-v1',
  ai_image_analysis: '2026-10-v1',
  ai_record_assistant: '2026-10-v1',
}
export const ConsentMethod = z.enum(['verbal', 'written', 'digital'])
export const Consent = z.object({
  id: z.uuid(),
  type: ConsentType,
  status: z.enum(['granted', 'withdrawn']),
  method: ConsentMethod,
  scope: z.enum(['ongoing', 'encounter']),
  encounterId: z.uuid().nullable(),
  notes: z.string().nullable(),
  recordedAt: z.string(),
  recordedByName: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  version: z.string(),
})
export type Consent = z.infer<typeof Consent>
export const RecordConsentRequest = z.object({ type: ConsentType, method: ConsentMethod, notes: OptionalText(300) })
export type RecordConsentRequest = z.input<typeof RecordConsentRequest>

export const PatientDetail = PatientSummary.extend({
  givenName: z.string(),
  familyName: z.string().nullable(),
  email: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  abhaNumber: z.string().nullable(),
  bloodGroup: BloodGroup.nullable(),
  preferredLanguage: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  noKnownAllergies: z.boolean(),
  allergies: z.array(Allergy),
  consents: z.array(Consent),
  portalAccount: z.object({ active: z.boolean(), activationPending: z.boolean() }),
  createdAt: z.string(),
})
export type PatientDetail = z.infer<typeof PatientDetail>

export const DuplicateCandidate = z.object({ id: z.uuid(), mrn: z.string(), fullName: z.string(), dateOfBirth: z.string(), phone: z.string() })
export type DuplicateCandidate = z.infer<typeof DuplicateCandidate>

export const ActivationCodeResponse = z.object({ activationCode: z.string(), expiresAt: z.string(), mrn: z.string() })
export type ActivationCodeResponse = z.infer<typeof ActivationCodeResponse>
