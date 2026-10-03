import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type net from 'node:net'
import { Encounter, PatientDetail, Visit } from '@adaxai/contracts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { aiStatus, EGRESS_OFF, providersFromConfig } from '../src/ai/providers.ts'
import { buildApp } from '../src/app.ts'
import type { Config } from '../src/config.ts'
import { createDb } from '../src/db/client.ts'
import { createAppPool } from '../src/db/pool.ts'
import { effectiveSettings, loadAppSettings } from '../src/settings/load.ts'
import type { AppSettings } from '../src/settings/schema.ts'
import { call, closedPort, createFixture, type Fixture, login, resetDatabase, samplePatient, testConfig } from './helpers.ts'

// Hosted AI egress policy (V2.1). A provider key in .env must not, by itself, allow any consultation text to leave this computer: egress is a server
// setting that is off unless someone turns it on. Every "no external call" claim below is checked against a loopback stand-in for the hosted
// provider that counts what it is sent. No real provider is ever contacted and no real key is used: the key is a placeholder.

const KEY = 'placeholder-not-a-real-key-egress-test'

interface Stub {
  url: string
  requests: number
  paths: string[]
  close(): Promise<void>
}
async function startProviderStub(): Promise<Stub> {
  const stub: Stub = { url: '', requests: 0, paths: [], close: () => new Promise((r) => server.close(() => r())) }
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      stub.requests++
      stub.paths.push(req.url ?? '')
      // Anthropic-shaped, with nothing usable in it: the tests count the request, they do not need the answer.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'msg_stub', type: 'message', role: 'assistant', model: 'stub', content: [{ type: 'text', text: '{"items":[],"facts":[],"recommendations":[],"insufficientData":true,"insufficientDataReason":"stub"}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  stub.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  return stub
}

let stub: Stub
let fx: Fixture
const savedBase = process.env.ANTHROPIC_BASE_URL
beforeAll(async () => {
  stub = await startProviderStub()
  process.env.ANTHROPIC_BASE_URL = stub.url
})
afterAll(async () => {
  if (savedBase === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = savedBase
  await stub.close()
})
beforeEach(async () => {
  stub.requests = 0
  stub.paths = []
})

/** The configuration of a server that HAS a provider key, with egress as given (undefined: not said anywhere, so the settings file's value stands). */
const configWith = (egressHosted: boolean | undefined, extra: Partial<Config['ai']> = {}): Config => ({ ...testConfig, ai: { ...testConfig.ai, anthropicApiKey: KEY, egressHosted, ...extra } })

const apps: { close(): Promise<void> }[] = []
function appWith(config: Config, settings?: AppSettings) {
  const pool = createAppPool(config.db)
  const app = buildApp({ config, pool, logger: false, ...(settings && { settings }) })
  const ctx = { app, db: createDb(pool), close: async () => (await app.close(), await pool.end()) }
  apps.push(ctx)
  return ctx
}
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close()
})

async function open(ctx: ReturnType<typeof appWith>) {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  const nurse = await login(ctx.app, 't.nurse')
  const doctor = await login(ctx.app, 't.doctor')
  const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: 'Egress', phone: '9300000001' }) })).json())
  const v = Visit.parse((await call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId: p.id, departmentId: fx.departments.gen, chiefComplaint: 'Fever' } })).json())
  const e = Encounter.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/encounter`, { cookie: doctor })).json())
  expect((await call(ctx.app, 'POST', `/api/encounters/${e.id}/ai-consent`, { cookie: doctor, body: { method: 'verbal' } })).statusCode).toBe(201)
  const t = await call(ctx.app, 'POST', `/api/encounters/${e.id}/transcripts`, { cookie: doctor, body: { text: 'Doctor: What brings you in?\nPatient: I have had a fever and a cough for three days.\nPatient: I am allergic to penicillin.', source: 'typed' } })
  expect(t.statusCode).toBe(201)
  const tid = t.json().transcripts[0].id as string
  return { e, doctor, nurse, tid }
}

describe('the setting', () => {
  it('ships off, and a provider key does not change that', () => {
    const file = loadAppSettings()
    expect(file.ai.egress).toEqual({ hostedProviders: false })
    expect(effectiveSettings(file, configWith(undefined)).ai.egress.hostedProviders).toBe(false)
  })

  it('is turned on only on purpose: the environment says true, and the environment can also forbid what the file allows', () => {
    const file = loadAppSettings()
    expect(effectiveSettings(file, configWith(true)).ai.egress.hostedProviders).toBe(true)
    const allowedInFile: AppSettings = { ...file, ai: { ...file.ai, egress: { hostedProviders: true } } }
    expect(effectiveSettings(allowedInFile, configWith(undefined)).ai.egress.hostedProviders).toBe(true)
    expect(effectiveSettings(allowedInFile, configWith(false)).ai.egress.hostedProviders).toBe(false)
  })

  it('is read from the environment as true, false or empty, and nothing else', async () => {
    const { loadConfig } = await import('../src/config.ts')
    const c = (v: string) => loadConfig({ DB_APP_PASSWORD: 'x', AI_EGRESS_HOSTED: v }).ai.egressHosted
    expect([c('true'), c('false'), c('')]).toEqual([true, false, undefined])
    expect(() => c('yes')).toThrow()
    expect(loadConfig({ DB_APP_PASSWORD: 'x' }).ai.egressHosted).toBeUndefined()
  })
})

describe('a key is present and egress is off (the default)', () => {
  it('builds no hosted provider, says why, and shows egress off without any key', async () => {
    const config = configWith(undefined)
    const p = providersFromConfig(config, effectiveSettings(loadAppSettings(), config))
    expect([p.drafter, p.recommender, p.describer, p.qa]).toEqual([null, null, null, null])
    expect(p.extractor).toMatchObject({ provider: 'adaxai-rules', local: true })
    expect(p.egress).toEqual({ hosted: false, destination: null })
    const status = await aiStatus(p)
    expect(status.egress).toEqual({ hosted: false, destination: null })
    expect(status.llm).toMatchObject({ available: false, reason: EGRESS_OFF })
    expect(status.vision.available).toBe(false)
    expect(status.qa.available).toBe(false)
    expect(JSON.stringify(status)).not.toContain(KEY)
    expect(status.llm.reason).toMatch(/no consultation text leaves this computer/)
  })

  it('sends nothing to the provider through the real application, and the transcript stays local', async () => {
    const ctx = appWith(configWith(undefined))
    const { e, doctor, tid } = await open(ctx)
    // Drafting, AI recommendations (even when the browser asks for them), image description and Mana summaries are unavailable.
    const draft = await call(ctx.app, 'POST', `/api/transcripts/${tid}/drafts`, { cookie: doctor, body: { idempotencyKey: randomUUID() } })
    expect(draft.statusCode).toBe(503)
    expect(draft.json().message).toBe(EGRESS_OFF)
    const recs = await call(ctx.app, 'POST', `/api/encounters/${e.id}/recommendations`, { cookie: doctor, body: { includeLlm: true, idempotencyKey: randomUUID() } })
    expect(recs.statusCode).toBe(201)
    expect(recs.json().recommendations.every((r: { source: string }) => r.source === 'rules')).toBe(true)
    // The important points are found in this process.
    const extracted = await call(ctx.app, 'POST', `/api/transcripts/${tid}/extract`, { cookie: doctor, body: { idempotencyKey: randomUUID() } })
    expect(extracted.statusCode).toBe(201)
    expect(extracted.json().facts.length).toBeGreaterThan(0)
    expect(extracted.json().facts.every((f: { producedBy: { local: boolean | null } }) => f.producedBy.local === true)).toBe(true)
    // What the screen is told: nothing hosted is available, and why.
    const status = (await call(ctx.app, 'GET', '/api/ai/status', { cookie: doctor })).json()
    expect(status).toMatchObject({ egress: { hosted: false, destination: null }, llm: { available: false } })
    expect(JSON.stringify(status)).not.toContain(KEY)
    expect(stub.requests, 'requests the hosted provider received').toBe(0)
  })

  it('does not fall back to a hosted step when the local extractor is asked for a hosted one: it is unavailable', async () => {
    const file = loadAppSettings()
    const ctx = appWith(configWith(undefined), { ...file, ai: { ...file.ai, extraction: { provider: 'llm' } } })
    const { doctor, tid } = await open(ctx)
    const res = await call(ctx.app, 'POST', `/api/transcripts/${tid}/extract`, { cookie: doctor, body: { idempotencyKey: randomUUID() } })
    expect(res.statusCode).toBe(503)
    expect(res.json().message).toBe(EGRESS_OFF)
    expect(stub.requests).toBe(0)
    expect((await call(ctx.app, 'GET', '/api/ai/status', { cookie: doctor })).json().extraction).toMatchObject({ available: false })
  })
})

describe('egress is allowed on purpose', () => {
  it('the hosted provider is built, the screen is told where text would go, and drafting does reach it (the control for the tests above)', async () => {
    const ctx = appWith(configWith(true))
    const { doctor, tid } = await open(ctx)
    const status = (await call(ctx.app, 'GET', '/api/ai/status', { cookie: doctor })).json()
    expect(status).toMatchObject({ egress: { hosted: true, destination: new URL(stub.url).host }, llm: { available: true } })
    expect(JSON.stringify(status)).not.toContain(KEY)
    await call(ctx.app, 'POST', `/api/transcripts/${tid}/drafts`, { cookie: doctor, body: { idempotencyKey: randomUUID() } })
    expect(stub.requests, 'the stand-in for the hosted provider would have been hit').toBeGreaterThan(0)
    expect(stub.paths.every((p) => p.startsWith('/v1/messages'))).toBe(true)
  })

  it('still finds the important points with the local rules, never with the hosted model, unless the extractor is chosen', async () => {
    const ctx = appWith(configWith(true))
    const { doctor, tid } = await open(ctx)
    const before = stub.requests
    const extracted = await call(ctx.app, 'POST', `/api/transcripts/${tid}/extract`, { cookie: doctor, body: { idempotencyKey: randomUUID() } })
    expect(extracted.statusCode).toBe(201)
    expect(extracted.json().facts.every((f: { producedBy: { local: boolean | null } }) => f.producedBy.local === true)).toBe(true)
    expect(stub.requests - before).toBe(0)
  })

  it('allowed but without a key: nothing is configured to send to, and the screen says so', async () => {
    const config: Config = { ...testConfig, ai: { ...testConfig.ai, anthropicApiKey: undefined, egressHosted: true } }
    const p = providersFromConfig(config, effectiveSettings(loadAppSettings(), config))
    expect(p.drafter).toBeNull()
    expect(p.egress).toEqual({ hosted: true, destination: null })
    expect((await aiStatus(p)).llm.reason).toMatch(/ANTHROPIC_API_KEY is not set/)
  })
})

describe('Mana summaries: the second hosted step a key used to switch on', () => {
  async function askMana(ctx: ReturnType<typeof appWith>) {
    const { e, doctor, nurse } = await open(ctx)
    const patientId = e.patient.id
    expect((await call(ctx.app, 'POST', `/api/patients/${patientId}/consents`, { cookie: nurse, body: { type: 'ai_record_assistant', method: 'verbal' } })).statusCode).toBe(201)
    return call(ctx.app, 'POST', `/api/patients/${patientId}/mana/questions`, { cookie: doctor, body: { question: 'Give me a pre-consultation briefing.', generate: true, idempotencyKey: randomUUID() } })
  }

  it('with a key, consent and a click but egress off, the record answer is given and the AI summary is unavailable: the provider is never contacted', async () => {
    const res = await askMana(appWith(configWith(undefined)))
    expect(res.statusCode).toBe(201)
    expect(res.json().generation).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/switched off on this server/) })
    expect(res.json().record.sections.length).toBeGreaterThan(0)
    expect(stub.requests, 'requests the hosted provider received').toBe(0)
  })

  it('the same request with egress allowed does reach the stand-in (the control)', async () => {
    await askMana(appWith(configWith(true)))
    expect(stub.requests).toBeGreaterThan(0)
  })
})

describe('speech never falls back to a hosted service', () => {
  it('with a key, egress allowed and the local speech service down, a recording fails locally and nothing reaches the provider', async () => {
    const down = await closedPort()
    const ctx = appWith(configWith(true, { speech: { provider: 'local', url: `http://127.0.0.1:${down}`, allowNonLoopback: false } }))
    const { e, doctor } = await open(ctx)
    const status = (await call(ctx.app, 'GET', `/api/encounters/${e.id}/capture`, { cookie: doctor })).json()
    expect(status).toMatchObject({ canRecord: false, speech: { available: false } })
    expect((await call(ctx.app, 'POST', `/api/encounters/${e.id}/live-transcripts`, { cookie: doctor })).statusCode).toBe(503)
    expect(stub.requests).toBe(0)
  })
})

describe('the browser cannot turn egress on', () => {
  /** Every route the server registers, with its methods, read from the real route table (not guessed). */
  function registeredRoutes(app: ReturnType<typeof appWith>['app']): { path: string; methods: string[] }[] {
    const out: { path: string; methods: string[] }[] = []
    const stack: string[] = []
    for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
      const m = /^((?:[│ ]   )*)[├└]── (\S+)(?: \(([^)]*)\))?/.exec(line)
      if (!m) continue
      const depth = m[1]!.length / 4
      stack.length = depth
      stack[depth] = m[2]!
      if (m[3]) out.push({ path: stack.join(''), methods: m[3].split(', ') })
    }
    return out
  }

  it('has no route that changes a setting, found in the server’s own route table, and the status routes only read', async () => {
    const ctx = appWith(configWith(undefined))
    await ctx.app.ready()
    const routes = registeredRoutes(ctx.app)
    expect(routes.length).toBeGreaterThan(100)
    const changing = routes.filter((r) => r.methods.some((m) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)))
    expect(changing.length).toBeGreaterThan(50)
    // Nothing that changes anything is named for a setting, egress, a provider or the hosted switch.
    expect(changing.filter((r) => /egress|setting|config|hosted|provider/i.test(r.path)).map((r) => r.path)).toEqual([])
    // The routes that report the AI state only read.
    for (const r of routes.filter((x) => x.path === '/api/ai/status' || x.path === '/api/ai-oversight/overview')) expect(r.methods.filter((m) => m !== 'GET' && m !== 'HEAD')).toEqual([])
    // The administrators’ AI page has one write, the evaluation snapshot, and it takes no setting.
    expect(routes.filter((r) => r.path.startsWith('/api/ai-oversight')).flatMap((r) => r.methods.filter((m) => m !== 'GET' && m !== 'HEAD').map((m) => `${m} ${r.path}`))).toEqual(['POST /api/ai-oversight/evaluations'])
  })

  it('whoever asks, a request that tries to carry the setting changes nothing: it is still off, and nothing reached the provider', async () => {
    const ctx = appWith(configWith(undefined))
    const { doctor, nurse } = await open(ctx)
    const admin = await login(ctx.app, 't.admin')
    for (const cookie of [doctor, nurse, admin, undefined]) {
      for (const [method, url] of [['PUT', '/api/ai/status'], ['POST', '/api/ai/status'], ['POST', '/api/ai/egress'], ['PUT', '/api/ai/egress'], ['PUT', '/api/settings'], ['POST', '/api/settings'], ['PATCH', '/api/ai/settings']] as const) {
        const res = await call(ctx.app, method, url, { ...(cookie && { cookie }), body: { egress: { hostedProviders: true }, hosted: true, hostedProviders: true, includeLlm: true } })
        expect([401, 403, 404, 405], `${method} ${url} as ${cookie ? 'a signed-in user' : 'nobody'}`).toContain(res.statusCode)
      }
    }
    expect((await call(ctx.app, 'GET', '/api/ai/status', { cookie: doctor })).json().egress.hosted).toBe(false)
    expect(stub.requests).toBe(0)
  })

  it('the status a browser can read has no key and no field that could carry one, and the administrators’ page says a key sits unused', async () => {
    const ctx = appWith(configWith(undefined))
    const { doctor } = await open(ctx)
    const admin = await login(ctx.app, 't.admin')
    const doctorsView = JSON.stringify((await call(ctx.app, 'GET', '/api/ai/status', { cookie: doctor })).json())
    expect(doctorsView).not.toContain(KEY)
    expect(doctorsView).not.toMatch(/api[_-]?key|secret|token/i)
    const overview = (await call(ctx.app, 'GET', '/api/ai-oversight/overview', { cookie: admin })).json()
    expect(JSON.stringify(overview)).not.toContain(KEY)
    expect(overview).toMatchObject({ hostedKeyConfigured: true, status: { egress: { hosted: false } } })
  })

  it('a sent-in flag does not decide what a step may do (the server does)', async () => {
    const ctx = appWith(configWith(undefined))
    const { e, doctor } = await open(ctx)
    const res = await call(ctx.app, 'POST', `/api/encounters/${e.id}/recommendations`, { cookie: doctor, body: { includeLlm: true, egress: true, hosted: true, idempotencyKey: randomUUID() } })
    expect(res.statusCode).toBeLessThan(500)
    expect(stub.requests).toBe(0)
  })
})
