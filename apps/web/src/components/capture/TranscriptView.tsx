import { SPEAKER_LABELS, type Transcript, type TranscriptSegment } from '@adaxai/contracts'
import { Check, ChevronDown, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { fmtOffset, languageName } from '../../lib/capture.ts'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Feedback.tsx'
import { Menu } from '../ui/Menu.tsx'

/** A model score below this is flagged: it is the mean probability the model gave its own words, not a chance that the text is right. */
export const LOW_SCORE = 0.5

const SPEAKER_CHIP: Record<string, string> = {
  Doctor: 'border-brand/30 bg-brand-soft text-brand-strong',
  Patient: 'border-notice/30 bg-notice-soft text-notice',
}
const CHIP_DEFAULT = 'border-line bg-canvas text-ink'

/**
 * Who spoke this line, as a control: the speech model identifies no speakers, so the doctor says. A line nobody has assigned says so, in
 * words and with a dashed outline; one the doctor assigned carries a tick. Changing it never changes the words.
 */
function SpeakerControl({ segment, canAssign, busy, onPick }: { segment: TranscriptSegment; canAssign: boolean; busy: boolean; onPick: (speaker: string) => void }) {
  const who = segment.speaker
  const assigned = segment.speakerSource === 'doctor_assigned'
  const cls = who ? (SPEAKER_CHIP[who] ?? CHIP_DEFAULT) : 'border-dashed border-ink-muted/50 bg-surface text-ink-muted'
  const body = (
    <>
      {assigned && <Check aria-hidden="true" className="size-3 shrink-0" />}
      <span>{who ?? 'Not assigned'}</span>
      {canAssign && <ChevronDown aria-hidden="true" className="size-3 shrink-0 opacity-70" />}
    </>
  )
  const chip = `inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold ${cls}`
  if (!canAssign) {
    return (
      <span className={chip} title={segment.speakerSource === 'typed_label' ? 'Typed label' : undefined}>
        {body}
      </span>
    )
  }
  return (
    <Menu
      label={`Speaker of ${segment.id}: ${who ?? 'not assigned'}. Change`}
      align="start"
      trigger={body}
      triggerClassName={`${chip} hover:brightness-95 disabled:opacity-60`}
      items={[
        ...SPEAKER_LABELS.map((l) => ({ label: l, onSelect: () => onPick(l), disabled: busy || l === who })),
        ...(who ? [{ label: 'Not assigned', onSelect: () => onPick('Unknown'), disabled: busy }] : []),
      ]}
    />
  )
}

/**
 * The raw transcript: what the system heard, line by line, each with where it starts on the recording, who spoke (as the doctor assigned),
 * the language the model detected and, only when it is low, a mark that the model itself was unsure. Typed lines have no times, language or
 * score. A part that is still being transcribed, or could not be, is shown as that and never as guessed text.
 */
export function TranscriptView({
  transcript,
  highlight,
  canAssign,
  assigning,
  onAssign,
  onRetry,
  retrying,
  follow,
}: {
  transcript: Transcript
  highlight: ReadonlySet<string>
  canAssign: boolean
  assigning: boolean
  onAssign: (segmentId: string, speaker: string) => void
  /** Retry the failed transcription of a part (the audio is saved). */
  onRetry?: (() => void) | undefined
  retrying?: boolean
  /** Keep the newest line in view (a recording in progress). */
  follow: boolean
}) {
  const end = useRef<HTMLLIElement>(null)
  const lastCount = useRef(0)
  useEffect(() => {
    if (follow && transcript.segments.length !== lastCount.current) end.current?.scrollIntoView?.({ block: 'nearest' })
    lastCount.current = transcript.segments.length
  }, [follow, transcript.segments.length])
  // A line chosen from an important point is brought into view.
  useEffect(() => {
    const first = [...highlight][0]
    if (first) document.getElementById(`line-${transcript.id}-${first}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, transcript.id])
  // Lines in time order, with the parts that have no text yet in their place on the timeline.
  type Row = { kind: 'line'; at: number; s: TranscriptSegment } | { kind: 'part'; at: number; index: number; status: 'received' | 'failed'; offsetMs: number }
  const rows: Row[] = [
    ...transcript.segments.map((s, i): Row => ({ kind: 'line', at: s.startMs ?? i, s })),
    ...transcript.chunks.filter((c) => c.status !== 'transcribed').map((c): Row => ({ kind: 'part', at: c.offsetMs, index: c.index, status: c.status as 'received' | 'failed', offsetMs: c.offsetMs })),
  ]
  rows.sort((a, b) => a.at - b.at)
  return (
    <ol aria-label="Transcript lines" className="max-h-[26rem] space-y-1 overflow-y-auto rounded-lg border border-line border-l-4 border-l-ink-muted/40 bg-canvas p-2" data-testid="raw-transcript">
      {rows.map((r) =>
        r.kind === 'line' ? (
          <li key={r.s.id} id={`line-${transcript.id}-${r.s.id}`} className={`rounded-md px-2 py-1.5 ${highlight.has(r.s.id) ? 'bg-ai-soft ring-1 ring-ai/40' : ''}`} data-testid="transcript-line">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs tabular-nums text-ink-muted" title={r.s.startMs != null ? `On the recording from ${fmtOffset(r.s.startMs)} to ${fmtOffset(r.s.endMs)}` : 'Typed: no time'}>
                {r.s.startMs != null ? fmtOffset(r.s.startMs) : '—'}
              </span>
              <SpeakerControl segment={r.s} canAssign={canAssign} busy={assigning} onPick={(speaker) => onAssign(r.s.id, speaker)} />
              {r.s.language && r.s.language !== transcript.language && <Badge>{languageName(r.s.language)}</Badge>}
              {r.s.confidence != null && r.s.confidence < LOW_SCORE && (
                <Badge tone="warn" icon={<TriangleAlert aria-hidden="true" className="size-3" />}>
                  <span title="The speech model was unsure of its own words here. Check this line against what was said.">Low model score</span>
                </Badge>
              )}
              <span className="ml-auto font-mono text-[0.6875rem] text-ink-muted">{r.s.id}</span>
            </div>
            <p className="mt-0.5 text-sm break-words">{r.s.text}</p>
          </li>
        ) : r.status === 'received' ? (
          <li key={`part-${r.index}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted" data-testid="transcript-part-pending">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            <span className="font-mono text-xs tabular-nums">{fmtOffset(r.offsetMs)}</span>
            Transcribing part {r.index + 1}…
          </li>
        ) : (
          <li key={`part-${r.index}`} className="flex flex-wrap items-center gap-2 rounded-md border border-down/30 bg-down-soft/40 px-2 py-1.5 text-sm" data-testid="transcript-part-failed">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-down" />
            <span className="font-mono text-xs tabular-nums">{fmtOffset(r.offsetMs)}</span>
            <span>Part {r.index + 1} could not be transcribed. The audio is saved.</span>
            {onRetry && (
              <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>
                Retry
              </Button>
            )}
          </li>
        ),
      )}
      <li ref={end} aria-hidden="true" />
    </ol>
  )
}
