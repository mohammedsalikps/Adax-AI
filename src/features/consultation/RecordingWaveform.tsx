import { cn } from '@/lib/cn'

const BAR_COUNT = 64

/**
 * Deterministic pseudo-random bar heights. A fixed pattern keeps the shape
 * stable across renders, so the waveform does not reshuffle on every state
 * change the way Math.random() would.
 */
const BARS = Array.from({ length: BAR_COUNT }, (_, index) => {
  const wave = Math.sin(index * 0.7) * Math.cos(index * 0.29) * Math.sin(index * 1.7)
  return {
    height: 0.2 + Math.abs(wave) * 0.8,
    // Staggered so the row reads as a travelling wave rather than every bar
    // pulsing in unison.
    delay: (index % 11) * 90,
  }
})

export interface RecordingWaveformProps {
  /** Bars animate only while the simulated recording is running. */
  active: boolean
  /** Dimmed-but-present state for a paused or finished recording. */
  idle?: boolean
  className?: string
}

/**
 * Decorative recording indicator.
 *
 * IMPORTANT: this visualises nothing. No microphone is opened and no audio is
 * captured anywhere in this application, so there is no signal to draw — the
 * bars are a fixed pattern that animates while the simulated recording runs.
 *
 * It is aria-hidden on purpose: announcing it would imply a real audio signal.
 * Recording state reaches assistive tech through the status badge and its
 * live region instead.
 */
export function RecordingWaveform({
  active,
  idle = false,
  className,
}: RecordingWaveformProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex h-14 w-full items-center justify-between gap-px overflow-hidden rounded-control px-1',
        className,
      )}
    >
      {BARS.map(({ height, delay }, index) => (
        <span
          key={index}
          className={cn(
            'w-full min-w-[2px] rounded-full',
            active ? 'wave-bar bg-accent' : idle ? 'bg-line-strong' : 'bg-line',
          )}
          style={{
            height: `${(active ? height : height * 0.45) * 100}%`,
            animationDelay: active ? `${delay}ms` : undefined,
            opacity: active ? 0.5 + height * 0.5 : 0.75,
          }}
        />
      ))}
    </div>
  )
}
