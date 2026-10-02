import { type ClinicalFact, FACT_CATEGORIES, FACT_FLAGS, FACT_SECTION, type FactFlag } from '@adaxai/contracts'
import type { NoteInserter } from '../../lib/insert.ts'
import { Badge } from '../ui/Feedback.tsx'
import { EvidenceList } from './Evidence.tsx'
import { InsertButton } from './InsertButton.tsx'
import { ReviewControls, StatusBadge } from './ReviewControls.tsx'
const ATTRIBUTION: Record<string, string> = { patient_reported: 'Patient said', clinician_stated: 'Clinician said', other_speaker: 'Other / unclear speaker' }
const CONFIRM: FactFlag[] = ['uncertain', 'no_source', 'conflicts_with_record', 'speaker_mismatch']

function FactCard({ f, encounterId, inserter, onFocus }: { f: ClinicalFact; encounterId: string; inserter: NoteInserter; onFocus: (ids: string[]) => void }) {
  const section = FACT_SECTION[f.category]
  const flags = f.flags as FactFlag[]
  const needsConfirm = flags.some((x) => CONFIRM.includes(x))
  const done = f.status === 'accepted' || f.status === 'edited'
  return (
    <li className={`rounded-lg border p-3 ${flags.includes('red_flag') ? 'border-down/40' : needsConfirm ? 'border-pending/40' : 'border-line'} ${f.status === 'rejected' ? 'bg-canvas' : ''}`} data-testid="fact">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{FACT_CATEGORIES[f.category]}</span>
        <Badge>{ATTRIBUTION[f.attribution]}</Badge>
        {f.negated && <Badge>Negative / denied</Badge>}
        <StatusBadge status={f.status} />
      </div>
      <p className={`text-sm ${f.status === 'rejected' ? 'line-through' : ''}`}>{f.finalText ?? f.text}</p>
      {flags.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs" aria-label="Review flags">
          {flags.map((x) => (
            <li key={x} className={x === 'red_flag' || x === 'conflicts_with_record' ? 'font-medium text-down' : 'text-pending'}>
              ⚑ {FACT_FLAGS[x] ?? x}
              {x === 'uncertain' && f.uncertaintyReason ? `: ${f.uncertaintyReason}` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1">
        <EvidenceList evidence={f.evidence} onFocusSegments={onFocus} />
      </div>
      <ReviewControls
        encounterId={encounterId}
        type="fact"
        id={f.id}
        text={f.text}
        status={f.status}
        confirm={needsConfirm ? 'flagged' : null}
      />
      {done && section && <InsertButton inserter={inserter} section={section} text={f.finalText ?? f.text} subject={{ type: 'fact', id: f.id }} />}
    </li>
  )
}

/** Extracted facts grouped by category, each with its sources and review state. */
export function FactsView({ facts, encounterId, inserter, onFocus }: { facts: ClinicalFact[]; encounterId: string; inserter: NoteInserter; onFocus: (ids: string[]) => void }) {
  if (!facts.length) return <p className="text-sm text-ink-muted">No facts extracted yet. Use “Extract facts” on a transcript.</p>
  const pending = facts.filter((f) => f.status === 'pending' || f.status === 'deferred').length
  const order = Object.keys(FACT_CATEGORIES)
  const sorted = [...facts].sort((a, b) => Number(b.flags.includes('red_flag')) - Number(a.flags.includes('red_flag')) || order.indexOf(a.category) - order.indexOf(b.category))
  return (
    <section aria-label="Extracted facts" className="space-y-2">
      <p className="text-sm">
        {facts.length} facts · {pending} awaiting review. Facts are what the transcript says; checking them against the patient is your decision. Accepting a fact does not change the record; use “Add to …” to copy it into the note.
      </p>
      <ul className="space-y-2">
        {sorted.map((f) => (
          <FactCard key={f.id} f={f} encounterId={encounterId} inserter={inserter} onFocus={onFocus} />
        ))}
      </ul>
    </section>
  )
}
