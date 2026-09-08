import { Badge, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { TranscriptLine } from '@/types/consultation'

function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export interface TranscriptViewerProps {
  lines: TranscriptLine[]
  /** Read-only unless a caller explicitly enables editing. */
  editable?: boolean
  onChange?: (id: string, text: string) => void
  className?: string
}

/**
 * Read-only rendering of a saved transcript: speaker, timestamp,
 * recogniser confidence and text. Editing is off unless a caller opts in,
 * so opening a saved consultation can never alter it.
 */
export function TranscriptViewer({
  lines,
  editable = false,
  onChange,
  className,
}: TranscriptViewerProps) {
  if (lines.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="No transcript saved"
        description="This consultation has no recorded conversation."
        className={cn('rounded-control border border-dashed border-line', className)}
      />
    )
  }

  return (
    <ol className={cn('space-y-2', className)}>
      {lines.map((line) => {
        const isDoctor = line.speaker === 'doctor'
        const label = isDoctor ? 'Doctor' : 'Patient'
        const timestamp = formatOffset(line.offsetMs)
        const confidence = Math.round(line.confidence * 100)

        return (
          <li key={line.id} className="flex items-start gap-2.5">
            <div className="w-[74px] shrink-0 pt-0.5">
              <span
                className={cn(
                  'block text-[10px] font-semibold tracking-wider uppercase',
                  isDoctor ? 'text-accent-ink' : 'text-ink-soft',
                )}
              >
                {label}
              </span>
              <span className="tnum block text-[10px] text-ink-muted">{timestamp}</span>
              <span className="tnum block text-[10px] text-ink-muted">
                {confidence}% conf.
              </span>
            </div>

            {editable && onChange ? (
              <>
                <label className="sr-only" htmlFor={`saved-transcript-${line.id}`}>
                  {`${label} line at ${timestamp}`}
                </label>
                <textarea
                  id={`saved-transcript-${line.id}`}
                  rows={1}
                  value={line.text}
                  onChange={(event) => onChange(line.id, event.target.value)}
                  className={cn(
                    'min-h-9 flex-1 resize-y rounded-control border px-2.5 py-1.5 text-[13px] break-words',
                    isDoctor
                      ? 'border-accent-soft bg-accent-soft/30'
                      : 'border-line bg-surface-alt',
                    'hover:border-line-strong focus:border-accent',
                  )}
                />
              </>
            ) : (
              <p
                className={cn(
                  'flex-1 rounded-control border px-2.5 py-1.5 text-[13px] break-words',
                  isDoctor
                    ? 'border-accent-soft bg-accent-soft/30'
                    : 'border-line bg-surface-alt',
                )}
              >
                {line.text || <span className="text-ink-muted italic">Empty line</span>}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Summary chip pair used above a transcript. */
export function TranscriptMeta({ lines }: { lines: TranscriptLine[] }) {
  const doctorLines = lines.filter((line) => line.speaker === 'doctor').length

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>{lines.length} lines</Badge>
      <Badge variant="accent">{doctorLines} doctor</Badge>
      <Badge>{lines.length - doctorLines} patient</Badge>
    </div>
  )
}
