import type { PrescribingDoctor } from '@/types/prescription'

/**
 * The signed-in clinician for this demonstration. No authentication is
 * implemented — this is a fixed persona, shared by the topbar and by any
 * record that needs a provider, so the identity is defined in one place.
 */
export const DEMO_DOCTOR: PrescribingDoctor = {
  id: 'doc_ananya_rao',
  fullName: 'Dr Ananya Rao',
  qualifications: 'MBBS, MD (Internal Medicine)',
  specialty: 'Internal Medicine',
  registrationNumber: 'KMC/48217',
  clinicName: 'Sunrise Medical Centre, Bengaluru',
  clinicAddress: '24, 11th Main, Jayanagar 4th Block, Bengaluru 560011',
  clinicPhone: '08041234567',
}
