import { useState } from 'react'
import { RefreshCw, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { Badge, Button, Drawer, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import {
  AI_DRAFT_DISCLAIMER,
  NOT_MENTIONED,
  type ConsultationAiDraft,
  type ConsultationDiagnosis,
} from '@/types/consultation'

/** The fields the doctor chose to copy into the consultation. */
export interface DraftApplySelection {
  chiefComplaint?: string
  historyOfPresentIllness?: string
  examination?: string
  clinicalNotes?: string
  followUpInstructions?: string
  /** Appended to the existing list, never replacing it. */
  diagnoses?: ConsultationDiagnosis[]
}

type TextSectionKey =
  | 'chiefComplaint'
  | 'historyOfPresentIllness'
  | 'examination'
  | 'clinicalNotes'
  | 'followUpInstructions'

const SECTION_LABELS: Record<TextSectionKey, string> = {
  chiefComplaint: 'Chief complaint',
  historyOfPresentIllness: 'History of present illness',
  examination: 'Examination',
  clinicalNotes: 'Clinical notes',
  followUpInstructions: 'Follow-up instructions',
}

const SECTION_ORDER: TextSectionKey[] = [
  'chiefComplaint',
  'historyOfPresentIllness',
  'examination',
  'clinicalNotes',
  'followUpInstructions',
]

export interface AiDraftDrawerProps {
  draft: ConsultationAiDraft | null
  open: boolean
  regenerating: boolean
  /** Current consultation values, so conflicts can be flagged before applying. */
  existing: Record<TextSectionKey, string>
  onClose: () => void
  onApply: (selection: DraftApplySelection) => void
  onRegenerate: () => void
  onDiscard: () => void
}

/**
 * Review surface for a generated draft. Nothing here reaches the
 * consultation until the doctor selects sections and applies them.
 */
export function AiDraftDrawer(props: AiDraftDrawerProps) {
  // Remounting on a new draft id resets the editable copy without an effect.
  return <DraftReview key={props.draft?.id ?? 'no-draft'} {...props} />
}

function initialText(draft: ConsultationAiDraft | null): Record<TextSectionKey, string> {
  const next = emptyText()
  if (!draft) return next
  for (const key of SECTION_ORDER) next[key] = draft[key].text
  return next
}

function initialSelection(draft: ConsultationAiDraft | null): Set<string> {
  const selected = new Set<string>()
  if (!draft) return selected
  for (const key of SECTION_ORDER) {
    if (draft[key].text !== NOT_MENTIONED) selected.add(key)
  }
  if (draft.diagnoses.length > 0) selected.add('diagnoses')
  return selected
}

function initialDiagnoses(draft: ConsultationAiDraft | null): ConsultationDiagnosis[] {
  return (draft?.diagnoses ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    notes: `Heard in the consultation: "${item.evidence}"`,
  }))
}

function DraftReview({
  draft,
  open,
  regenerating,
  existing,
  onClose,
  onApply,
  onRegenerate,
  onDiscard,
}: AiDraftDrawerProps) {
  const [text, setText] = useState(() => initialText(draft))
  const [selected, setSelected] = useState(() => initialSelection(draft))
  const [diagnoses, setDiagnoses] = useState(() => initialDiagnoses(draft))

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function apply() {
    const selection: DraftApplySelection = {}
    for (const key of SECTION_ORDER) {
      if (selected.has(key)) selection[key] = text[key]
    }
    if (selected.has('diagnoses') && diagnoses.length > 0) {
      selection.diagnoses = diagnoses
    }
    onApply(selection)
  }

  const selectedCount = selected.size

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="AI-generated draft"
      description={
        draft
          ? `Generated ${formatDateTime(draft.generatedAt)} from ${draft.sourceLineCount} transcript lines`
          : undefined
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" icon={Trash2} onClick={onDiscard}>
            Discard
          </Button>
          <Button
            variant="secondary"
            icon={RefreshCw}
            loading={regenerating}
            onClick={onRegenerate}
          >
            Regenerate
          </Button>
          <Button icon={Sparkles} disabled={selectedCount === 0} onClick={apply}>
            Apply {selectedCount > 0 ? `${selectedCount} section${selectedCount === 1 ? '' : 's'}` : ''}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="space-y-5">
          <div className="flex items-start gap-2.5 rounded-control border border-ai/30 bg-ai-soft px-3 py-2.5">
            <Sparkles size={15} className="mt-px shrink-0 text-ai" aria-hidden />
            <div>
              <p className="text-[13px] font-semibold text-ai">{AI_DRAFT_DISCLAIMER}</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                Every section below is composed from the transcript only. Nothing is
                added to the consultation until you apply it. Medication is never
                drafted — prescriptions are entered by the doctor.
              </p>
            </div>
          </div>

          {SECTION_ORDER.map((key) => {
            const source = draft[key]
            const unavailable = source.text === NOT_MENTIONED
            const conflict = Boolean(existing[key].trim()) && selected.has(key)

            return (
              <div key={key}>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      disabled={unavailable}
                      onChange={() => toggle(key)}
                      className="size-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <span className="text-[13px] font-semibold text-ink">
                      {SECTION_LABELS[key]}
                    </span>
                  </label>
                  {unavailable ? (
                    <Badge>Not in transcript</Badge>
                  ) : (
                    <Badge variant="ai">{source.sourceLineIds.length} lines</Badge>
                  )}
                </div>

                {unavailable ? (
                  <p className="mt-1.5 text-xs text-ink-muted italic">{NOT_MENTIONED}</p>
                ) : (
                  <>
                    <Textarea
                      label={`${SECTION_LABELS[key]} draft`}
                      wrapperClassName="mt-2"
                      rows={key === 'chiefComplaint' ? 2 : 4}
                      value={text[key]}
                      onChange={(event) =>
                        setText((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                    {conflict && (
                      <p className="mt-1 flex items-start gap-1.5 text-[11px] font-medium text-caution">
                        <TriangleAlert size={12} className="mt-px shrink-0" aria-hidden />
                        Applying this will replace the text already in the consultation.
                      </p>
                    )}
                  </>
                )}
              </div>
            )
          })}

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  'flex items-center gap-2',
                  diagnoses.length > 0 ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has('diagnoses')}
                  disabled={diagnoses.length === 0}
                  onChange={() => toggle('diagnoses')}
                  className="size-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span className="text-[13px] font-semibold text-ink">
                  Possible diagnoses mentioned
                </span>
              </label>
              {diagnoses.length === 0 && <Badge>Not in transcript</Badge>}
            </div>

            {diagnoses.length === 0 ? (
              <p className="mt-1.5 text-xs text-ink-muted italic">{NOT_MENTIONED}</p>
            ) : (
              <div className="mt-2 space-y-2">
                {diagnoses.map((diagnosis, index) => (
                  <div
                    key={diagnosis.id}
                    className="rounded-control border border-line bg-surface-alt p-2.5"
                  >
                    <Textarea
                      label={`Diagnosis ${index + 1}`}
                      rows={2}
                      value={diagnosis.name}
                      onChange={(event) =>
                        setDiagnoses((current) =>
                          current.map((item, position) =>
                            position === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <p className="mt-1.5 text-[11px] text-ink-muted">{diagnosis.notes}</p>
                  </div>
                ))}
                <p className="text-[11px] text-ink-muted">
                  Applying adds these to the consultation's diagnosis list; existing
                  entries are kept.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

function emptyText(): Record<TextSectionKey, string> {
  return {
    chiefComplaint: '',
    historyOfPresentIllness: '',
    examination: '',
    clinicalNotes: '',
    followUpInstructions: '',
  }
}
