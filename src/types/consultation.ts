import type { DoseFrequency, DoseRoute } from './prescription'
import type { VitalsSnapshot } from './vitals'

/* ------------------------------------------------------------------
   The consultation record a doctor writes during a visit.
------------------------------------------------------------------ */

export type ConsultationStatus = 'draft' | 'completed'

export interface ConsultationDiagnosis {
  id: string
  name: string
  notes?: string
}

/**
 * A prescription line written during a consultation. Free text rather than
 * a formulary link — see Drug/RxLineItem for the formulary-backed model
 * used when a prescription is issued and printed.
 */
export interface ConsultationPrescriptionItem {
  id: string
  /** Brand name as written, e.g. "Glycomet". */
  medication: string
  /** Generic name, optionally filled from the formulary. */
  genericName?: string
  /** Strength as dispensed, e.g. "500 mg". */
  strength?: string
  /** Dose taken each time, e.g. "1 tablet". */
  dose: string
  frequency: DoseFrequency
  route: DoseRoute
  /** Free text, e.g. "5 days" or "3 months". */
  duration: string
  /** Total units to dispense. */
  quantity?: string
  instructions?: string
  /**
   * Always 'doctor'. Medication is never created from AI output — the
   * assistant cannot prescribe, so there is no other possible value.
   */
  enteredBy: 'doctor'
}

export interface ConsultationFollowUp {
  required: boolean
  /** ISO date. Only meaningful when required is true. */
  date?: string
  instructions?: string
}

export interface Consultation {
  id: string
  patientId: string
  /** Provider who recorded the consultation. */
  doctorName: string
  status: ConsultationStatus
  createdAt: string
  updatedAt: string
  chiefComplaint: string
  historyOfPresentIllness: string
  examination: string
  clinicalNotes: string
  diagnoses: ConsultationDiagnosis[]
  prescription: ConsultationPrescriptionItem[]
  followUp: ConsultationFollowUp
  /** Vitals captured during this consultation, if any were recorded. */
  recordedVitals?: VitalsSnapshot
  /** Transcript of the recorded conversation, if one was captured. */
  transcript?: TranscriptLine[]
  /** The most recent AI draft. Never applied to the record automatically. */
  aiDraft?: ConsultationAiDraft
}

/** A completed encounter from before this system, shown as past history. */
export interface PastVisit {
  id: string
  patientId: string
  visitedOn: string
  doctorName: string
  chiefComplaint: string
  diagnosis: string
  summary: string
  prescriptionId?: string
}

/* ------------------------------------------------------------------
   Transcription and AI-assisted documentation.
------------------------------------------------------------------ */

export type Speaker = 'doctor' | 'patient'

export interface TranscriptLine {
  id: string
  speaker: Speaker
  text: string
  /** Milliseconds from the start of the recording. */
  offsetMs: number
  /** Interim results render greyed until finalised. */
  isFinal: boolean
  confidence: number
}

/** State machine for the transcription workspace. */
export type TranscriptionStatus =
  | 'not_started'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'transcript_ready'
  | 'draft_ready'
  | 'error'

/**
 * One drafted section. `sourceLineIds` records exactly which transcript
 * lines the text came from, so every field is traceable and nothing can be
 * presented without a source.
 */
export interface DraftSection {
  text: string
  sourceLineIds: string[]
}

/** A candidate the clinician voiced in the conversation — not a machine
 *  diagnosis. `evidence` is the verbatim line it was taken from. */
export interface DraftDiagnosis {
  id: string
  name: string
  evidence: string
  sourceLineId: string
}

/**
 * A documentation draft extracted from a transcript. It mirrors the
 * consultation's own fields one-for-one so applying it is a plain copy.
 * It never contains clinical content that is not present in the transcript.
 */
export interface ConsultationAiDraft {
  id: string
  generatedAt: string
  /** Number of transcript lines the draft was generated from. */
  sourceLineCount: number
  chiefComplaint: DraftSection
  historyOfPresentIllness: DraftSection
  examination: DraftSection
  clinicalNotes: DraftSection
  diagnoses: DraftDiagnosis[]
  followUpInstructions: DraftSection
}

/** Shown wherever drafted content appears. */
export const AI_DRAFT_DISCLAIMER =
  'AI-generated draft — review before saving.'

/** Rendered in place of any section the transcript does not cover. */
export const NOT_MENTIONED = 'Not mentioned in transcript.'
