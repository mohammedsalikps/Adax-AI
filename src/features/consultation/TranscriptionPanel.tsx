import {
  CircleStop,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Stethoscope,
  Trash2,
  TriangleAlert,
  User,
} from 'lucide-react'
import { Badge, Button, EmptyState, LoadingState, Panel } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { TranscriptLine, TranscriptionStatus } from '@/types/consultation'
import { formatClockTime } from '@/lib/format'
import { RecordingWaveform } from './RecordingWaveform'
import { StepTitle } from './StepTitle'
import type { TranscriptionController } from './useTranscription'

const STATUS_LABEL: Record<TranscriptionStatus, string> = {
  not_started: 'Not started',
  recording: 'Recording',
  paused: 'Paused',
  processing: 'Processing',
  transcript_ready: 'Transcript ready',
  draft_ready: 'Draft ready',
  error: 'Error',
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export interface TranscriptionPanelProps {
  transcription: TranscriptionController
  savingTranscript: boolean
  onSaveTranscript: () => void
  /** Position in the consultation workflow, shown beside the title. */
  step: number
  /** Read-only while a completed consultation is being reviewed. */
  locked?: boolean
}

/**
 * Simulated transcription workspace. No microphone is accessed and no
 * speech recognition runs — scripted lines are replayed on a timer.
 */
export function TranscriptionPanel({
  transcription,
  savingTranscript,
  onSaveTranscript,
  step,
  locked = false,
}: TranscriptionPanelProps) {
  const { status, lines, error, elapsedMs, startedAt } = transcription
  const isRecording = status === 'recording'
  const isPaused = status === 'paused'
  const isProcessing = status === 'processing'
  const canEdit = !isRecording && !isProcessing && !locked

  return (
    <Panel
      title={<StepTitle step={step}>Consultation recording</StepTitle>}
      description="Simulated transcription — no audio is captured"
      icon={Mic}
      actions={
        <div className="flex items-center gap-2">
          <span className="tnum text-[11px] text-ink-muted">{formatElapsed(elapsedMs)}</span>
          <Badge
            variant={
              status === 'error'
                ? 'critical'
                : isRecording
                  ? 'critical'
                  : isPaused || isProcessing
                    ? 'caution'
                    : status === 'not_started'
                      ? 'neutral'
                      : 'normal'
            }
            dot={isRecording}
          >
            {STATUS_LABEL[status]}
          </Badge>
        </div>
      }
    >
      {/* Announced politely so the recording state reaches screen readers. */}
      <p role="status" aria-live="polite" className="sr-only">
        {`Transcription ${STATUS_LABEL[status]}. ${lines.length} lines captured.`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {!isRecording && !isPaused && (
          <Button
            icon={Mic}
            size="sm"
            disabled={isProcessing || locked}
            onClick={transcription.start}
          >
            {lines.length > 0 ? 'Resume recording' : 'Start recording'}
          </Button>
        )}
        {isRecording && (
          <Button icon={Pause} size="sm" variant="secondary" onClick={transcription.pause}>
            Pause
          </Button>
        )}
        {isPaused && (
          <Button icon={Play} size="sm" onClick={transcription.resume}>
            Resume
          </Button>
        )}
        {(isRecording || isPaused) && (
          <Button icon={CircleStop} size="sm" variant="danger" onClick={transcription.stop}>
            Stop
          </Button>
        )}

        <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />

        <Button
          size="sm"
          variant="ghost"
          icon={Save}
          loading={savingTranscript}
          disabled={!canEdit || lines.length === 0}
          onClick={onSaveTranscript}
        >
          Save transcript
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCcw}
          disabled={!canEdit || lines.length === 0}
          onClick={transcription.clear}
        >
          Clear
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-control border border-critical/30 bg-critical-soft px-3 py-2.5"
        >
          <TriangleAlert size={15} className="mt-px shrink-0 text-critical" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-critical">{error}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={transcription.dismissError}>
            Dismiss
          </Button>
        </div>
      )}

      <RecordingWaveform
        className="mt-3"
        active={isRecording}
        idle={isPaused || lines.length > 0}
      />

      <div className="mt-3">
        {isProcessing ? (
          <LoadingState label="Processing the recording" />
        ) : lines.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Mic}
            title="No transcript yet"
            description="Start the simulated recording, or add transcript lines manually."
            className="rounded-control border border-dashed border-line"
          />
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
              <TranscriptRow
                key={line.id}
                line={line}
                startedAt={startedAt}
                editable={canEdit}
                onChange={(text) => transcription.updateLine(line.id, text)}
                onRemove={() => transcription.removeLine(line.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => transcription.addLine('doctor')}
          >
            Add doctor line
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => transcription.addLine('patient')}
          >
            Add patient line
          </Button>
        </div>
      )}
    </Panel>
  )
}

function TranscriptRow({
  line,
  startedAt,
  editable,
  onChange,
  onRemove,
}: {
  line: TranscriptLine
  /** Wall-clock start of the recording, or null for a restored transcript. */
  startedAt: Date | null
  editable: boolean
  onChange: (text: string) => void
  onRemove: () => void
}) {
  const isDoctor = line.speaker === 'doctor'
  const label = isDoctor ? 'Doctor' : 'Patient'
  const SpeakerIcon = isDoctor ? Stethoscope : User

  // Prefer the time of day the line was spoken. A transcript loaded back from
  // storage has no recorded start, so it falls back to the offset.
  const elapsed = formatElapsed(line.offsetMs)
  const timestamp = startedAt
    ? formatClockTime(new Date(startedAt.getTime() + line.offsetMs))
    : elapsed

  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
          isDoctor ? 'bg-accent text-ink-inverse' : 'bg-accent-soft text-accent-ink',
        )}
      >
        <SpeakerIcon size={14} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-[11px] font-semibold',
              isDoctor ? 'text-accent-ink' : 'text-ink-soft',
            )}
          >
            {label}
          </span>
          <span className="tnum ml-auto shrink-0 text-[10px] text-ink-muted">
            {timestamp}
          </span>
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={Trash2}
              aria-label={`Remove ${label} line at ${elapsed}`}
              onClick={onRemove}
            />
          )}
        </div>

        <label className="sr-only" htmlFor={`transcript-${line.id}`}>
          {`${label} line at ${elapsed}`}
        </label>
        <textarea
          id={`transcript-${line.id}`}
          rows={1}
          value={line.text}
          readOnly={!editable}
          placeholder="Empty line"
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'mt-0.5 min-h-8 w-full resize-y rounded-control border px-2.5 py-1.5 text-[13px] break-words transition-colors',
            isDoctor
              ? 'border-accent-soft bg-accent-soft/30'
              : 'border-line bg-surface-alt',
            editable
              ? 'hover:border-line-strong focus:border-accent'
              : 'cursor-default opacity-90',
          )}
        />
      </div>
    </li>
  )
}
