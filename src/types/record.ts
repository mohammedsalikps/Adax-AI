/**
 * Investigation records held on a patient's chart: laboratory panels,
 * imaging and diagnostic studies, and family history.
 *
 * All fictional demonstration data. Every result carries the reference range
 * it was judged against and an explicit flag, so nothing in the interface has
 * to decide for itself whether a value is abnormal.
 */

export type LabResultFlag = 'normal' | 'high' | 'low'

export interface LabAnalyte {
  id: string
  name: string
  /** Pre-formatted, so qualitative results such as "Negative" work unchanged. */
  value: string
  unit?: string
  /** The range this result was judged against, as the laboratory reported it. */
  referenceRange: string
  flag: LabResultFlag
}

export interface LabReport {
  id: string
  patientId: string
  /** e.g. "HbA1c", "Lipid profile" */
  panelName: string
  collectedOn: string
  reportedOn: string
  laboratory: string
  analytes: LabAnalyte[]
  /** The laboratory's own comment, where it gave one. */
  impression?: string
}

export type StudyModality = 'x-ray' | 'ultrasound' | 'ct' | 'mri' | 'ecg' | 'echo'

export const MODALITY_LABEL: Record<StudyModality, string> = {
  'x-ray': 'X-ray',
  ultrasound: 'Ultrasound',
  ct: 'CT',
  mri: 'MRI',
  ecg: 'ECG',
  echo: 'Echocardiogram',
}

export interface StudyReport {
  id: string
  patientId: string
  modality: StudyModality
  studyName: string
  performedOn: string
  facility: string
  findings: string
  impression: string
  /**
   * True when the reporting radiologist or cardiologist flagged something
   * that needs attention. Set in the seed data, never inferred.
   */
  abnormal: boolean
}

export interface FamilyHistoryEntry {
  id: string
  patientId: string
  /** e.g. "Father", "Mother", "Elder sibling" */
  relation: string
  condition: string
  ageAtDiagnosis?: number
  note?: string
}
