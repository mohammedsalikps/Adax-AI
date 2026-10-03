import http from 'node:http'
import type net from 'node:net'
import { AiProviderError, type SpeechHealth, type SpeechResult, type SpeechSegment, type Transcriber } from '../src/ai/providers.ts'

const WEIGHTS = 'a'.repeat(64)

/**
 * An in-process stand-in for the local speech model, for the tests of everything around it (recording, storage, review). It is a test
 * double, labelled as such: it says only what a test told it to say, and the product never fakes speech output.
 */
export class FakeTranscriber implements Transcriber {
  readonly provider = 'fake-speech'
  readonly model = 'fake-speech-model'
  readonly local = true as const
  /** Transcriptions done (successful ones). */
  n = 0
  failNext = false
  ready = true
  reason: string | null = null
  language: string | null = 'en'
  /** What the nth transcription says; the default is one line, "part N words". */
  script: ((n: number) => SpeechSegment[]) | null = null
  calls: { bytes: number; language: string | null | undefined; mime: string }[] = []
  /** Runs while a transcription is in progress (a test changes the world under it, as a slow model lets real life do). */
  hook: (() => Promise<void>) | null = null

  async transcribe(audio: Buffer, mime: string, _filename: string, opts: { language?: string | null } = {}): Promise<SpeechResult> {
    this.calls.push({ bytes: audio.length, language: opts.language, mime })
    if (this.failNext) {
      this.failNext = false
      throw new AiProviderError('unreachable', 'The local speech service could not be reached.', true)
    }
    await this.hook?.()
    this.n++
    const segments = this.script?.(this.n) ?? [{ startMs: 0, endMs: 1500, text: `part ${this.n} words`, confidence: 0.9, avgLogprob: -0.1, noSpeechProb: 0.01 }]
    return { segments, language: this.language, languageProbability: 0.99, languageSource: 'detected', durationMs: 20_000, model: { id: this.model, runtime: 'fake-runtime 1', computeType: 'int8', weightsSha256: WEIGHTS, local: true }, speakers: 'not_identified' }
  }

  async health(): Promise<SpeechHealth> {
    return this.ready ? { state: 'ready', reason: null, model: { id: this.model, runtime: 'fake-runtime 1', weightsSha256: WEIGHTS } } : { state: 'unavailable', reason: this.reason ?? 'The local speech service is not running.', model: null }
  }
}

export interface SpeechStub {
  url: string
  requests: { method: string; url: string; body: string; headers: http.IncomingHttpHeaders }[]
  /** The next replies, by path. */
  reply: { health: { status: number; body: unknown }; transcribe: { status: number; body: unknown } }
  close(): Promise<void>
}

/** A loopback HTTP server that speaks the local speech service's protocol and records what it was sent. Tests only. */
export async function startSpeechStub(): Promise<SpeechStub> {
  const stub: SpeechStub = {
    url: '',
    requests: [],
    reply: {
      health: { status: 200, body: { service: 'speech', status: 'ready', model: { id: 'stub-model', runtime: 'stub-runtime', computeType: 'int8', weightsSha256: WEIGHTS, local: true } } },
      transcribe: {
        status: 200,
        body: {
          model: { id: 'stub-model', runtime: 'stub-runtime', computeType: 'int8', weightsSha256: WEIGHTS, local: true },
          language: 'en',
          languageProbability: 0.98,
          languageSource: 'detected',
          durationMs: 5000,
          confidenceKind: 'mean_token_probability',
          speakers: 'not_identified',
          segments: [
            { startMs: 0, endMs: 2100, text: 'I have had a fever for three days.', avgLogprob: -0.12, noSpeechProb: 0.01, confidence: 0.887 },
            { startMs: 2100, endMs: 4800, text: 'I am allergic to penicillin.', avgLogprob: -0.12, noSpeechProb: 0.01, confidence: 0.887 },
          ],
        },
      },
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      stub.requests.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('latin1'), headers: req.headers })
      const r = req.url === '/health' ? stub.reply.health : req.url === '/v1/transcribe' ? stub.reply.transcribe : { status: 404, body: { error: 'not_found' } }
      res.writeHead(r.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(r.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  stub.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  return stub
}

/** Multipart body for an audio upload (fields first, then the file), as the browser sends it. */
export function multipartAudio(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = '----speechtest'
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
