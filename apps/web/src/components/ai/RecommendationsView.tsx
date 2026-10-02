import { type AiJob, type Recommendation, RECOMMENDATION_KINDS, type RecommendationKind } from '@adaxai/contracts'
import { ShieldAlert, Sparkles } from 'lucide-react'
import type { NoteInserter } from '../../lib/insert.ts'
import { Alert, Badge } from '../ui/Feedback.tsx'
import { EvidenceList } from './Evidence.tsx'
import { InsertButton } from './InsertButton.tsx'
import { ReviewControls, StatusBadge } from './ReviewControls.tsx'

function RecommendationCard({ r, encounterId, inserter, onFocus }: { r: Recommendation; encounterId: string; inserter: NoteInserter; onFocus: (ids: string[]) => void }) {
  const done = r.status === 'accepted' || r.status === 'edited'
  return (
    <li className={`rounded-lg border p-3 ${r.urgency === 'attention' ? 'border-down/40' : 'border-line'} ${r.status === 'rejected' ? 'bg-canvas' : ''}`} data-testid="recommendation">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {r.source === 'rules' ? (
          <Badge tone="notice" icon={<ShieldAlert aria-hidden="true" className="size-3" />}>
            Rule-based check
          </Badge>
        ) : (
          <Badge tone="ai" icon={<Sparkles aria-hidden="true" className="size-3" />}>
            AI suggestion
          </Badge>
        )}
        <span className="text-sm font-medium">{RECOMMENDATION_KINDS[r.kind as RecommendationKind] ?? r.kind}</span>
        {r.urgency === 'attention' && <Badge tone="down">Needs attention</Badge>}
        <StatusBadge status={r.status} />
      </div>
      <p className={`text-sm font-medium ${r.status === 'rejected' ? 'line-through' : ''}`}>{r.finalText ?? r.text}</p>
      {r.instruction && (
        <Alert tone="error" title="Configured escalation instruction" className="mt-2">
          {r.instruction} A clinician must review this.
        </Alert>
      )}
      <p className="mt-1 text-sm text-ink-muted">Why: {r.rationale}</p>
      {r.missingInformation.length > 0 && (
        <p className="mt-1 text-sm">
          <span className="font-medium">Not found in the data:</span> {r.missingInformation.map((m) => m.text).join('; ')}
        </p>
      )}
      {r.unsupported && <Alert tone="warning" className="mt-2">None of the data this suggestion cites could be verified. It may be wrong.</Alert>}
      <div className="mt-1">
        <EvidenceList evidence={r.evidence} onFocusSegments={onFocus} />
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {r.producedBy.provider} · {r.producedBy.model}
        {r.producedBy.version ? ` · ${r.source === 'rules' ? 'rules' : 'prompt'} ${r.producedBy.version}` : ''}
      </p>
      <ReviewControls encounterId={encounterId} type="recommendation" id={r.id} text={r.text} status={r.status} confirm={r.unsupported ? 'unsupported' : null} />
      {done && <InsertButton inserter={inserter} section="plan" text={r.finalText ?? r.text} subject={{ type: 'recommendation', id: r.id }} />}
    </li>
  )
}

/** Decision-support suggestions, never decisions: each one is accepted, edited, rejected or deferred by the doctor. */
export function RecommendationsView({ recommendations, jobs, encounterId, inserter, onFocus }: { recommendations: Recommendation[]; jobs: AiJob[]; encounterId: string; inserter: NoteInserter; onFocus: (ids: string[]) => void }) {
  const lastLlm = jobs.find((j) => j.kind === 'recommendations' && j.status === 'succeeded')
  const insufficient = lastLlm?.summary?.insufficientData === true ? String(lastLlm.summary.insufficientDataReason ?? 'The AI found too little information for any suggestion.') : null
  const sorted = [...recommendations].sort((a, b) => Number(b.urgency === 'attention') - Number(a.urgency === 'attention'))
  return (
    <section aria-label="Recommendations" className="space-y-2">
      <p className="text-sm">Decision support only. Rule-based checks use explicit, versioned rules; AI suggestions cite the record or transcript they rely on. Nothing is sent to the patient or added to the note unless you do it.</p>
      {insufficient && <Alert tone="info" title="AI: insufficient information">{insufficient}</Alert>}
      {!recommendations.length && <p className="text-sm text-ink-muted">No recommendations yet. Use “Get recommendations”.</p>}
      <ul className="space-y-2">
        {sorted.map((r) => (
          <RecommendationCard key={r.id} r={r} encounterId={encounterId} inserter={inserter} onFocus={onFocus} />
        ))}
      </ul>
    </section>
  )
}
