import { APPLICATION_ROLES, type Application, type Role } from '@adaxai/contracts'

/**
 * What each application's front door says. These are descriptions for people,
 * not permission definitions: what a signed-in person can do is decided by the
 * API on every request. Only things the product really does are listed.
 */
export interface ApplicationEntry {
  id: Application
  /** "Doctor App": what the application is called everywhere. */
  label: string
  /** "Doctor Portal": the heading of its sign-in page. */
  portal: string
  /** One line under the sign-in heading. */
  subtitle: string
  /** Who it is for, on its card. */
  audience: string
  capabilities: string[]
  cta: string
  /** Where its sign-in page is. */
  path: string
  usernameLabel: string
  usernameHint?: string
  /** What to do after a forgotten password: the product has no self-service reset, so this says who can help. */
  forgotten: string
}

export const APPLICATION_ENTRIES: Record<Application, ApplicationEntry> = {
  doctor: {
    id: 'doctor',
    label: 'Doctor App',
    portal: 'Doctor Portal',
    subtitle: 'Secure access to your clinical workspace.',
    audience: 'For doctors and clinical practitioners.',
    capabilities: ['Today’s patients and the OPD queue', 'Appointments and your schedule', 'Consultations and patient records', 'AI-assisted notes and Mana AI, always as drafts you review'],
    cta: 'Continue as Doctor',
    path: '/login/doctor',
    usernameLabel: 'Doctor username',
    usernameHint: 'Nurses and other clinical staff sign in here too.',
    forgotten: 'Forgot your password? A clinic administrator can reset it for you.',
  },
  patient: {
    id: 'patient',
    label: 'Patient App',
    portal: 'Patient Portal',
    subtitle: 'Secure access to your health information.',
    audience: 'For patients.',
    capabilities: ['Your appointments and messages from the clinic', 'Your visits and signed records', 'Your vital signs and consents', 'Your personal details'],
    cta: 'Continue as Patient',
    path: '/login/patient',
    usernameLabel: 'MRN',
    usernameHint: 'Your medical record number, printed on your registration slip (for example ADX-001234).',
    forgotten: 'Lost your password? Ask the clinic to issue you a new activation code.',
  },
  admin: {
    id: 'admin',
    label: 'Admin App',
    portal: 'Admin Portal',
    subtitle: 'Secure facility administration.',
    audience: 'For authorized administrators.',
    capabilities: ['Staff accounts and departments', 'Devices, thermal data and AI operations', 'The facility’s appointment schedule, without patient identity', 'The audit log and its integrity check'],
    cta: 'Continue as Admin',
    path: '/login/admin',
    usernameLabel: 'Admin username',
    forgotten: 'Forgot your password? Ask another administrator to reset it. If you are the only one, use the local reset command described in the README.',
  },
}

export const APPLICATION_ORDER: Application[] = ['doctor', 'patient', 'admin']

/** The application whose sign-in a protected route sends a signed-out visitor to (clinical routes go to the Doctor App). */
export function applicationForRoles(roles: readonly Role[] | undefined): Application | null {
  if (!roles?.length) return null
  const apps = (Object.keys(APPLICATION_ROLES) as Application[]).filter((a) => roles.every((r) => APPLICATION_ROLES[a].includes(r)))
  return apps[0] ?? null
}

/**
 * A post-sign-in destination is honoured only if it is a page of the signed-in
 * role's own application: a path on this site (no other site, no protocol-
 * relative or backslash tricks, no control characters, no dot segments), under
 * `/<role>`, `/print/` (printable records; doctors and nurses only) or `/change-password`.
 * Anything else, including another role's pages, is ignored and the person
 * lands on their own home.
 */
export function safeNext(next: string | null, role: Role): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || [...next].some((ch) => ch === '\\' || ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null
  const path = next.split(/[?#]/)[0]!
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) return null
  // Percent-encoded dots, slashes and backslashes in the path are never needed here and are how a path is made to mean something else.
  if (/%(2e|2f|5c)/i.test(path)) return null
  const own = [`/${role}`, ...(role === 'doctor' || role === 'nurse' ? ['/print'] : []), '/change-password']
  return own.some((p) => path === p || path.startsWith(`${p}/`)) ? next : null
}
