import type { NewConsultationInput } from '@/mock/db'
import type {
  Consultation,
  ConsultationAiDraft,
  ConsultationDiagnosis,
  ConsultationPrescriptionItem,
  ConsultationStatus,
  TranscriptLine,
} from '@/types/consultation'
import type { DoseFrequency, DoseRoute } from '@/types/prescription'
import { createId } from '@/lib/ids'

export interface ConsultationFormState {
  chiefComplaint: string
  historyOfPresentIllness: string
  examination: string
  clinicalNotes: string
  diagnoses: ConsultationDiagnosis[]
  prescription: ConsultationPrescriptionItem[]
  followUpRequired: boolean
  followUpDate: string
  followUpInstructions: string
}

export type PrescriptionFieldError = Partial<
  Record<'medication' | 'dose' | 'frequency' | 'duration', string>
>

export interface ConsultationFormErrors {
  chiefComplaint?: string
  followUpDate?: string
  /** Keyed by diagnosis id. */
  diagnoses: Record<string, string>
  /** Keyed by prescription row id. */
  prescription: Record<string, PrescriptionFieldError>
}

export const EMPTY_ERRORS: ConsultationFormErrors = {
  diagnoses: {},
  prescription: {},
}

/** OD once daily · BD twice · TDS thrice · QID four times · HS bedtime · SOS as needed */
export const FREQUENCY_OPTIONS: { value: DoseFrequency; label: string }[] = [
  { value: 'OD', label: 'OD — once daily' },
  { value: 'BD', label: 'BD — twice daily' },
  { value: 'TDS', label: 'TDS — three times daily' },
  { value: 'QID', label: 'QID — four times daily' },
  { value: 'HS', label: 'HS — at bedtime' },
  { value: 'SOS', label: 'SOS — as needed' },
]

export const ROUTE_OPTIONS: { value: DoseRoute; label: string }[] = [
  { value: 'oral', label: 'Oral' },
  { value: 'topical', label: 'Topical' },
  { value: 'injection', label: 'Injection' },
  { value: 'inhalation', label: 'Inhalation' },
  { value: 'ophthalmic', label: 'Ophthalmic' },
]

export const EMPTY_CONSULTATION_FORM: ConsultationFormState = {
  chiefComplaint: '',
  historyOfPresentIllness: '',
  examination: '',
  clinicalNotes: '',
  diagnoses: [],
  prescription: [],
  followUpRequired: false,
  followUpDate: '',
  followUpInstructions: '',
}

export function createDiagnosis(): ConsultationDiagnosis {
  return { id: createId('dx'), name: '', notes: '' }
}

export function createPrescriptionItem(): ConsultationPrescriptionItem {
  return {
    id: createId('rx'),
    medication: '',
    genericName: '',
    strength: '',
    dose: '',
    frequency: 'BD',
    route: 'oral',
    duration: '',
    quantity: '',
    instructions: '',
    // The doctor is the only possible author of a prescription line.
    enteredBy: 'doctor',
  }
}

/** Rebuilds the form from a saved consultation, for continued editing. */
export function toFormState(consultation: Consultation): ConsultationFormState {
  return {
    chiefComplaint: consultation.chiefComplaint,
    historyOfPresentIllness: consultation.historyOfPresentIllness,
    examination: consultation.examination,
    clinicalNotes: consultation.clinicalNotes,
    diagnoses: consultation.diagnoses.map((item) => ({ ...item })),
    prescription: consultation.prescription.map((item) => ({ ...item })),
    followUpRequired: consultation.followUp.required,
    followUpDate: consultation.followUp.date ?? '',
    followUpInstructions: consultation.followUp.instructions ?? '',
  }
}

/** True when a prescription row has been touched at all. */
function isRowStarted(item: ConsultationPrescriptionItem): boolean {
  return Boolean(
    item.medication.trim() ||
      item.dose.trim() ||
      item.duration.trim() ||
      item.instructions?.trim(),
  )
}

/**
 * Validates the form.
 *
 * `strict` is used when completing a consultation: the chief complaint and
 * every prescription field become mandatory. A draft is validated loosely —
 * only rows the doctor has actually started must be coherent — so work in
 * progress can always be saved.
 */
export function validateConsultation(
  form: ConsultationFormState,
  { strict }: { strict: boolean },
): ConsultationFormErrors {
  const errors: ConsultationFormErrors = { diagnoses: {}, prescription: {} }

  if (strict && form.chiefComplaint.trim().length < 3) {
    errors.chiefComplaint = 'Record the chief complaint before completing.'
  }

  for (const diagnosis of form.diagnoses) {
    const started = Boolean(diagnosis.name.trim() || diagnosis.notes?.trim())
    if ((strict || started) && !diagnosis.name.trim()) {
      errors.diagnoses[diagnosis.id] = 'Enter a diagnosis, or remove the row.'
    }
  }

  for (const item of form.prescription) {
    if (!strict && !isRowStarted(item)) continue

    const rowErrors: PrescriptionFieldError = {}
    if (!item.medication.trim()) rowErrors.medication = 'Medication is required.'
    if (strict || item.medication.trim()) {
      if (!item.dose.trim()) rowErrors.dose = 'Dose is required.'
      if (!item.frequency) rowErrors.frequency = 'Frequency is required.'
      if (!item.duration.trim()) rowErrors.duration = 'Duration is required.'
    }
    if (Object.keys(rowErrors).length > 0) errors.prescription[item.id] = rowErrors
  }

  // Only enforced when completing: a draft must always be saveable, even
  // with the follow-up date still to be decided.
  if (strict && form.followUpRequired && !form.followUpDate) {
    errors.followUpDate = 'Enter a follow-up date, or turn follow-up off.'
  }

  return errors
}

export function hasErrors(errors: ConsultationFormErrors): boolean {
  return Boolean(
    errors.chiefComplaint ||
      errors.followUpDate ||
      Object.keys(errors.diagnoses).length > 0 ||
      Object.keys(errors.prescription).length > 0,
  )
}

/** Converts form state into the repository payload, dropping empty rows. */
export function toConsultationInput(
  form: ConsultationFormState,
  patientId: string,
  status: ConsultationStatus,
  extras: { transcript?: TranscriptLine[]; aiDraft?: ConsultationAiDraft } = {},
): NewConsultationInput {
  return {
    patientId,
    status,
    transcript: extras.transcript?.length ? extras.transcript : undefined,
    aiDraft: extras.aiDraft,
    chiefComplaint: form.chiefComplaint.trim(),
    historyOfPresentIllness: form.historyOfPresentIllness.trim(),
    examination: form.examination.trim(),
    clinicalNotes: form.clinicalNotes.trim(),
    diagnoses: form.diagnoses
      .filter((item) => item.name.trim())
      .map((item) => ({
        id: item.id,
        name: item.name.trim(),
        notes: item.notes?.trim() || undefined,
      })),
    prescription: form.prescription
      .filter((item) => item.medication.trim())
      .map((item) => ({
        ...item,
        medication: item.medication.trim(),
        genericName: item.genericName?.trim() || undefined,
        strength: item.strength?.trim() || undefined,
        dose: item.dose.trim(),
        duration: item.duration.trim(),
        quantity: item.quantity?.trim() || undefined,
        instructions: item.instructions?.trim() || undefined,
        enteredBy: 'doctor' as const,
      })),
    followUp: {
      required: form.followUpRequired,
      date: form.followUpRequired ? form.followUpDate : undefined,
      instructions: form.followUpInstructions.trim() || undefined,
    },
  }
}
