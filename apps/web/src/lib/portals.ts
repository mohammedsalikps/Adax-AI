import { ClipboardList, type LucideIcon, ShieldCheck, Smartphone, Stethoscope } from 'lucide-react'

export interface Portal {
  id: 'doctor' | 'nurse' | 'admin' | 'patient'
  path: string
  title: string
  audience: string
  /** Planned scope, stated as plans, not as existing features. */
  planned: string[]
  icon: LucideIcon
}

export const PORTALS: Portal[] = [
  {
    id: 'doctor',
    path: '/doctor',
    title: 'Doctor',
    audience: 'Consultations, notes and prescriptions',
    planned: ["Today's OPD queue", 'Consultation workspace with notes, diagnosis and prescription', 'Review of AI-drafted notes (drafts only until approved)'],
    icon: Stethoscope,
  },
  {
    id: 'nurse',
    path: '/nurse',
    title: 'Nurse',
    audience: 'Registration, queue and vitals',
    planned: ['Patient registration and search', 'OPD queue and tokens', 'Vitals entry'],
    icon: ClipboardList,
  },
  {
    id: 'admin',
    path: '/admin',
    title: 'Admin',
    audience: 'Users, roles and audit log',
    planned: ['User and role management', 'Audit log viewer'],
    icon: ShieldCheck,
  },
  {
    id: 'patient',
    path: '/patient',
    title: 'Patient',
    audience: 'Your visits and prescriptions',
    planned: ['Visit history', 'Signed prescriptions', 'Vitals history and consents'],
    icon: Smartphone,
  },
]
