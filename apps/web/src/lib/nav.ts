import type { Role } from '@adaxai/contracts'
import {
  ClipboardList,
  FileClock,
  FileText,
  HeartPulse,
  LayoutDashboard,
  type LucideIcon,
  ScanLine,
  ScrollText,
  ShieldCheck,
  Building2,
  Stethoscope,
  UserPlus,
  Users,
  Watch,
  Search,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const NAV: Record<Role, NavItem[]> = {
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/departments', label: 'Departments', icon: Building2 },
    { to: '/admin/devices', label: 'Devices', icon: Watch },
    { to: '/admin/thermal-data', label: 'Thermal data', icon: ScanLine },
    { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  ],
  doctor: [
    { to: '/doctor', label: 'OPD queue', icon: Stethoscope, end: true },
    { to: '/doctor/patients', label: 'Patients', icon: Search },
    { to: '/doctor/thermal', label: 'Thermal', icon: ScanLine },
  ],
  nurse: [
    { to: '/nurse', label: 'OPD queue', icon: ClipboardList, end: true },
    { to: '/nurse/register', label: 'Register patient', icon: UserPlus },
    { to: '/nurse/patients', label: 'Patients', icon: Search },
    { to: '/nurse/devices', label: 'Devices', icon: Watch },
  ],
  patient: [
    { to: '/patient', label: 'Home', icon: HeartPulse, end: true },
    { to: '/patient/visits', label: 'Visits', icon: FileClock },
    { to: '/patient/prescriptions', label: 'Prescriptions', icon: FileText },
    { to: '/patient/consents', label: 'Consents', icon: ShieldCheck },
  ],
}
