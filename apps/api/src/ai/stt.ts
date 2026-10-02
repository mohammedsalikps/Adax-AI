import { AiProviderError, type Transcriber } from './providers.ts'

/**
 * Speech-to-text through an OpenAI-compatible `POST {baseUrl}/audio/transcriptions`
 * endpoint (multipart: file, model, response_format=json -> { text }). Several
 * hosted and self-hosted services implement this interface; which one is used
 * is configuration (AI_STT_BASE_URL / AI_STT_MODEL / AI_STT_API_KEY).
 */
export class OpenAiCompatibleTranscriber implements Transcriber {
  readonly provider: string
  readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(cfg: { apiKey: string | undefined; baseUrl: string; model: string; providerName: string }) {
    if (!cfg.apiKey) throw new Error('STT API key missing')
    this.provider = cfg.providerName
    this.model = cfg.model
    this.baseUrl = cfg.baseUrl
    this.apiKey = cfg.apiKey
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string): Promise<{ text: string; requestId: string | null }> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename)
    form.append('model', this.model)
    form.append('response_format', 'json')
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}` }, body: form, signal: AbortSignal.timeout(180_000) })
    } catch {
      throw new AiProviderError('unreachable', 'The speech-to-text service could not be reached.', true)
    }
    const requestId = res.headers.get('x-request-id')
    if (res.status === 401 || res.status === 403) throw new AiProviderError('auth_failed', 'The speech-to-text service rejected the configured credentials.')
    if (res.status === 429) throw new AiProviderError('rate_limited', 'The speech-to-text service is busy. Try again in a minute.', true)
    if (res.status === 413) throw new AiProviderError('too_large', 'The recording is too large for the speech-to-text service.')
    if (!res.ok) throw new AiProviderError(`api_${res.status}`, 'The speech-to-text service returned an error.', res.status >= 500)
    const body = (await res.json().catch(() => null)) as { text?: unknown } | null
    if (!body || typeof body.text !== 'string') throw new AiProviderError('invalid_output', 'The speech-to-text response could not be read.', true)
    return { text: body.text, requestId }
  }
}
