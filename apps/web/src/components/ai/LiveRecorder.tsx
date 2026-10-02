import { Radio, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage } from '../../lib/api.ts'
import type { AiResponse } from '../../lib/ai.ts'
import { Button } from '../ui/Button.tsx'

const MAX_S = 30 * 60

/**
 * Live recording in chunks: the recorder is restarted every `chunkSeconds`
 * so each chunk is a complete audio file, uploaded and transcribed while
 * recording continues. The configured provider returns only finished text
 * per chunk (no interim words), so parts still being processed are shown as
 * "transcribing", never as guessed text.
 */
export function LiveRecorder({ encounterId, chunkSeconds, onUpdate, disabled }: { encounterId: string; chunkSeconds: number; onUpdate: (r: AiResponse) => void; disabled: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'finishing'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [pending, setPending] = useState(0)
  const [sent, setSent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const transcriptId = useRef<string | null>(null)
  const index = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const active = useRef(false)
  /** Set when the server refuses a chunk for lack of consent: nothing more leaves the browser. */
  const blocked = useRef(false)
  const timers = useRef<ReturnType<typeof setInterval>[]>([])
  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const upload = (blob: Blob, i: number) => {
    if (blocked.current) return
    setPending((n) => n + 1)
    // Chunks are sent one at a time, in order.
    queue.current = queue.current.then(async () => {
      try {
        if (blocked.current) return
        const fd = new FormData()
        fd.append('chunkIndex', String(i))
        fd.append('file', blob, `chunk-${i}.webm`)
        onUpdate(await api<AiResponse>(`/transcripts/${transcriptId.current}/chunks`, { method: 'POST', body: fd }))
        setSent((n) => n + 1)
      } catch (e) {
        setError(errorMessage(e))
        // Consent withdrawn (or no longer valid): stop capturing audio at once, send nothing more,
        // close the live transcript (allowed without consent) and refresh the panel's consent state.
        if (e instanceof ApiError && e.code.startsWith('consent_')) {
          blocked.current = true
          stopAll()
          setState('idle')
          const tid = transcriptId.current
          if (tid) void api<AiResponse>(`/transcripts/${tid}/end`, { method: 'POST' }).then(onUpdate, () => undefined)
        }
      } finally {
        setPending((n) => n - 1)
      }
    })
  }

  const startChunk = () => {
    if (!stream.current || !active.current) return
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined)
    const parts: Blob[] = []
    const i = index.current++
    r.ondataavailable = (e) => e.data.size && parts.push(e.data)
    r.onstop = () => {
      const blob = new Blob(parts, { type: (r.mimeType || 'audio/webm').split(';')[0] })
      if (blob.size) upload(blob, i)
      if (active.current) startChunk()
    }
    recorder.current = r
    r.start()
  }

  const stopAll = () => {
    timers.current.forEach(clearInterval)
    timers.current = []
    active.current = false
    if (recorder.current?.state === 'recording') recorder.current.stop()
    stream.current?.getTracks().forEach((t) => t.stop())
  }
  useEffect(() => () => stopAll(), [])
  useEffect(() => {
    if (seconds >= MAX_S && state === 'recording') void finish()
  })

  const start = async () => {
    setError(null)
    blocked.current = false
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      const res = await api<AiResponse & { transcriptId: string }>(`/encounters/${encounterId}/live-transcripts`, { method: 'POST' })
      onUpdate(res)
      transcriptId.current = res.transcriptId
      index.current = 0
      setSent(0)
      setSeconds(0)
      active.current = true
      startChunk()
      timers.current.push(setInterval(() => setSeconds((s) => s + 1), 1000))
      // Close the current chunk every chunkSeconds; onstop starts the next one.
      timers.current.push(setInterval(() => recorder.current?.state === 'recording' && recorder.current.stop(), chunkSeconds * 1000))
      setState('recording')
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop())
      setError(e instanceof DOMException ? 'Microphone not available or permission denied.' : errorMessage(e))
    }
  }

  const finish = async () => {
    setState('finishing')
    stopAll()
    // Let the last chunk's onstop enqueue its upload, then wait for the queue.
    await new Promise((r) => setTimeout(r, 300))
    await queue.current
    try {
      onUpdate(await api<AiResponse>(`/transcripts/${transcriptId.current}/end`, { method: 'POST' }))
    } catch (e) {
      setError(errorMessage(e))
    }
    setState('idle')
  }

  if (!supported) return null
  return (
    <div className="space-y-2">
      {state === 'idle' ? (
        <Button size="sm" variant="secondary" icon={<Radio aria-hidden="true" className="size-4" />} onClick={() => void start()} disabled={disabled}>
          Start live transcription
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span role="status" className="inline-flex items-center gap-2 text-sm font-medium text-down">
            <span className="size-2.5 animate-pulse rounded-full bg-down" aria-hidden="true" />
            {state === 'finishing' ? 'Finishing…' : 'Live'} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · {sent} part{sent === 1 ? '' : 's'} transcribed{pending > 0 ? ` · ${pending} transcribing…` : ''}
          </span>
          {state === 'recording' && (
            <Button variant="danger" size="sm" icon={<Square aria-hidden="true" className="size-4" />} onClick={() => void finish()}>
              Stop live transcription
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-down">{error}</p>}
      <p className="text-xs text-ink-muted">Sent in {chunkSeconds}-second parts; each part appears when its transcription is finished. Audio is stored with the consultation.</p>
    </div>
  )
}
