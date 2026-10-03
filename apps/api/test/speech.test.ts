import http from 'node:http'
import type net from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AiProviderError } from '../src/ai/providers.ts'
import { LocalSpeechTranscriber, normaliseSegments, speechUrlProblem } from '../src/ai/stt.ts'
import { startSpeechStub, type SpeechStub } from './speech-support.ts'

// The adapter to the local speech service, against a loopback stand-in that speaks its protocol.
// Everything here is local: the only addresses these tests ever open are 127.0.0.1 ones.

let stub: SpeechStub
beforeAll(async () => {
  stub = await startSpeechStub()
})
afterAll(() => stub.close())
afterEach(() => {
  stub.requests.length = 0
})

const AUDIO = Buffer.from('RIFF-not-really-audio')

describe('where the audio may go', () => {
  it.each([
    ['http://127.0.0.1:8002', false, null],
    ['http://localhost:8002', false, null],
    ['http://[::1]:8002', false, null],
    ['http://192.168.1.20:8002', false, /this machine/],
    ['https://speech.example.com', false, /this machine/],
    ['http://192.168.1.20:8002', true, null],
    ['ftp://127.0.0.1', false, /http or https/],
    ['http://user:pass@127.0.0.1:8002', false, /credentials/],
    ['not a url', false, /valid URL/],
  ])('%s (non-loopback allowed: %s)', (url, allow, problem) => {
    const got = speechUrlProblem(url, allow)
    if (problem === null) expect(got).toBeNull()
    else expect(got).toMatch(problem)
  })

  it('refuses to be built for another host, so no code path can send audio there', () => {
    expect(() => new LocalSpeechTranscriber({ url: 'https://api.openai.com/v1' })).toThrow(/this machine/)
    expect(() => new LocalSpeechTranscriber({ url: 'https://speech.example.com' })).toThrow()
  })
})

describe('transcribing', () => {
  it('posts the audio as multipart to /v1/transcribe with no credentials, and reads timestamped, language-tagged segments', async () => {
    const t = new LocalSpeechTranscriber({ url: stub.url })
    const out = await t.transcribe(AUDIO, 'audio/webm', 'audio.webm')
    const sent = stub.requests.at(-1)!
    expect(sent.method).toBe('POST')
    expect(sent.url).toBe('/v1/transcribe')
    expect(sent.headers.authorization).toBeUndefined()
    expect(sent.headers['content-type']).toMatch(/^multipart\/form-data/)
    expect(sent.body).toContain('name="file"')
    expect(sent.body).toContain('RIFF-not-really-audio')
    expect(sent.body).not.toContain('name="language"')
    expect(out.language).toBe('en')
    expect(out.languageSource).toBe('detected')
    expect(out.speakers).toBe('not_identified')
    expect(out.segments.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [0, 2100, 'I have had a fever for three days.'],
      [2100, 4800, 'I am allergic to penicillin.'],
    ])
    expect(out.segments[0]).toMatchObject({ confidence: 0.887, avgLogprob: -0.12, noSpeechProb: 0.01 })
    expect(out.model).toMatchObject({ id: 'stub-model', runtime: 'stub-runtime', local: true })
    expect(t.model).toBe('stub-model')
  })

  it('sends a language hint only when one is given', async () => {
    const t = new LocalSpeechTranscriber({ url: stub.url })
    await t.transcribe(AUDIO, 'audio/webm', 'a.webm', { language: 'hi' })
    expect(stub.requests.at(-1)!.body).toContain('name="language"')
    expect(stub.requests.at(-1)!.body).toContain('hi')
  })

  it.each([
    [503, { error: 'model_loading' }, 'stt_unavailable', true],
    [413, { error: 'too_large' }, 'too_large', false],
    [422, { error: 'undecodable_audio' }, 'undecodable_audio', false],
    [400, { error: 'invalid_language' }, 'invalid_language', false],
    [500, { error: 'internal_error' }, 'api_500', true],
    [404, { error: 'x' }, 'api_404', false],
  ])('maps a %s reply to %s without passing on the service’s own words', async (status, body, code, retryable) => {
    stub.reply.transcribe = { status, body }
    const t = new LocalSpeechTranscriber({ url: stub.url })
    const err = await t.transcribe(AUDIO, 'audio/webm', 'a.webm').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiProviderError)
    expect(err).toMatchObject({ code, retryable })
  })

  it('does not trust the shape of a reply: unreadable or out-of-range answers fail, and numbers are cleaned', async () => {
    const t = new LocalSpeechTranscriber({ url: stub.url })
    stub.reply.transcribe = { status: 200, body: { language: 'en' } }
    await expect(t.transcribe(AUDIO, 'audio/webm', 'a.webm')).rejects.toMatchObject({ code: 'invalid_output' })
    // A model that is not marked as local is refused outright.
    stub.reply.transcribe = { status: 200, body: { model: { id: 'x', runtime: 'y', weightsSha256: null, local: false }, language: 'en', languageProbability: 1, languageSource: 'detected', durationMs: 1000, segments: [] } }
    await expect(t.transcribe(AUDIO, 'audio/webm', 'a.webm')).rejects.toMatchObject({ code: 'invalid_output' })
  })

  it('fails (and does not follow) a reply that redirects the audio elsewhere', async () => {
    const other = http.createServer((_req, res) => res.end('{}'))
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r))
    const redirecting = http.createServer((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${(other.address() as net.AddressInfo).port}/` })
      res.end()
    })
    await new Promise<void>((r) => redirecting.listen(0, '127.0.0.1', r))
    try {
      const t = new LocalSpeechTranscriber({ url: `http://127.0.0.1:${(redirecting.address() as net.AddressInfo).port}` })
      await expect(t.transcribe(AUDIO, 'audio/webm', 'a.webm')).rejects.toMatchObject({ code: 'unreachable' })
    } finally {
      await new Promise((r) => redirecting.close(r))
      await new Promise((r) => other.close(r))
    }
  })

  it('says the service is unreachable when nothing is listening', async () => {
    const dead = http.createServer()
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r))
    const port = (dead.address() as net.AddressInfo).port
    await new Promise((r) => dead.close(r))
    const t = new LocalSpeechTranscriber({ url: `http://127.0.0.1:${port}` })
    await expect(t.transcribe(AUDIO, 'audio/webm', 'a.webm')).rejects.toMatchObject({ code: 'unreachable', retryable: true })
    expect(await t.health()).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('not running') })
  })
})

describe('health', () => {
  it('reports ready with the model, caches for a few seconds, and says why when it is not', async () => {
    const t = new LocalSpeechTranscriber({ url: stub.url })
    expect(await t.health()).toMatchObject({ state: 'ready', reason: null, model: { id: 'stub-model', runtime: 'stub-runtime' } })
    await t.health()
    expect(stub.requests.filter((r) => r.url === '/health')).toHaveLength(1)

    stub.reply.health = { status: 200, body: { status: 'loading', reason: 'The speech model is still loading.', model: { id: 'stub-model' } } }
    const fresh = new LocalSpeechTranscriber({ url: stub.url })
    expect(await fresh.health()).toMatchObject({ state: 'loading', reason: 'The speech model is still loading.' })
    stub.reply.health = { status: 200, body: { status: 'failed', reason: 'The model could not be loaded (RuntimeError).' } }
    expect(await new LocalSpeechTranscriber({ url: stub.url }).health()).toMatchObject({ state: 'unavailable' })
    stub.reply.health = { status: 500, body: { error: 'x' } }
    expect(await new LocalSpeechTranscriber({ url: stub.url }).health()).toMatchObject({ state: 'unavailable' })
  })
})

describe('segments are made safe to store', () => {
  const seg = (text: string, startMs: number, endMs: number, confidence: number | null = 0.9) => ({ text, startMs, endMs, confidence, avgLogprob: -0.1, noSpeechProb: 0.01 })

  it('orders by time, drops empty lines, trims, and removes control characters', () => {
    const out = normaliseSegments([seg('  later ', 3000, 4000), seg('first\u0000\u0007 line', 0, 1000), seg('   ', 1000, 2000)], 5000)
    expect(out.map((s) => s.text)).toEqual(['first line', 'later'])
  })

  it('keeps times inside the audio and never lets an end precede its start', () => {
    const out = normaliseSegments([seg('a', -500, 100), seg('b', 900, 400), seg('c', 4000, 99_000)], 5000)
    expect(out.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 100],
      [900, 900],
      [4000, 7000],
    ])
  })

  it('keeps a score only if it is a probability: it is not "fixed" into one', () => {
    const out = normaliseSegments([seg('a', 0, 1, 1.5), seg('b', 1, 2, -0.2), seg('c', 2, 3, 0.4251), seg('d', 3, 4, null)], 5000)
    expect(out.map((s) => s.confidence)).toEqual([null, null, 0.425, null])
  })

  it('caps the number and the length of lines', () => {
    const many = Array.from({ length: 6000 }, (_, i) => seg(`line ${i}`, i, i + 1))
    expect(normaliseSegments(many, 10_000)).toHaveLength(5000)
    expect(normaliseSegments([seg('x'.repeat(9000), 0, 1)], 5000)[0]!.text).toHaveLength(4000)
  })
})
