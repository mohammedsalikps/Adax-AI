import type { TranscriptSegment } from '@adaxai/contracts'

const SPEAKERS: Record<string, string> = {
  doctor: 'Doctor',
  dr: 'Doctor',
  'dr.': 'Doctor',
  patient: 'Patient',
  pt: 'Patient',
  'pt.': 'Patient',
  nurse: 'Nurse',
  attendant: 'Attendant',
  relative: 'Relative',
  mother: 'Mother',
  father: 'Father',
}
const SPEAKER_RE = /^(doctor|dr\.?|patient|pt\.?|nurse|attendant|relative|mother|father)\s*[:\-–]\s*(.+)$/iu
const MAX_SEGMENTS = 2000

/**
 * Splits a transcript into numbered segments (S1, S2, ...) so AI output can cite
 * its sources. One segment per line; a single unbroken block is split into
 * sentences. A leading "Doctor:" / "Patient:" label becomes the speaker.
 */
export function segmentTranscript(text: string): TranscriptSegment[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const units = lines.length === 1 ? (lines[0]!.match(/[^.!?।]+[.!?।]+["”’)]*\s*|[^.!?।]+$/gu) ?? [lines[0]!]).map((s) => s.trim()).filter(Boolean) : lines
  return units.slice(0, MAX_SEGMENTS).map((u, i) => {
    const m = u.match(SPEAKER_RE)
    return { id: `S${i + 1}`, speaker: m ? (SPEAKERS[m[1]!.toLowerCase()] ?? null) : null, text: m ? m[2]!.trim() : u }
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replaces the patient's identifiers with placeholders before text leaves the
 * server for an external AI provider. Best effort: it covers the registered
 * names, MRN and phone number, not every identifier a conversation can contain.
 */
export function pseudonymize(segments: TranscriptSegment[], p: PatientIdentifiers): TranscriptSegment[] {
  const scrub = makeScrubber(p)
  return segments.map((s) => ({ ...s, text: scrub(s.text) }))
}

export interface PatientIdentifiers {
  givenName: string
  familyName: string | null
  mrn: string
  phone: string
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
}

/** The same replacement for any free text (notes, record fields) sent to a provider. */
export function makeScrubber(p: PatientIdentifiers): (text: string) => string {
  const patterns: [RegExp, string][] = []
  const name = (n: string | null | undefined, tag: string) => {
    if (n && n.trim().length >= 2) patterns.push([new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n.trim())}(?![\\p{L}\\p{N}])`, 'giu'), tag])
  }
  name(p.givenName, '[PATIENT]')
  name(p.familyName, '[PATIENT]')
  for (const part of (p.emergencyContactName ?? '').split(/\s+/)) name(part, '[CONTACT]')
  patterns.push([new RegExp(escapeRe(p.mrn), 'gi'), '[MRN]'])
  for (const phone of [p.phone, p.emergencyContactPhone ?? '']) {
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (digits.length === 10) patterns.push([new RegExp(digits.split('').join('[\\s-]?'), 'g'), '[PHONE]'])
  }
  return (text) => patterns.reduce((t, [re, rep]) => t.replace(re, rep), text)
}
