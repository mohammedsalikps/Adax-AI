import { z } from 'zod'
import { AiProviderError, type SpeechHealth, type SpeechResult, type SpeechSegment, type Transcriber } from './providers.ts'

/**
 * Speech-to-text by the local speech service (services/speech: faster-whisper on this machine). This is the only speech provider: there is no
 * hosted option and nothing falls back to one. The audio goes to a loopback address and nowhere else; the response is validated, not trusted.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** Whether `url` points at this machine (or the operator said, with SPEECH_ALLOW_NON_LOOPBACK, that another host is theirs). */
export function speechUrlProblem(url: string, allowNonLoopback: boolean): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'SPEECH_URL is not a valid URL.'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'SPEECH_URL must be an http or https address.'
  if (u.username || u.password) return 'SPEECH_URL must not contain credentials.'
  if (!allowNonLoopback && !LOOPBACK.has(u.hostname)) return 'SPEECH_URL must point at this machine (127.0.0.1). Patient audio is not sent to another host unless SPEECH_ALLOW_NON_LOOPBACK=true is set on purpose.'
  return null
}

const Finite = z.number().refine(Number.isFinite)
const ModelInfo = z.object({
  id: z.string().min(1).max(200),
  runtime: z.string().min(1).max(300),
  computeType: z.string().nullable().optional(),
  weightsSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  local: z.literal(true),
})
const RawSegment = z.object({
  startMs: Finite,
  endMs: Finite,
  text: z.string(),
  avgLogprob: Finite.nullable().optional(),
  noSpeechProb: Finite.nullable().optional(),
  confidence: Finite.nullable().optional(),
})
const SpeechResponse = z.object({
  model: ModelInfo,
  language: z.string().max(12).nullable(),
  languageProbability: Finite.nullable(),
  languageSource: z.enum(['detected', 'hint']),
  durationMs: Finite,
  segments: z.array(RawSegment).max(10_000),
})
const HealthResponse = z.object({
  status: z.enum(['ready', 'loading', 'unavailable', 'failed']),
  reason: z.string().max(400).optional(),
  model: ModelInfo.partial().optional(),
})

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const MAX_SEGMENT_CHARS = 4000
const MAX_SEGMENTS = 5000
const HEALTH_TTL_MS = 4000

/** Times and text as the model reported them, made safe to store: ordered, non-negative, inside the audio, free of control characters. */
export function normaliseSegments(raw: z.infer<typeof RawSegment>[], durationMs: number): SpeechSegment[] {
  const limit = Math.max(0, durationMs) + 2000
  const out: SpeechSegment[] = []
  for (const s of raw) {
    const text = s.text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEGMENT_CHARS)
    if (!text) continue
    const startMs = Math.min(limit, Math.max(0, Math.round(s.startMs)))
    const endMs = Math.min(limit, Math.max(startMs, Math.round(s.endMs)))
    const c = s.confidence
    out.push({
      startMs,
      endMs,
      text,
      // Kept only if it is a probability: a value outside 0..1 is not one, and is not "fixed" into one.
      confidence: c != null && c >= 0 && c <= 1 ? Math.round(c * 1000) / 1000 : null,
      avgLogprob: s.avgLogprob ?? null,
      noSpeechProb: s.noSpeechProb != null && s.noSpeechProb >= 0 && s.noSpeechProb <= 1 ? s.noSpeechProb : null,
    })
  }
  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  return out.slice(0, MAX_SEGMENTS)
}

/** A line the model itself says is very probably not speech, and scores low, is noise it made words of: it is not stored as if someone had said it. */
export const isLikelyNonSpeech = (x: { noSpeechProb: number | null; confidence: number | null }): boolean => x.noSpeechProb !== null && x.noSpeechProb >= 0.9 && (x.confidence ?? 0) < 0.5

export class LocalSpeechTranscriber implements Transcriber {
  readonly provider = 'local-speech'
  /** On this machine, unless the operator pointed it at another host on purpose (SPEECH_ALLOW_NON_LOOPBACK): then the screens say where it is. */
  readonly local: boolean
  readonly host: string
  /** The model the service reported most recently; "faster-whisper-small" until it has answered. */
  model = 'local speech model'
  private readonly url: string
  private cached: { at: number; value: SpeechHealth } | null = null

  constructor(cfg: { url: string; allowNonLoopback?: boolean }) {
    const problem = speechUrlProblem(cfg.url, cfg.allowNonLoopback ?? false)
    if (problem) throw new Error(problem)
    this.url = cfg.url.replace(/\/+$/, '')
    this.local = speechUrlProblem(cfg.url, false) === null
    this.host = new URL(cfg.url).host
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string, opts: { language?: string | null } = {}): Promise<SpeechResult> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename)
    if (opts.language) form.append('language', opts.language)
    let res: Response
    try {
      // `redirect: 'error'`: a reply that tries to send the audio on to another address is a failure, not a hop.
      res = await fetch(`${this.url}/v1/transcribe`, { method: 'POST', body: form, headers: { 'x-adaxai-local': '1' }, redirect: 'error', signal: AbortSignal.timeout(180_000) })
    } catch (e) {
      this.cached = null
      if (e instanceof Error && e.name === 'TimeoutError') throw new AiProviderError('timeout', 'The local speech service took too long on this recording (it is still running on this computer). You can retry; a very long recording may need to be split.', true)
      throw new AiProviderError('unreachable', 'The local speech service could not be reached. Start it with "npm run speech:dev".', true)
    }
    if (res.status === 503) throw new AiProviderError('stt_unavailable', 'The local speech service is not ready yet (its model is still loading or missing).', true)
    if (res.status === 413) throw new AiProviderError('too_large', 'The recording is too large for the local speech service.')
    if (res.status === 415) throw new AiProviderError('unsupported_media', 'The local speech service does not read this kind of file as audio.')
    if (res.status === 429) throw new AiProviderError('busy', 'The local speech service is busy with other recordings. Try again in a moment.', true)
    if (res.status === 422) throw new AiProviderError('undecodable_audio', 'The recording could not be read as audio.')
    if (res.status === 400) throw new AiProviderError('invalid_language', 'The local speech model does not know that language.')
    if (!res.ok) throw new AiProviderError(`api_${res.status}`, 'The local speech service returned an error.', res.status >= 500)
    const parsed = SpeechResponse.safeParse(await res.json().catch(() => null))
    if (!parsed.success) throw new AiProviderError('invalid_output', 'The local speech service answered in a form that could not be read.', true)
    const b = parsed.data
    this.model = b.model.id
    return {
      segments: normaliseSegments(b.segments, b.durationMs),
      language: b.language,
      languageProbability: b.languageProbability != null && b.languageProbability >= 0 && b.languageProbability <= 1 ? b.languageProbability : null,
      languageSource: b.languageSource,
      durationMs: Math.max(0, Math.round(b.durationMs)),
      model: { id: b.model.id, runtime: b.model.runtime, computeType: b.model.computeType ?? null, weightsSha256: b.model.weightsSha256, local: true },
      speakers: 'not_identified',
    }
  }

  /** Asks the service whether it can transcribe right now. Cached for a few seconds so a polling screen does not hammer it. */
  async health(): Promise<SpeechHealth> {
    if (this.cached && Date.now() - this.cached.at < HEALTH_TTL_MS) return this.cached.value
    let value: SpeechHealth
    try {
      const res = await fetch(`${this.url}/health`, { redirect: 'error', signal: AbortSignal.timeout(2500) })
      const body = res.ok ? HealthResponse.safeParse(await res.json().catch(() => null)) : null
      if (!body?.success) value = { state: 'unavailable', reason: 'The local speech service answered, but not as expected.', model: null }
      else {
        const m = body.data.model
        if (m?.id) this.model = m.id
        value = {
          state: body.data.status === 'failed' ? 'unavailable' : body.data.status,
          reason: body.data.status === 'ready' ? null : (body.data.reason ?? 'The speech model is not ready.'),
          model: m?.id ? { id: m.id, runtime: m.runtime ?? null, weightsSha256: m.weightsSha256 ?? null } : null,
        }
      }
    } catch {
      value = { state: 'unavailable', reason: 'The local speech service is not running. Start it with "npm run speech:dev".', model: null }
    }
    this.cached = { at: Date.now(), value }
    return value
  }
}
