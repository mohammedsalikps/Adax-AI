import { differenceInYears, format, parseISO } from 'date-fns'

/* India locale conventions: DD/MM/YYYY dates, INR currency, +91 phone,
   mg/dL glucose. Every display-level formatter lives here so the locale
   is changed in exactly one place. */

export function formatDate(iso: string): string {
  return format(parseISO(iso), 'dd/MM/yyyy')
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), 'dd/MM/yyyy, h:mm a')
}

export function formatClockTime(date: Date): string {
  return format(date, 'h:mm a')
}

/** Time of day from an ISO timestamp, e.g. "10:30 AM". */
export function formatTime(iso: string): string {
  return format(parseISO(iso), 'h:mm a')
}

export function formatLongDate(date: Date): string {
  return format(date, 'EEEE, d MMMM yyyy')
}

/**
 * Local calendar date as YYYY-MM-DD. Never use toISOString() for this —
 * it converts to UTC, which yields the previous day for IST before 05:30.
 */
export function toIsoDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function calculateAge(dateOfBirthIso: string): number {
  return differenceInYears(new Date(), parseISO(dateOfBirthIso))
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

/** 9876543210 -> +91 98765 43210 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return phone
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
}

/** 14-digit ABHA number -> XX-XXXX-XXXX-XXXX */
export function formatAbha(abha: string): string {
  const digits = abha.replace(/\D/g, '')
  if (digits.length !== 14) return abha
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`
}

/** "Dr Ananya Rao" -> "AR", used for avatar fallbacks. */
export function initialsOf(fullName: string): string {
  return fullName
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
