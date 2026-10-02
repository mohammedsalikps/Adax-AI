const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })
const timeOnly = new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' })

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—')
export const fmtTime = (iso: string | null | undefined) => (iso ? timeOnly.format(new Date(iso)) : '—')
/** Formats a YYYY-MM-DD calendar date without timezone shifting. */
export const fmtDate = (ymd: string | null | undefined) => {
  if (!ymd) return '—'
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return dateOnly.format(new Date(y!, m! - 1, d!))
}

/** Age in whole years from a YYYY-MM-DD date of birth. */
export function ageFrom(dob: string, today = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number)
  let age = today.getFullYear() - y!
  if (today.getMonth() + 1 < m! || (today.getMonth() + 1 === m! && today.getDate() < d!)) age--
  return age
}

/** Random temporary password for the admin to hand over (the user must change it). */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}
