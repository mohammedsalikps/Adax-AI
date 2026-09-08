import { useCallback, useEffect, useRef, useState } from 'react'
import { getTranscriptScript } from '@/mock/transcripts'
import { createId } from '@/lib/ids'
import type { TranscriptLine, TranscriptionStatus } from '@/types/consultation'

/** How quickly scripted lines arrive while "recording". */
const LINE_INTERVAL_MS = 1500
/** How long the simulated recogniser takes after recording stops. */
const PROCESSING_MS = 1200

export interface TranscriptionController {
  status: TranscriptionStatus
  lines: TranscriptLine[]
  error: string | null
  /** Milliseconds of simulated recording elapsed. */
  elapsedMs: number
  /**
   * Wall-clock time the recording first started, so each line can be shown at
   * the time of day it was spoken. Null until recording begins.
   */
  startedAt: Date | null
  /** True once every scripted line has been emitted. */
  scriptExhausted: boolean
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  clear: () => void
  setLines: (lines: TranscriptLine[]) => void
  addLine: (speaker: TranscriptLine['speaker']) => void
  updateLine: (id: string, text: string) => void
  removeLine: (id: string) => void
  /** Loads a persisted transcript without replaying the recording. */
  hydrate: (lines: TranscriptLine[]) => void
  markDraftReady: () => void
  fail: (message: string) => void
  dismissError: () => void
}

/**
 * Simulated transcription session.
 *
 * NO audio is captured and no speech recognition runs. Scripted lines from
 * the mock layer are emitted on a timer to exercise the real interface
 * states — recording, paused, processing, ready and error.
 */
export function useTranscription(patientId: string): TranscriptionController {
  const [status, setStatus] = useState<TranscriptionStatus>('not_started')
  const [lines, setLinesState] = useState<TranscriptLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [startedAt, setStartedAt] = useState<Date | null>(null)

  // Position in the script, held in a ref so the interval callback always
  // reads the current value without re-subscribing.
  const cursorRef = useRef(0)
  const scriptRef = useRef<TranscriptLine[] | null>(null)
  const [scriptExhausted, setScriptExhausted] = useState(false)

  const getScript = useCallback(() => {
    scriptRef.current ??= getTranscriptScript(patientId)
    return scriptRef.current
  }, [patientId])

  // Mirrors `lines` for timer callbacks, which must not read stale state.
  const linesRef = useRef<TranscriptLine[]>([])
  useEffect(() => {
    linesRef.current = lines
  })

  // Emit scripted lines while recording.
  useEffect(() => {
    if (status !== 'recording') return

    const timer = window.setInterval(() => {
      const script = getScript()
      if (cursorRef.current >= script.length) {
        setScriptExhausted(true)
        return
      }
      const next = script[cursorRef.current]
      cursorRef.current += 1
      setLinesState((current) => [...current, { ...next, offsetMs: current.length * LINE_INTERVAL_MS }])
      setElapsedMs((current) => current + LINE_INTERVAL_MS)
    }, LINE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [status, getScript])

  // Finish the simulated recognition pass after recording stops.
  useEffect(() => {
    if (status !== 'processing') return

    const timer = window.setTimeout(() => {
      if (linesRef.current.length === 0) {
        setError('No speech was captured. Start recording again, or add lines manually.')
        setStatus('error')
      } else {
        setStatus('transcript_ready')
      }
    }, PROCESSING_MS)

    return () => window.clearTimeout(timer)
  }, [status])

  const start = useCallback(() => {
    setError(null)
    // Resuming after a pause keeps the original start time.
    setStartedAt((current) => current ?? new Date())
    setStatus('recording')
  }, [])

  const pause = useCallback(() => setStatus('paused'), [])
  const resume = useCallback(() => setStatus('recording'), [])
  const stop = useCallback(() => setStatus('processing'), [])

  const clear = useCallback(() => {
    cursorRef.current = 0
    setScriptExhausted(false)
    setLinesState([])
    setElapsedMs(0)
    setStartedAt(null)
    setError(null)
    setStatus('not_started')
  }, [])

  const setLines = useCallback((next: TranscriptLine[]) => setLinesState(next), [])

  const hydrate = useCallback((next: TranscriptLine[]) => {
    if (next.length === 0) return
    cursorRef.current = Number.MAX_SAFE_INTEGER
    setScriptExhausted(true)
    setLinesState(next)
    setElapsedMs(next.length * LINE_INTERVAL_MS)
    // A restored transcript carries no wall-clock start, so lines fall back
    // to their offset from the beginning of the recording.
    setStartedAt(null)
    setStatus('transcript_ready')
  }, [])

  const addLine = useCallback((speaker: TranscriptLine['speaker']) => {
    setLinesState((current) => [
      ...current,
      {
        id: createId('tl'),
        speaker,
        text: '',
        offsetMs: current.length * LINE_INTERVAL_MS,
        isFinal: true,
        confidence: 1,
      },
    ])
    setStatus((current) => (current === 'not_started' ? 'transcript_ready' : current))
  }, [])

  const updateLine = useCallback((id: string, text: string) => {
    setLinesState((current) =>
      current.map((line) => (line.id === id ? { ...line, text } : line)),
    )
  }, [])

  const removeLine = useCallback((id: string) => {
    setLinesState((current) => current.filter((line) => line.id !== id))
  }, [])

  const markDraftReady = useCallback(() => setStatus('draft_ready'), [])

  const fail = useCallback((message: string) => {
    setError(message)
    setStatus('error')
  }, [])

  const dismissError = useCallback(() => {
    setError(null)
    setStatus((current) => (current === 'error' ? 'transcript_ready' : current))
  }, [])

  return {
    status,
    lines,
    error,
    elapsedMs,
    startedAt,
    scriptExhausted,
    start,
    pause,
    resume,
    stop,
    clear,
    setLines,
    addLine,
    updateLine,
    removeLine,
    hydrate,
    markDraftReady,
    fail,
    dismissError,
  }
}
