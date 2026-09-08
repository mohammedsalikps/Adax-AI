import {
  Activity,
  Check,
  ClipboardList,
  FlaskConical,
  Salad,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Badge, Button, EmptyState, LoadingState, Panel } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AiNotice } from './AiNotice'
import { formatDateTime } from '@/lib/format'
import {
  INSIGHT_DISCLAIMER,
  NO_INSIGHTS,
  type ClinicalAnalysis,
  type ClinicalInsight,
  type InsightCategory,
  type InsightDecision,
} from '@/types/insight'

const CATEGORY_META: Record<
  InsightCategory,
  { label: string; icon: typeof Activity; tone: string }
> = {
  observation: { label: 'Observation', icon: Activity, tone: 'text-ink-soft' },
  risk: { label: 'Risk', icon: TriangleAlert, tone: 'text-critical' },
  examination: { label: 'Examination', icon: Stethoscope, tone: 'text-accent' },
  investigation: { label: 'Investigation', icon: FlaskConical, tone: 'text-accent' },
  'medication-safety': { label: 'Medication safety', icon: ShieldAlert, tone: 'text-caution' },
  'follow-up': { label: 'Follow-up', icon: ClipboardList, tone: 'text-ink-soft' },
  lifestyle: { label: 'Lifestyle', icon: Salad, tone: 'text-normal' },
}

export interface ClinicalInsightsPanelProps {
  analysis: ClinicalAnalysis | null
  loading: boolean
  /** Doctor decisions, keyed by insight id. Absent means pending. */
  decisions: Record<string, InsightDecision>
  onDecide: (insightId: string, decision: InsightDecision) => void
  onGenerate: () => void
  disabled?: boolean
}

/**
 * Rule-derived clinical decision support, and the doctor's decision on each
 * entry.
 *
 * Two distinct things share this panel, and the distinction matters:
 *
 *   Observations restate what is already on the chart — a vital outside its
 *   range, a condition already recorded. There is nothing to accept; they are
 *   read-only.
 *
 *   Suggestions ask the doctor to consider something. Each is accepted or
 *   rejected individually and starts pending. Accepting one records the
 *   doctor's decision and nothing else: it never writes to the diagnosis, the
 *   prescription, or any other field. Turning an accepted suggestion into
 *   clinical content stays a deliberate, separate act by the doctor.
 */
export function ClinicalInsightsPanel({
  analysis,
  loading,
  decisions,
  onDecide,
  onGenerate,
  disabled = false,
}: ClinicalInsightsPanelProps) {
  const suggestions = analysis?.suggestions ?? []
  const observations = analysis?.observations ?? []

  const decided = suggestions.filter((item) => decisions[item.id] && decisions[item.id] !== 'pending')
  const accepted = suggestions.filter((item) => decisions[item.id] === 'accepted')

  return (
    <Panel
      title="AI clinical analysis"
      description="Rule-based · never diagnoses or prescribes"
      icon={Sparkles}
      tone={analysis ? 'ai' : 'default'}
      dense
      actions={
        <Button
          size="sm"
          variant={analysis ? 'ghost' : 'secondary'}
          icon={Sparkles}
          loading={loading}
          disabled={disabled}
          onClick={onGenerate}
        >
          {analysis ? 'Regenerate' : 'Analyse'}
        </Button>
      }
    >
      {loading ? (
        <LoadingState variant="skeleton" rows={3} label="Analysing the record" />
      ) : !analysis ? (
        <EmptyState
          size="sm"
          icon={Sparkles}
          title="No analysis yet"
          description="Run the rules over this patient's vitals, conditions, allergies, medications and transcript. Nothing reaches the consultation on its own."
        />
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <AiNotice>{INSIGHT_DISCLAIMER}</AiNotice>
            <p className="tnum text-[11px] text-ink-muted">
              {formatDateTime(analysis.generatedAt)}
            </p>
          </div>

          {/* ------------------------------------------------ observations */}
          {observations.length > 0 && (
            <section aria-label="Observations from the record">
              <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                What the record shows
              </h3>
              <ul className="mt-1.5 space-y-1.5">
                {observations.map((item) => (
                  <ObservationRow key={item.id} insight={item} />
                ))}
              </ul>
            </section>
          )}

          {/* ------------------------------------------------- suggestions */}
          <section aria-label="Suggestions for the doctor">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                For the doctor to consider
              </h3>
              {suggestions.length > 0 && (
                <span className="tnum shrink-0 text-[10px] text-ink-muted">
                  {decided.length}/{suggestions.length} decided
                </span>
              )}
            </div>

            {suggestions.length === 0 ? (
              <p className="mt-1.5 text-xs text-ink-muted">{NO_INSIGHTS}</p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {suggestions.map((item) => (
                  <SuggestionRow
                    key={item.id}
                    insight={item}
                    decision={decisions[item.id] ?? 'pending'}
                    disabled={disabled}
                    onDecide={(next) => onDecide(item.id, next)}
                  />
                ))}
              </ul>
            )}
          </section>

          {accepted.length > 0 && (
            <p className="border-t border-line pt-2.5 text-[11px] text-ink-muted">
              {accepted.length} suggestion{accepted.length === 1 ? '' : 's'} accepted. Accepting
              records your decision only — write anything clinical into the fields yourself.
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

function ObservationRow({ insight }: { insight: ClinicalInsight }) {
  const { icon: Icon, tone } = CATEGORY_META[insight.category]
  return (
    <li className="flex items-start gap-2">
      <Icon size={13} className={cn('mt-0.5 shrink-0', tone)} aria-hidden />
      <div className="min-w-0">
        <p className="text-[12px] leading-snug text-ink-soft">{insight.text}</p>
        <p className="tnum text-[10px] text-ink-muted">{insight.basis}</p>
      </div>
    </li>
  )
}

function SuggestionRow({
  insight,
  decision,
  disabled,
  onDecide,
}: {
  insight: ClinicalInsight
  decision: InsightDecision
  disabled: boolean
  onDecide: (decision: InsightDecision) => void
}) {
  const { label, icon: Icon, tone } = CATEGORY_META[insight.category]
  const isAccepted = decision === 'accepted'
  const isRejected = decision === 'rejected'

  return (
    <li
      className={cn(
        'rounded-control border px-2.5 py-2 transition-colors',
        isAccepted
          ? 'border-normal/35 bg-normal-soft/30'
          : isRejected
            ? 'border-line bg-surface-alt opacity-60'
            : 'border-line bg-surface',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={cn('shrink-0', tone)} aria-hidden />
        <span className="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
          {label}
        </span>
        {isAccepted && (
          <Badge variant="normal" className="ml-auto">
            Accepted
          </Badge>
        )}
        {isRejected && (
          <Badge variant="neutral" className="ml-auto">
            Rejected
          </Badge>
        )}
      </div>

      <p
        className={cn(
          'mt-1 text-[12px] leading-snug',
          isRejected ? 'text-ink-muted line-through' : 'text-ink',
        )}
      >
        {insight.text}
      </p>
      {/* The trigger is always shown: a suggestion the doctor cannot trace
          back to the record is one they cannot properly judge. */}
      <p className="mt-0.5 text-[10px] leading-snug text-ink-muted">{insight.basis}</p>

      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          size="sm"
          variant={isAccepted ? 'secondary' : 'ghost'}
          icon={Check}
          disabled={disabled}
          aria-pressed={isAccepted}
          onClick={() => onDecide(isAccepted ? 'pending' : 'accepted')}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={X}
          disabled={disabled}
          aria-pressed={isRejected}
          onClick={() => onDecide(isRejected ? 'pending' : 'rejected')}
        >
          Reject
        </Button>
      </div>
    </li>
  )
}
