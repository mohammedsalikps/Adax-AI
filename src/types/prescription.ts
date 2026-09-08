/** Prescription model following Indian clinic conventions:
 *  brand-first drug naming, BD/TDS frequency codes, and a doctor
 *  block carrying a State Medical Council registration number. */

export type DoseRoute = 'oral' | 'topical' | 'injection' | 'inhalation' | 'ophthalmic'

export type DoseForm = 'tablet' | 'capsule' | 'syrup' | 'injection' | 'cream' | 'drops' | 'inhaler'

/** OD once daily · BD twice · TDS thrice · QID four times · HS at bedtime · SOS as needed */
export type DoseFrequency = 'OD' | 'BD' | 'TDS' | 'QID' | 'HS' | 'SOS'

export type FoodTiming = 'before food' | 'after food' | 'with food' | 'any time'

export interface Drug {
  id: string
  brandName: string
  genericName: string
  strength: string
  form: DoseForm
  route: DoseRoute
  mrpInr: number
  /** Generic names that must not be co-prescribed with this drug. */
  interactsWith: string[]
}

export interface RxLineItem {
  id: string
  drug: Drug
  dosage: string
  frequency: DoseFrequency
  timing: FoodTiming
  durationDays: number
  quantity: number
  instructions?: string
}

export interface PrescribingDoctor {
  id: string
  fullName: string
  qualifications: string
  specialty: string
  /** State Medical Council registration number, printed on every Rx. */
  registrationNumber: string
  clinicName: string
  clinicAddress: string
  clinicPhone: string
}

export interface Prescription {
  id: string
  consultationId: string
  patientId: string
  issuedOn: string
  items: RxLineItem[]
  advice: string[]
  followUpOn?: string
  doctor: PrescribingDoctor
}

/**
 * A medication the patient is currently taking, as recorded on the chart.
 * Distinct from RxLineItem, which is a line on a prescription being written.
 */
export interface CurrentMedication {
  id: string
  patientId: string
  brandName: string
  genericName: string
  strength: string
  frequency: DoseFrequency
  timing: FoodTiming
  route: DoseRoute
  /** Free text, e.g. "5 days". Absent for ongoing long-term medication. */
  duration?: string
  startedOn: string
  prescribedBy: string
  active: boolean
}
