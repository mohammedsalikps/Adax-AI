import http from 'node:http'
import type net from 'node:net'
import { Encounter, EncounterAi, PatientDetail, type TranscriptSegment, Visit } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createAnthropicDrafter, NOTE_PROMPT_VERSION } from '../src/ai/anthropic.ts'
import { AiProviderError, type AiProviders, type NoteDrafter } from '../src/ai/providers.ts'
import { pseudonymize, segmentTranscript } from '../src/ai/text.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient, type TestContext } from './helpers.ts'
import { FakeTranscriber } from './speech-support.ts'

// --- Fakes for the external services (tests only; the product never fakes AI output) ---
class FakeDrafter implements NoteDrafter {
  readonly provider = 'fake'
  readonly model = 'fake-model'
  readonly promptVersion = 'test-v1'
  seen: TranscriptSegment[][] = []
  failWith: AiProviderError | null = null
  async draft(segments: TranscriptSegment[]) {
    this.seen.push(segments)
    if (this.failWith) throw this.failWith
    return {
      items: [
        { section: 'chiefComplaint' as const, text: 'Fever for three days.', sourceSegmentIds: ['S2'] },
        { section: 'plan' as const, text: 'Paracetamol advised.', sourceSegmentIds: ['S3', 'S99'] },
        { section: 'assessment' as const, text: 'Possible dengue.', sourceSegmentIds: ['S42'] },
      ],
      model: 'fake-model',
      inputTokens: 120,
      outputTokens: 40,
      requestId: 'req_test',
    }
  }
}
const speech = new FakeTranscriber()
speech.script = () => [
  { startMs: 0, endMs: 1800, text: 'What brings you in?', confidence: 0.9, avgLogprob: -0.1, noSpeechProb: 0.01 },
  { startMs: 1800, endMs: 4200, text: 'Cough for a week.', confidence: 0.8, avgLogprob: -0.2, noSpeechProb: 0.02 },
]
const noKeys = createTestApp()
const drafter = new FakeDrafter()
const withAi = createTestApp({ ai: { drafter, transcriber: speech, reasons: { llm: null, stt: null } } satisfies AiProviders })
let fx: Fixture

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(noKeys.db)
  drafter.seen = []
  drafter.failWith = null
})
afterAll(async () => {
  await noKeys.close()
  await withAi.close()
})

const TRANSCRIPT = 'Doctor: Good morning Lakshmi, your MRN is on the slip.\nPatient: I have had fever for three days. Call me on 98400 12345.\nDoctor: Take paracetamol and drink fluids.'

async function openEncounter(ctx: TestContext) {
  const nurse = await login(ctx.app, 't.nurse')
  const doctor = await login(ctx.app, 't.doctor')
  const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient() })).json())
  const v = Visit.parse((await call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId: p.id, departmentId: fx.departments.gen } })).json())
  const e = Encounter.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/encounter`, { cookie: doctor })).json())
  return { p, e, doctor, nurse }
}

function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = '----adaxaitest'
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
const upload = (ctx: TestContext, encounterId: string, cookie: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = {}) => {
  const m = multipart(fields, file)
  return ctx.app.inject({ method: 'POST', url: `/api/encounters/${encounterId}/audio`, headers: { ...m.headers, cookie, 'x-adaxai-csrf': '1' }, payload: m.payload })
}
const WAV = Buffer.from('RIFF$\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x40\x1f\0\0\x80\x3e\0\0\x02\0\x10\0data\0\0\0\0', 'binary')

describe('without configured providers', () => {
  it('reports AI as unavailable and never fabricates a draft', async () => {
    const { e, doctor } = await openEncounter(noKeys)
    const status = (await call(noKeys.app, 'GET', '/api/ai/status', { cookie: doctor })).json()
    expect(status.llm).toMatchObject({ available: false, model: null })
    expect(status.llm.reason).toMatch(/ANTHROPIC_API_KEY/)
    expect(status.stt).toMatchObject({ available: false, state: 'not_configured', local: true })
    expect(status.extraction).toMatchObject({ available: true, provider: 'adaxai-rules', local: true, languages: ['en'] })

    await call(noKeys.app, 'POST', `/api/encounters/${e.id}/ai-consent`, { cookie: doctor, body: { method: 'verbal' } })
    const ai = EncounterAi.parse((await call(noKeys.app, 'POST', `/api/encounters/${e.id}/transcripts`, { cookie: doctor, body: { text: TRANSCRIPT } })).json())
    const res = await call(noKeys.app, 'POST', `/api/transcripts/${ai.transcripts[0]!.id}/drafts`, { cookie: doctor })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('ai_unavailable')
    expect((await adminQuery('SELECT count(*)::int AS n FROM ai_draft_items')).rows[0].n).toBe(0)
  })

  it('stores uploaded audio and says transcription is unavailable', async () => {
    const { e, doctor } = await openEncounter(noKeys)
    await call(noKeys.app, 'POST', `/api/encounters/${e.id}/ai-consent`, { cookie: doctor, body: { method: 'verbal' } })
    const res = await upload(noKeys, e.id, doctor, { name: 'visit.wav', type: 'audio/wav', data: WAV })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.notice).toMatch(/Local transcription is not configured/)
    expect(body.audio).toHaveLength(1)
    expect(body.transcripts).toEqual([])
    const file = await call(noKeys.app, 'GET', `/api/files/${body.audio[0].fileId}`, { cookie: doctor })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('audio/wav')
    expect(file.headers['x-content-type-options']).toBe('nosniff')
    expect(file.rawPayload.equals(WAV)).toBe(true)
  })
})

describe('consent and access', () => {
  it('requires recorded consent before any recording or AI processing', async () => {
    const { e, doctor } = await openEncounter(withAi)
    const t = await call(withAi.app, 'POST', `/api/encounters/${e.id}/transcripts`, { cookie: doctor, body: { text: TRANSCRIPT } })
    expect(t.statusCode).toBe(409)
    expect(t.json().error).toBe('consent_required')
    expect((await upload(withAi, e.id, doctor, { name: 'a.wav', type: 'audio/wav', data: WAV })).statusCode).toBe(409)
    const consent = EncounterAi.parse((await call(withAi.app, 'POST', `/api/encounters/${e.id}/ai-consent`, { cookie: doctor, body: { method: 'verbal' } })).json())
    expect(consent.consent).toMatchObject({ granted: true, scope: 'encounter' })
    expect((await call(withAi.app, 'POST', `/api/encounters/${e.id}/transcripts`, { cookie: doctor, body: { text: TRANSCRIPT } })).statusCode).toBe(201)
  })

  it('only the authoring doctor can use the assistant; nurses cannot', async () => {
    const { e, doctor, nurse } = await openEncounter(withAi)
    await call(withAi.app, 'POST', `/api/encounters/${e.id}/ai-consent`, { cookie: doctor, body: { method: 'verbal' } })
    expect((await call(withAi.app, 'POST', `/api/encounters/${e.id}/transcripts`, { cookie: nurse, body: { text: 'x' } })).statusCode).toBe(403)
    const other = await login(withAi.app, 't.doctor2')
    expect((await call(withAi.app, 'POST', `/api/encounters/${e.id}/transcripts`, { cookie: other, body: { text: 'x' } })).statusCode).toBe(403)
  })
})

describe('drafting and review', () => {
  async function draftFor(ctx: TestContext) {
    const o = await openEncounter(ctx)
    await call(ctx.app, 'POST', `/api/encounters/${o.e.id}/ai-consent`, { cookie: o.doctor, body: { method: 'verbal' } })
    const ai = EncounterAi.parse((await call(ctx.app, 'POST', `/api/encounters/${o.e.id}/transcripts`, { cookie: o.doctor, body: { text: TRANSCRIPT } })).json())
    const res = await call(ctx.app, 'POST', `/api/transcripts/${ai.transcripts[0]!.id}/drafts`, { cookie: o.doctor })
    return { ...o, res, transcript: ai.transcripts[0]! }
  }

  it('segments the transcript with speakers, and sends only pseudonymised text to the provider', async () => {
    const { res, transcript } = await draftFor(withAi)
    expect(res.statusCode).toBe(201)
    expect(transcript.segments.map((s) => s.speaker)).toEqual(['Doctor', 'Patient', 'Doctor'])
    const sent = JSON.stringify(drafter.seen[0])
    expect(sent).not.toMatch(/Lakshmi/i)
    expect(sent).not.toContain('98400 12345')
    expect(sent).toContain('[PATIENT]')
    expect(sent).toContain('[PHONE]')
  })

  it('stores suggestions as pending, flags unsourced ones, records the run, and leaves the note untouched', async () => {
    const { res, e, doctor } = await draftFor(withAi)
    const ai = EncounterAi.parse(res.json())
    const items = ai.drafts[0]!.items
    expect(items.map((i) => [i.section, i.decision, i.unsupported, i.sourceSegmentIds])).toEqual([
      ['chiefComplaint', 'pending', false, ['S2']],
      ['plan', 'pending', false, ['S3']],
      ['assessment', 'pending', true, []],
    ])
    expect(ai.drafts[0]!.run).toMatchObject({ kind: 'note_draft', status: 'succeeded', provider: 'fake', model: 'fake-model', promptVersion: 'test-v1' })
    const enc = Encounter.parse((await call(withAi.app, 'GET', `/api/encounters/${e.id}`, { cookie: doctor })).json())
    expect(enc.note).toEqual(e.note)
  })

  it('records accept, edit and reject decisions; unsourced items need explicit confirmation', async () => {
    const { res, doctor } = await draftFor(withAi)
    const [cc, plan, assessment] = EncounterAi.parse(res.json()).drafts[0]!.items
    const decide = (id: string, body: object) => call(withAi.app, 'POST', `/api/ai-draft-items/${id}/decision`, { cookie: doctor, body })
    expect((await decide(cc!.id, { decision: 'accepted' })).json().item.finalText).toBe('Fever for three days.')
    expect((await decide(cc!.id, { decision: 'rejected' })).statusCode).toBe(409)
    expect((await decide(plan!.id, { decision: 'edited' })).statusCode).toBe(400)
    expect((await decide(plan!.id, { decision: 'edited', text: 'Paracetamol 500 mg if febrile.' })).json().item.finalText).toBe('Paracetamol 500 mg if febrile.')
    const blocked = await decide(assessment!.id, { decision: 'accepted' })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe('unsupported_confirmation_required')
    expect((await decide(assessment!.id, { decision: 'rejected' })).statusCode).toBe(200)
    const audit = await adminQuery("SELECT details->>'decision' AS d FROM audit_events WHERE action = 'ai.draft_decision' ORDER BY id")
    expect(audit.rows.map((r) => r.d)).toEqual(['accepted', 'edited', 'rejected'])
  })

  it('a provider failure is logged as a failed run and reported, with no draft', async () => {
    drafter.failWith = new AiProviderError('rate_limited', 'The AI service is busy. Try again in a minute.', true)
    const { res } = await draftFor(withAi)
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'ai_rate_limited' })
    const { rows } = await adminQuery("SELECT status, error_code FROM ai_runs WHERE kind = 'note_draft'")
    expect(rows).toEqual([{ status: 'failed', error_code: 'rate_limited' }])
    expect((await adminQuery('SELECT count(*)::int AS n FROM ai_drafts')).rows[0].n).toBe(0)
  })

  it('the assistant is closed once the consultation is signed', async () => {
    const { res, e, doctor } = await draftFor(withAi)
    const item = EncounterAi.parse(res.json()).drafts[0]!.items[0]!
    const saved = Encounter.parse(
      (await call(withAi.app, 'PUT', `/api/encounters/${e.id}/draft`, { cookie: doctor, body: { version: 1, note: { ...e.note, chiefComplaint: 'Fever' }, diagnoses: [{ description: 'Fever', kind: 'provisional' }], prescription: [] } })).json(),
    )
    await call(withAi.app, 'POST', `/api/encounters/${e.id}/sign`, { cookie: doctor, body: { version: saved.version, attestation: true } })
    expect((await call(withAi.app, 'POST', `/api/ai-draft-items/${item.id}/decision`, { cookie: doctor, body: { decision: 'accepted' } })).statusCode).toBe(409)
  })

  it('transcribes uploaded audio when speech-to-text is configured', async () => {
    const { e, doctor } = await openEncounter(withAi)
    await call(withAi.app, 'POST', `/api/encounters/${e.id}/ai-consent`, { cookie: doctor, body: { method: 'verbal' } })
    const bad = await upload(withAi, e.id, doctor, { name: 'x.txt', type: 'text/plain', data: Buffer.from('hi') })
    expect(bad.statusCode).toBe(400)
    const res = await upload(withAi, e.id, doctor, { name: 'rec.webm', type: 'audio/webm', data: Buffer.from('fake-webm-bytes') }, { source: 'browser_recording' })
    const ai = EncounterAi.parse(res.json())
    // The speech service identifies no speakers: nobody is labelled until the doctor assigns them.
    expect(ai.transcripts[0]).toMatchObject({ source: 'browser_recording', language: 'en', segments: [{ id: 'S1', speaker: null, text: 'What brings you in?', startMs: 0, endMs: 1800, speakerSource: 'none' }, { id: 'S2', speaker: null, startMs: 1800 }] })
    expect(ai.audio[0]!.transcriptId).toBe(ai.transcripts[0]!.id)
    expect(ai.runs[0]).toMatchObject({ kind: 'stt', status: 'succeeded', provider: 'fake-speech', locality: 'local', runtime: 'fake-runtime 1' })
  })
})

describe('text helpers', () => {
  it('splits a single block into sentences, including Devanagari full stops', () => {
    expect(segmentTranscript('Fever since Monday. No cough! बुखार है।').map((s) => s.text)).toEqual(['Fever since Monday.', 'No cough!', 'बुखार है।'])
  })
  it('pseudonymises names in any script, the MRN and the phone number', () => {
    const out = pseudonymize([{ id: 'S1', speaker: null, text: 'राम कुमार (ADX-001234) called from 98400-12345; Ramesh is unrelated.' }], { givenName: 'राम', familyName: 'कुमार', mrn: 'ADX-001234', phone: '+919840012345' })
    expect(out[0]!.text).toBe('[PATIENT] [PATIENT] ([MRN]) called from [PHONE]; Ramesh is unrelated.')
  })
})

// --- Contract tests: the real adapters against local stand-ins for the provider HTTP APIs ---
async function mockServer(handler: (req: http.IncomingMessage, body: Buffer, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => handler(req, Buffer.concat(chunks), res))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) }
}

describe('Anthropic adapter (contract test against a local mock of the Messages API)', () => {
  it('sends structured-output, effort and fallback settings, and parses the result', async () => {
    let captured: { url?: string; headers?: http.IncomingHttpHeaders; body?: Record<string, unknown> } = {}
    const srv = await mockServer((req, body, res) => {
      captured = { url: req.url, headers: req.headers, body: JSON.parse(body.toString()) }
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_mock_1' })
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: JSON.stringify({ items: [{ section: 'history', text: 'Fever for 3 days.', sourceSegmentIds: ['S1'] }] }) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 210, output_tokens: 35 },
        }),
      )
    })
    try {
      const d = createAnthropicDrafter('test-key-not-real', 'claude-opus-5-5', srv.url)
      const out = await d.draft([{ id: 'S1', speaker: 'Patient', text: 'Fever for three days.' }])
      expect(out).toMatchObject({ items: [{ section: 'history', sourceSegmentIds: ['S1'] }], model: 'claude-opus-5-5', inputTokens: 210, outputTokens: 35 })
      expect(d.promptVersion).toBe(NOTE_PROMPT_VERSION)
      expect(captured.url).toMatch(/^\/v1\/messages/)
      expect(captured.headers!['x-api-key']).toBe('test-key-not-real')
      expect(String(captured.headers!['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
      const b = captured.body as { model: string; fallbacks: string; output_config: { effort: string; format: { type: string } }; system: string; messages: { content: string }[] }
      expect(b.model).toBe('claude-opus-5-5')
      expect(b.fallbacks).toBe('default')
      expect(b.output_config.effort).toBe('medium')
      expect(b.output_config.format.type).toBe('json_schema')
      expect(b.system).toContain('Use only what was actually said')
      expect(b.messages[0]!.content).toContain('[S1] Patient: Fever for three days.')
    } finally {
      await srv.close()
    }
  })

  it('maps a refusal and an authentication error to safe error codes', async () => {
    let mode: 'refusal' | 'auth' = 'refusal'
    const srv = await mockServer((_req, _body, res) => {
      if (mode === 'auth') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: null, explanation: null }, usage: { input_tokens: 10, output_tokens: 0 } }))
    })
    try {
      const d = createAnthropicDrafter('k', 'claude-opus-5-5', srv.url)
      await expect(d.draft([{ id: 'S1', speaker: null, text: 'x' }])).rejects.toMatchObject({ code: 'refusal' })
      mode = 'auth'
      await expect(d.draft([{ id: 'S1', speaker: null, text: 'x' }])).rejects.toMatchObject({ code: 'auth_failed', retryable: false })
    } finally {
      await srv.close()
    }
  })
})
