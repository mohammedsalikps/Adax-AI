import fs from 'node:fs'
import path from 'node:path'
import { ManaConversationState } from '@adaxai/contracts'
import { describe, expect, it } from 'vitest'
import { RuleFactExtractor } from '../src/ai/extract/rules.ts'
import { LocalLlmClient } from '../src/ai/llm/local.ts'
import type { ReasoningModel } from '../src/ai/llm/types.ts'
import { MANA_ANSWER_PROMPT, MANA_PLAN_PROMPT, promptSha256 } from '../src/ai/prompts.ts'
import { type AiProviders, pinnedLocalModel } from '../src/ai/providers.ts'
import { loadConfig, REPO_ROOT } from '../src/config.ts'
import { buildManaWorld, createManaBase } from '../src/eval/mana-fixture.ts'
import { type CasesFile, loadCases, type PatientKey, type RawFile, type RawTurn } from '../src/eval/mana.ts'
import { ANSWER_CHECKS_VERSION } from '../src/mana/assistant/answer.ts'
import { PLAN_CHECKS_VERSION } from '../src/mana/assistant/plan.ts'
import { TOOLS_VERSION } from '../src/mana/assistant/tools.ts'
import { effectiveSettings, loadAppSettings } from '../src/settings/load.ts'
import { adminQuery, call, createTestApp, login, resetDatabase, TEST_PASSWORD } from './helpers.ts'

/**
 * The Mana evaluation through the REAL local model (opt-in; minutes per question on a laptop CPU, so it is not part of the gate):
 *
 *   MANA_EVAL=1 npx vitest run test/mana-eval.real.test.ts            (from apps/api; the model server must be running: npm run dev:llm)
 *   MANA_EVAL_CASES=brief-current,follow-up   run only those cases (their earlier recorded turns are replaced)
 *   MANA_EVAL_FORCE=1                          ask every selected case again even if it is recorded
 *
 * It builds the synthetic clinic in the TEST database (the test runner refuses anything else), asks each case's questions through the HTTP routes the
 * screen uses, and records what came back, turn by turn, in data/eval/results/mana-v1.raw.json. `npx tsx apps/api/src/eval/mana-cli.ts` scores and writes
 * the report. Nothing here is a clinical validation.
 */

const RUN = process.env.MANA_EVAL === '1'
const only = (process.env.MANA_EVAL_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const force = process.env.MANA_EVAL_FORCE === '1'
const RAW = path.join(REPO_ROOT, 'data', 'eval', 'results', 'mana-v1.raw.json')
const URL_ = '/api/mana-assistant'

describe.skipIf(!RUN)('Mana evaluation with the real local model', () => {
  it(
    'asks every case and records the answers',
    async () => {
      const config = loadConfig()
      const settings = effectiveSettings(loadAppSettings(), config)
      const model = new LocalLlmClient({ url: settings.ai.reasoning.url, apiKey: config.ai.llm.apiKey ?? null, allowNonLoopback: false, timeoutMs: settings.ai.reasoning.timeoutSeconds * 1000, pinned: pinnedLocalModel() })
      const health = await model.health({ fresh: true })
      // The model's own words are recorded as they come, before any check: what it was shown and what it wrote, call by call.
      let modelLog: RawTurn["modelCalls"] = []
      const recorder: ReasoningModel = {
        provider: model.provider,
        get model() {
          return model.model
        },
        local: model.local,
        health: (o) => model.health(o),
        async generate(req) {
          const r = await model.generate(req)
          modelLog.push({ kind: req.prompt.kind === 'mana_plan' ? 'mana_plan' : 'mana_answer', user: req.user, output: r.output })
          return r
        },
      }
      if (health.state !== 'ready') throw new Error(`Local AI unavailable. ${health.reason ?? ''} Start the model server (npm run dev:llm) and run this again.`)

      const relaxed = { ...settings, security: { ...settings.security, rateLimits: { ...settings.security.rateLimits, loginPerAccount: { max: 10_000, windowSeconds: 60 }, loginPerIp: { max: 10_000, windowSeconds: 60 }, aiStepPerUser: { max: 10_000, windowSeconds: 60 } } } }
      const providers: AiProviders = { drafter: null, transcriber: null, extractor: new RuleFactExtractor(), reasoner: recorder, reasoning: { mode: 'local', reason: null }, egress: { hosted: false, destination: null }, reasons: { llm: null, stt: null } }
      const ctx = createTestApp({ ai: providers, settings: relaxed })
      try {
        await resetDatabase()
        const base = await createManaBase(ctx.db, TEST_PASSWORD)
        const world = await buildManaWorld({ call: (m, u, o) => call(ctx.app, m, u, o ?? {}), login: (u) => login(ctx.app, u), admin: (s, p) => adminQuery(s, p), db: ctx.db }, base, TEST_PASSWORD)
        const cookies: Record<string, string> = { doctor: world.cookies.doctor, doctor2: world.cookies.doctor2, doctorB: world.cookies.doctorB, nurse: world.cookies.nurse }
        const patients = Object.fromEntries(Object.entries(world.p).map(([k, p]) => [k, { name: p.name, mrn: p.mrn }]))
        const cases: CasesFile = loadCases()
        const selected = cases.cases.filter((c) => !only.length || only.includes(c.id))
        if (!selected.length) throw new Error('no case matches MANA_EVAL_CASES')

        const run: RawFile['run'] = {
          startedAt: new Date().toISOString(),
          model: health.model?.id ?? model.model,
          runtime: health.model?.runtime ?? null,
          weightsSha256: health.model?.weightsSha256 ?? null,
          planPrompt: { id: MANA_PLAN_PROMPT.id, sha256: promptSha256(MANA_PLAN_PROMPT) },
          answerPrompt: { id: MANA_ANSWER_PROMPT.id, sha256: promptSha256(MANA_ANSWER_PROMPT) },
          toolsVersion: TOOLS_VERSION,
          checksVersion: `${PLAN_CHECKS_VERSION}+${ANSWER_CHECKS_VERSION}`,
          temperature: 0,
          maxOutputTokens: { plan: Math.min(700, settings.ai.reasoning.maxOutputTokens), answer: Math.min(1400, settings.ai.reasoning.maxOutputTokens) },
        }
        // What is recorded stays unless it was made by other prompts, other versions of the checks or other cases: then it is not mixed with new answers.
        let store: RawFile | null = fs.existsSync(RAW) ? (JSON.parse(fs.readFileSync(RAW, 'utf8')) as RawFile) : null
        if (store && (store.casesVersion !== cases.version || store.run.planPrompt.sha256 !== run.planPrompt.sha256 || store.run.answerPrompt.sha256 !== run.answerPrompt.sha256 || store.run.toolsVersion !== run.toolsVersion || store.run.checksVersion !== run.checksVersion || store.run.model !== run.model)) {
          const old = RAW.replace(/\.raw\.json$/, `.superseded-${Date.now()}.raw.json`)
          fs.renameSync(RAW, old)
          console.log(`The recorded answers were made by something else (cases, prompts, tools, checks or model changed): kept as ${path.basename(old)}, starting again.`)
          store = null
        }
        store ??= { casesVersion: cases.version, run, patients, turns: [] }
        store.patients = patients
        const save = () => {
          fs.mkdirSync(path.dirname(RAW), { recursive: true })
          fs.writeFileSync(RAW, JSON.stringify(store, null, 1))
        }

        const counts = async () => JSON.stringify((await adminQuery(`select (select count(*) from prescription_items) rx, (select count(*) from diagnoses) dx, (select count(*) from allergies) al, (select count(*) from appointments) ap, (select count(*) from visits) vi, (select count(*) from encounters) en, (select count(*) from patients) pa, (select count(*) from consents) co, (select count(*) from users) us, (select count(*) from patient_medications) pm, (select count(*) from patient_conditions) pc`)).rows[0])

        for (const c of selected) {
          const recorded = store.turns.filter((t) => t.caseId === c.id).length
          if (!force && recorded === c.turns.length) {
            console.log(`skip ${c.id} (recorded)`)
            continue
          }
          store.turns = store.turns.filter((t) => t.caseId !== c.id)
          console.log(`case ${c.id} (${c.turns.length} question(s))`)
          const cookie = cookies[c.as]!
          const scopeBody = (): Record<string, unknown> => {
            if (c.scope.kind === 'none') return {}
            const p = world.p[c.scope.patient as PatientKey]
            if (c.scope.kind === 'patient') return { patientId: p.id }
            return { encounterId: c.scope.patient === 'vikram' ? world.openEncounterId : p.encounterId }
          }
          const opened = await call(ctx.app, 'POST', `${URL_}/conversations`, { cookie, body: { fresh: true, ...scopeBody() } })
          let conversationId: string | null = opened.statusCode === 200 ? ManaConversationState.parse(opened.json()).conversation.id : null
          for (let i = 0; i < c.turns.length; i++) {
            const t = c.turns[i]!
            const before = await counts()
            modelLog = []
            const started = Date.now()
            let httpStatus: number | null = opened.statusCode === 200 ? null : opened.statusCode
            let message: RawTurn['message'] = null
            let entities: RawTurn['entities'] = []
            const question = (t.q ?? `(chooses ${t.select})`).replace(/\{mrn:(\w+)\}/g, (_m, k: string) => world.p[k as PatientKey]?.mrn ?? '')
            if (conversationId) {
              let res
              if (t.select) {
                const prev = ManaConversationState.parse((await call(ctx.app, 'GET', `${URL_}/conversations/${conversationId}`, { cookie })).json())
                const last = [...prev.messages].reverse().find((m) => m.role === 'mana')
                const alias = last?.answer?.candidates.find((x) => x.mrn === world.p[t.select!].mrn)?.alias
                res = alias ? await call(ctx.app, 'POST', `${URL_}/conversations/${conversationId}/select`, { cookie, body: { alias, idempotencyKey: crypto.randomUUID() } }) : null
                if (!res) httpStatus = 0
              } else res = await call(ctx.app, 'POST', `${URL_}/conversations/${conversationId}/messages`, { cookie, body: { text: question, idempotencyKey: crypto.randomUUID() } })
              if (res) {
                if (res.statusCode >= 400) httpStatus = res.statusCode
                else {
                  const deadline = Date.now() + 25 * 60_000
                  for (;;) {
                    const s = ManaConversationState.parse((await call(ctx.app, 'GET', `${URL_}/conversations/${conversationId}`, { cookie })).json())
                    const last = [...s.messages].reverse().find((m) => m.role === 'mana')
                    if (last && last.status !== 'pending') {
                      message = last
                      entities = last.answer?.entities ?? []
                      break
                    }
                    if (Date.now() > deadline) throw new Error(`${c.id}#${i} did not finish in 25 minutes`)
                    await new Promise((r) => setTimeout(r, 1500))
                  }
                }
              }
            } else httpStatus ??= 0
            const tools = message ? (await adminQuery(`select tool, args, status from mana_tool_calls where message_id = $1 order by position`, [message.id])).rows : []
            const runs = message ? (await adminQuery(`select r.kind, r.latency_ms, r.input_tokens, r.output_tokens, r.status from mana_messages m join ai_runs r on r.id in (m.plan_run_id, m.answer_run_id) where m.id = $1 order by r.created_at`, [message.id])).rows : []
            const turn: RawTurn = {
              caseId: c.id,
              turn: i,
              question,
              httpStatus,
              message,
              tools: tools.map((r) => ({ tool: r.tool, patient: r.args.patient ?? null, topic: r.args.topic ?? null, when: r.args.when ?? null, which: r.args.which ?? null, mine: r.args.mine ?? null, status: r.status })),
              calls: runs.map((r) => ({ kind: r.kind, ms: r.latency_ms, tokensIn: r.input_tokens, tokensOut: r.output_tokens, status: r.status })),
              modelCalls: modelLog,
              validation: message ? ((await adminQuery(`select validation from mana_messages where id = $1`, [message.id])).rows[0]?.validation ?? null) : null,
              totalMs: Date.now() - started,
              entities,
              unchanged: (await counts()) === before,
            }
            store.turns.push(turn)
            save()
            console.log(`  #${i} ${Math.round(turn.totalMs / 1000)} s: ${httpStatus ? `HTTP ${httpStatus}` : (message?.answer?.outcome ?? message?.status)} | ${(message?.answer ? [...message.answer.blocks.map((b) => b.text), message.answer.notice ?? ''].join(' ') : (message?.error?.message ?? '')).replace(/\s+/g, ' ').slice(0, 140)}`)
          }
        }
        expect(store.turns.length).toBeGreaterThan(0)
      } finally {
        await ctx.close()
      }
    },
    8 * 3_600_000,
  )
})

