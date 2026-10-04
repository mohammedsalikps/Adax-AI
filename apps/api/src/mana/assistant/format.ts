import { MANA_SOURCE_KINDS, MANA_SOURCE_STATUS, type ManaSourceItem, type ManaSourceKind } from '@adaxai/contracts'
import { neutralise } from '../../ai/llm/neutralise.ts'
import type { PatientRecord, RecordItem } from '../record.ts'

/** A day as the doctor reads it ("28 Sep 2026"), in the clinic's own time zone; a date without a time is already a day. */
export function dayLabel(iso: string | Date | null, timeZone: string): string {
  if (!iso) return 'an unknown date'
  if (typeof iso === 'string' && iso.length === 10) return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone })
}

export function timeLabel(d: Date | string, timeZone: string): string {
  return new Date(d).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).replace(/\s?([ap])m/i, (_m, x: string) => ` ${x.toLowerCase()}m`)
}

/** The calendar day (YYYY-MM-DD) of an instant in the clinic's time zone. */
export const dayOf = (d: Date, timeZone: string): string => d.toLocaleDateString('en-CA', { timeZone })

export const addDays = (day: string, n: number): string => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10)

export const cap = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

/**
 * The shapes a telephone number is written in (international with a country code, an Indian mobile number, a landline with its area code, the three-three-four
 * form). A run of digits that has none of these shapes is not a telephone number: a date ("04-10-2026"), a batch number, a series of readings ("140 160 180 200",
 * "70.5 71.2 70.8") stay as they are.
 */
const PHONE_SHAPES: RegExp[] = [
  /\+\d{1,3}[\s-]?\(?\d{2,5}\)?[\s-]?\d{3,5}(?:[\s-]?\d{3,5})?/g,
  /(?<![\d.])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g,
  /(?<![\d.])\(?0\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)/g,
  /(?<![\d.])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g,
]
/** Record numbers: this register's own (ADX-018631, also written "ADX 018631", "adx018631"), the common names for one, and any short prefix with a long number. */
const MRN_SHAPES: RegExp[] = [/\b(?:ADX|MRN|UHID)[\s:#-]*\d{3,}\b/gi, /\b[A-Z]{2,5}-\d{6,}\b/g]

/**
 * Telephone numbers and record numbers wherever they appear in a text, whoever they belong to (a note that says "call 98400 12345" or "see ADX-001234"):
 * no identifier of a person reaches the model. Dates, times and clinical figures are left alone. Written for the shapes above; a number in another shape is
 * not recognised (and is shown to the doctor as written, which is where it came from).
 */
export function scrubGeneric(s: string): string {
  const noMrn = MRN_SHAPES.reduce((t, r) => t.replace(r, '(MRN)'), s)
  return PHONE_SHAPES.reduce((t, r) => t.replace(r, '(PHONE)'), noMrn)
}

/**
 * Free text out of a record (a note, a reason for a visit) as it may appear in a fact: the patient's own identifiers replaced (`scrub`), any telephone or
 * record number replaced, one line, nothing that could pass for structure, bounded.
 */
export const freeText = (s: string | null | undefined, n = 240, scrub?: (t: string) => string): string => cap(neutralise(scrub ? scrub(s ?? '') : scrubGeneric(s ?? '')), n)

const KIND_OF: Record<string, ManaSourceKind> = {
  allergy: 'allergy',
  patient: 'patient_record',
  prescription_item: 'prescription',
  observation: 'vital',
  visit: 'operational',
  thermal_capture: 'patient_record',
  patient_condition: 'patient_record',
  patient_medication: 'patient_record',
  investigation_result: 'investigation',
}

export function sourceKindOf(i: Pick<RecordItem, 'sourceType' | 'status'>): ManaSourceKind {
  if (i.sourceType === 'encounter_note' || i.sourceType === 'diagnosis' || i.sourceType === 'amendment') return i.status === 'signed' || i.status === 'amended' ? 'signed_record' : 'consultation'
  return KIND_OF[i.sourceType] ?? 'patient_record'
}

/** A record item as the doctor is shown it: a label in words, the date, the status, the record's own words, and a page where it can be opened. */
export function toSourceItem(i: RecordItem, record: PatientRecord): ManaSourceItem {
  const kind = sourceKindOf(i)
  const doctor = i.encounterId ? record.consultations.find((c) => c.encounter.id === i.encounterId)?.doctorName : null
  const when = i.date ? dayLabel(i.date, record.timeZone) : null
  const label = [MANA_SOURCE_KINDS[kind], i.field && !['Allergy', 'Prescription'].includes(i.field) ? i.field : null, when, doctor ? doctor : null].filter(Boolean).join(' · ')
  return {
    kind,
    label,
    date: i.date,
    status: MANA_SOURCE_STATUS[i.status] ?? i.status,
    excerpt: cap(i.excerpt, 400),
    link: i.encounterId ? { to: 'encounter', id: i.encounterId } : { to: 'patient', id: record.patient.id },
  }
}
