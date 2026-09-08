import type { PatientUpdate } from '@/mock/db'
import type { AllergySeverity, Patient } from '@/types/patient'
import { toIsoDateString } from '@/lib/format'
import { createId } from '@/lib/ids'

export interface EditableAllergy {
  id: string
  substance: string
  reaction: string
  severity: AllergySeverity
  recordedOn: string
}

export interface EditPatientForm {
  fullName: string
  phone: string
  email: string
  addressLine: string
  city: string
  state: string
  pincode: string
  emergencyName: string
  emergencyRelationship: string
  emergencyPhone: string
  allergies: EditableAllergy[]
  chronicConditions: string[]
}

export type EditFormErrors = Partial<Record<keyof EditPatientForm, string>>

const INDIAN_MOBILE = /^[6-9]\d{9}$/
const PINCODE = /^\d{6}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/** Seeds the edit form from the stored chart. */
export function toEditForm(patient: Patient): EditPatientForm {
  return {
    fullName: patient.fullName,
    phone: patient.contact.phone,
    email: patient.contact.email ?? '',
    addressLine: patient.contact.addressLine,
    city: patient.contact.city,
    state: patient.contact.state,
    pincode: patient.contact.pincode,
    emergencyName: patient.emergencyContact?.name ?? '',
    emergencyRelationship: patient.emergencyContact?.relationship ?? '',
    emergencyPhone: patient.emergencyContact?.phone ?? '',
    allergies: patient.allergies.map((allergy) => ({ ...allergy })),
    chronicConditions: [...patient.chronicConditions],
  }
}

export function createEditableAllergy(): EditableAllergy {
  return {
    id: createId('alg'),
    substance: '',
    reaction: '',
    severity: 'moderate',
    recordedOn: toIsoDateString(),
  }
}

export function validateEditForm(form: EditPatientForm): EditFormErrors {
  const errors: EditFormErrors = {}

  if (form.fullName.trim().length < 3) {
    errors.fullName = 'Enter the full name as it appears on records.'
  }
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
  if (form.allergies.some((allergy) => !allergy.substance.trim())) {
    errors.allergies = 'Every allergy needs a substance, or remove the empty row.'
  }

  return errors
}

/** Converts validated form state into the repository update payload. */
export function toPatientUpdate(form: EditPatientForm): PatientUpdate {
  return {
    fullName: form.fullName.trim(),
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
        recordedOn: allergy.recordedOn,
      })),
    chronicConditions: form.chronicConditions,
  }
}
