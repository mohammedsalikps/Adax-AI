import type { NewPatientInput } from '@/mock/db'
import type { AllergySeverity, BloodGroup, Sex } from '@/types/patient'
import { toIsoDateString } from '@/lib/format'
import { createId } from '@/lib/ids'

export interface DraftAllergy {
  id: string
  substance: string
  reaction: string
  severity: AllergySeverity
}

export interface RegistrationForm {
  fullName: string
  dateOfBirth: string
  sex: Sex | ''
  bloodGroup: BloodGroup | ''
  heightCm: string
  weightKg: string
  phone: string
  email: string
  addressLine: string
  city: string
  state: string
  pincode: string
  emergencyName: string
  emergencyRelationship: string
  emergencyPhone: string
  abhaNumber: string
  consentGiven: boolean
  allergies: DraftAllergy[]
  chronicConditions: string[]
}

export type FormErrors = Partial<Record<keyof RegistrationForm, string>>

export const REGISTRATION_STEPS = [
  { title: 'Demographics', hint: 'Name, date of birth and measurements' },
  { title: 'Contact', hint: 'Phone, address and emergency contact' },
  { title: 'Identity', hint: 'ABHA number and consent' },
  { title: 'Clinical baseline', hint: 'Allergies and chronic conditions' },
  { title: 'Review', hint: 'Confirm and issue a patient ID' },
] as const

export const SEX_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]

export const BLOOD_GROUP_OPTIONS = (
  ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] satisfies BloodGroup[]
).map((group) => ({ value: group, label: group }))

export const SEVERITY_OPTIONS = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
]

export const EMPTY_REGISTRATION_FORM: RegistrationForm = {
  fullName: '',
  dateOfBirth: '',
  sex: '',
  bloodGroup: '',
  heightCm: '',
  weightKg: '',
  phone: '',
  email: '',
  addressLine: '',
  city: '',
  state: 'Karnataka',
  pincode: '',
  emergencyName: '',
  emergencyRelationship: '',
  emergencyPhone: '',
  abhaNumber: '',
  consentGiven: false,
  allergies: [],
  chronicConditions: [],
}

export function createDraftAllergy(): DraftAllergy {
  return { id: createId('alg'), substance: '', reaction: '', severity: 'moderate' }
}

const INDIAN_MOBILE = /^[6-9]\d{9}$/
const PINCODE = /^\d{6}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/** Validates one step. An empty object means the step may be advanced. */
export function validateStep(step: number, form: RegistrationForm): FormErrors {
  const errors: FormErrors = {}

  if (step === 0) {
    if (form.fullName.trim().length < 3) {
      errors.fullName = 'Enter the full name as it appears on records.'
    }
    if (!form.dateOfBirth) {
      errors.dateOfBirth = 'Date of birth is required.'
    } else {
      const dob = new Date(form.dateOfBirth)
      const now = new Date()
      if (Number.isNaN(dob.getTime())) {
        errors.dateOfBirth = 'Enter a valid date.'
      } else if (dob > now) {
        errors.dateOfBirth = 'Date of birth cannot be in the future.'
      } else if (now.getFullYear() - dob.getFullYear() > 120) {
        errors.dateOfBirth = 'Check the year — that age is not plausible.'
      }
    }
    if (!form.sex) errors.sex = 'Select the recorded sex.'

    if (form.heightCm) {
      const height = Number(form.heightCm)
      if (!Number.isFinite(height) || height < 30 || height > 250) {
        errors.heightCm = 'Height must be between 30 and 250 cm.'
      }
    }
    if (form.weightKg) {
      const weight = Number(form.weightKg)
      if (!Number.isFinite(weight) || weight < 1 || weight > 400) {
        errors.weightKg = 'Weight must be between 1 and 400 kg.'
      }
    }
  }

  if (step === 1) {
    if (!INDIAN_MOBILE.test(digitsOnly(form.phone))) {
      errors.phone = 'Enter a 10-digit mobile number beginning 6 to 9.'
    }
    if (form.email && !EMAIL.test(form.email.trim())) {
      errors.email = 'Enter a valid email address.'
    }
    if (!form.addressLine.trim()) errors.addressLine = 'Address is required.'
    if (!form.city.trim()) errors.city = 'City is required.'
    if (!form.state.trim()) errors.state = 'State is required.'
    if (!PINCODE.test(digitsOnly(form.pincode))) {
      errors.pincode = 'PIN code must be 6 digits.'
    }
    if (form.emergencyName.trim() && !INDIAN_MOBILE.test(digitsOnly(form.emergencyPhone))) {
      errors.emergencyPhone = 'Enter a 10-digit number for the emergency contact.'
    }
  }

  if (step === 2) {
    if (form.abhaNumber && digitsOnly(form.abhaNumber).length !== 14) {
      errors.abhaNumber = 'ABHA number must be 14 digits.'
    }
    if (!form.consentGiven) {
      errors.consentGiven = 'Consent must be recorded before registration.'
    }
  }

  if (step === 3) {
    const incomplete = form.allergies.some((allergy) => !allergy.substance.trim())
    if (incomplete) {
      errors.allergies = 'Every allergy needs a substance, or remove the empty row.'
    }
  }

  return errors
}

/** Converts validated form state into the shape the repository accepts. */
export function toPatientInput(form: RegistrationForm): NewPatientInput {
  const today = toIsoDateString()

  return {
    fullName: form.fullName.trim(),
    dateOfBirth: form.dateOfBirth,
    sex: form.sex as Sex,
    bloodGroup: form.bloodGroup === '' ? undefined : form.bloodGroup,
    heightCm: form.heightCm ? Number(form.heightCm) : undefined,
    weightKg: form.weightKg ? Number(form.weightKg) : undefined,
    abhaNumber: form.abhaNumber ? digitsOnly(form.abhaNumber) : undefined,
    contact: {
      phone: digitsOnly(form.phone),
      email: form.email.trim() || undefined,
      addressLine: form.addressLine.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      pincode: digitsOnly(form.pincode),
    },
    emergencyContact: form.emergencyName.trim()
      ? {
          name: form.emergencyName.trim(),
          relationship: form.emergencyRelationship.trim() || 'Not stated',
          phone: digitsOnly(form.emergencyPhone),
        }
      : undefined,
    allergies: form.allergies
      .filter((allergy) => allergy.substance.trim())
      .map((allergy) => ({
        id: allergy.id,
        substance: allergy.substance.trim(),
        reaction: allergy.reaction.trim() || 'Not stated',
        severity: allergy.severity,
        recordedOn: today,
      })),
    chronicConditions: form.chronicConditions,
  }
}
