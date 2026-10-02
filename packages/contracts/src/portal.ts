import { z } from 'zod'
import { ConsentType } from './patients.ts'
import { VitalKind } from './vitals.ts'

/**
 * Patient portal: the signed-in patient's OWN records only. The patient is
 * identified from the session, never from a request parameter.
 */

export const PortalProfile = z.object({
  mrn: z.string(),
  fullName: z.string(),
  dateOfBirth: z.string(),
  sex: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  bloodGroup: z.string().nullable(),
  preferredLanguage: z.string().nullable(),
  emergencyContact: z.object({ name: z.string().nullable(), phone: z.string().nullable() }),
  allergies: z.array(z.object({ substance: z.string(), reaction: z.string().nullable(), severity: z.string() })),
  noKnownAllergies: z.boolean(),
  facilityName: z.string(),
})
export type PortalProfile = z.infer<typeof PortalProfile>

export const PortalVisit = z.object({
  id: z.uuid(),
  visitDate: z.string(),
  tokenNumber: z.number(),
  departmentName: z.string(),
  doctorName: z.string().nullable(),
  status: z.string(),
  reasonForVisit: z.string().nullable(),
  /** Set when the visit has a signed consultation record. */
  recordId: z.uuid().nullable(),
})
export type PortalVisit = z.infer<typeof PortalVisit>

export const PortalPrescriptionItem = z.object({ drugName: z.string(), strength: z.string(), form: z.string(), dose: z.string(), route: z.string(), frequency: z.string(), duration: z.string(), instructions: z.string() })

export const PortalRecordSummary = z.object({
  id: z.uuid(),
  signedAt: z.string(),
  doctorName: z.string(),
  departmentName: z.string(),
  chiefComplaint: z.string(),
  diagnoses: z.array(z.object({ description: z.string(), code: z.string().nullable() })),
  prescriptionCount: z.number(),
  followUp: z.string(),
})
export type PortalRecordSummary = z.infer<typeof PortalRecordSummary>

/** A signed consultation record exactly as signed, with any later amendments. */
export const PortalRecord = PortalRecordSummary.extend({
  doctorRegistrationNumber: z.string().nullable(),
  history: z.string(),
  examination: z.string(),
  assessment: z.string(),
  plan: z.string(),
  prescription: z.array(PortalPrescriptionItem),
  amendments: z.array(z.object({ createdAt: z.string(), authorName: z.string(), reason: z.string(), content: z.string() })),
  contentHash: z.string(),
})
export type PortalRecord = z.infer<typeof PortalRecord>

export const PortalVital = z.object({ kind: VitalKind, value: z.number(), unit: z.string(), measuredAt: z.string(), source: z.enum(['manual', 'device']) })
export type PortalVital = z.infer<typeof PortalVital>

export const PortalConsent = z.object({ type: ConsentType, title: z.string(), description: z.string(), status: z.enum(['granted', 'withdrawn']), scope: z.string(), method: z.string(), recordedAt: z.string(), withdrawnAt: z.string().nullable(), version: z.string() })
export type PortalConsent = z.infer<typeof PortalConsent>

/** Doctor-approved thermal measurements: measurements only, never a diagnosis. */
export const PortalThermalReport = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  bodyRegion: z.string(),
  reviewedAt: z.string().nullable(),
  pairs: z.array(z.object({ a: z.string(), b: z.string(), meanDiff: z.number().nullable() })),
  camera: z.string().nullable(),
  dataOrigin: z.string(),
})
export type PortalThermalReport = z.infer<typeof PortalThermalReport>

export const PortalHome = z.object({
  profile: z.object({ fullName: z.string(), mrn: z.string() }),
  upcoming: z.array(z.object({ recordId: z.uuid(), signedAt: z.string(), followUp: z.string(), doctorName: z.string() })),
  lastVisit: PortalVisit.nullable(),
  counts: z.object({ records: z.number(), visits: z.number() }),
})
export type PortalHome = z.infer<typeof PortalHome>
