import type { Encounter } from '@adaxai/contracts'
import { TriangleAlert } from 'lucide-react'
import { usePatientHistory } from '../../lib/history.ts'
import { Badge } from '../ui/Feedback.tsx'

const SEVERITY_TEXT = { severe: 'Severe', moderate: 'Moderate', mild: 'Mild', unknown: 'severity not recorded' } as const

interface Chip {
  key: string
  text: string
  tone: 'down' | 'warn' | 'neutral'
}

/**
 * The allergies to show beside a consultation, from the patient's record. A mild allergy is neutral; an allergy whose severity nobody
 * recorded is not: it is shown as a warning, since "not recorded" is not "mild". The record is re-read every two minutes and when the window
 * regains focus. If it cannot be read (or has not loaded yet) the allergy names from the consultation itself are shown as well, and
 * a failed refresh says so, so an allergy is never hidden, and an old list is never presented as current, by a failed request.
 */
export function useAllergies(encounter: Pick<Encounter, 'patient'>) {
  const p = encounter.patient
  const history = usePatientHistory(p.id, { poll: true })
  const h = history.data
  const chips: Chip[] = []
  const seen = new Set<string>()
  for (const a of h?.allergies ?? []) {
    chips.push({ key: a.id, text: `Allergy: ${a.substance} (${SEVERITY_TEXT[a.severity]})`, tone: a.severity === 'severe' ? 'down' : a.severity === 'mild' ? 'neutral' : 'warn' })
    seen.add(a.substance.toLowerCase())
  }
  if (!h || history.isError) {
    for (const name of p.activeAllergies) {
      if (!seen.has(name.toLowerCase())) chips.push({ key: `visit-${name}`, text: `Allergy: ${name}`, tone: 'warn' })
    }
  }
  return {
    chips,
    stale: history.isError || history.fetchStatus === 'paused',
    /** The patient is recorded as having no known allergies (and none are listed). */
    noKnown: chips.length === 0 && (h ? h.noKnownAllergies : p.noKnownAllergies),
    notRecorded: chips.length === 0 && !(h ? h.noKnownAllergies : p.noKnownAllergies),
  }
}

/** The allergy chips as list items (put them in a `ul`), with a warning when the list may be out of date. */
export function AllergyItems({ encounter }: { encounter: Pick<Encounter, 'patient'> }) {
  const a = useAllergies(encounter)
  return (
    <>
      {a.chips.map((c) => (
        <li key={c.key}>
          <Badge tone={c.tone} wrap icon={<TriangleAlert aria-hidden="true" className="size-3 shrink-0" />}>
            {c.text}
          </Badge>
        </li>
      ))}
      {a.noKnown && (
        <li>
          <Badge wrap>No known allergies</Badge>
        </li>
      )}
      {a.notRecorded && (
        <li>
          <Badge tone="warn" wrap>
            Allergies not recorded
          </Badge>
        </li>
      )}
      {a.stale && (
        <li>
          <Badge tone="warn" wrap icon={<TriangleAlert aria-hidden="true" className="size-3 shrink-0" />}>
            Allergy list may be out of date
          </Badge>
        </li>
      )}
    </>
  )
}
