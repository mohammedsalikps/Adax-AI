/** Core patient identity and demographics. All dates are ISO-8601 strings. */

export type Sex = 'male' | 'female' | 'other'

export type BloodGroup =
  | 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'

export type AllergySeverity = 'mild' | 'moderate' | 'severe'

export interface Allergy {
  id: string
  substance: string
  reaction: string
  severity: AllergySeverity
  recordedOn: string
}

export interface ContactDetails {
  phone: string
  email?: string
  addressLine: string
  city: string
  state: string
  pincode: string
}

export interface EmergencyContact {
  name: string
  relationship: string
  phone: string
}

export interface Patient {
  /** Clinic-issued identifier, e.g. PT-2026-00142 */
  id: string
  /** 14-digit Ayushman Bharat Health Account number */
  abhaNumber?: string
  fullName: string
  photoUrl?: string
  dateOfBirth: string
  sex: Sex
  bloodGroup?: BloodGroup
  heightCm?: number
  weightKg?: number
  contact: ContactDetails
  emergencyContact?: EmergencyContact
  allergies: Allergy[]
  chronicConditions: string[]
  registeredOn: string
  lastVisitOn?: string
}

/** Reduced shape used by search results and queue rows. */
export interface PatientSummary {
  id: string
  fullName: string
  photoUrl?: string
  age: number
  sex: Sex
  lastVisitOn?: string
}
