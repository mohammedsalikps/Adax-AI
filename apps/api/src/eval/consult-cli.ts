// Usage (from the repo root, with the local model server running: npm run dev:llm):
//   npx tsx apps/api/src/eval/consult-cli.ts [--split dev|test|all] [--case <id>] [--twice | --second] [--out data/eval/results/consult-v1]
//       --twice runs each selected case twice; --second runs ONLY a second time (keeping the recorded first run), to measure how alike two runs are.
//   npx tsx apps/api/src/eval/consult-cli.ts --replay [--out data/eval/results/consult-v1]      (no model: re-applies the CURRENT checks to the recorded answers)
// Runs the synthetic consultation cases through the REAL local model and the real checks, and writes a report. It needs the model server (it says
// "Local AI unavailable." and stops otherwise). It is not part of the automated gate (a draft takes minutes on a laptop CPU); the committed report
// records what it measured, with the model and the date. Nothing here is a clinical validation.
//
// The model's own answers are recorded BEFORE any check, case by case, in `<out>.raw.json` (a run that stops keeps what it finished, and a later run
// of other cases adds to the file), and the report is always produced from that record with the checks as they are now. So a change to a check can
// be re-scored at once with --replay; and the report says which prompt made the recorded answers and which version of the checks scored them.
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, loadDotEnv, REPO_ROOT } from '../config.ts'
import { LocalLlmClient } from '../ai/llm/local.ts'
import { promptSha256 } from '../ai/prompts.ts'
import { pinnedLocalModel } from '../ai/providers.ts'
import { CONSULT_PROMPT } from '../consult/prompt.ts'
import { effectiveSettings, loadAppSettings } from '../settings/load.ts'
import { type CaseResult, evaluateStored, loadCases, runCase, type StoredRun, toMarkdown } from './consult.ts'

loadDotEnv()
const args = process.argv.slice(2)
const opt = (name: string, fallback: string) => (args.includes(`--${name}`) ? (args[args.indexOf(`--${name}`) + 1] ?? fallback) : fallback)
const replay = args.includes('--replay')
const split = opt('split', 'all')
const only = opt('case', '')
const twice = args.includes('--twice')
const second = args.includes('--second')
const out = path.resolve(REPO_ROOT, opt('out', 'data/eval/results/consult-v1'))
const rawPath = `${out}.raw.json`

const file = loadCases()
const selected = file.cases.filter((c) => (split === 'all' || c.split === split) && (!only || c.id === only))
if (!selected.length) throw new Error('no case matches')

interface RawFile {
  casesVersion: string
  prompt: { id: string; sha256: string }
  settings: { maxOutputTokens: number; temperature: number; reasoning: string }
  runs: StoredRun[]
}
let store: RawFile | null = fs.existsSync(rawPath) ? (JSON.parse(fs.readFileSync(rawPath, 'utf8')) as RawFile) : null
const save = () => {
  fs.mkdirSync(path.dirname(rawPath), { recursive: true })
  fs.writeFileSync(rawPath, JSON.stringify(store, null, 1))
}

if (!replay) {
  const config = loadConfig()
  const settings = effectiveSettings(loadAppSettings(), config)
  const model = new LocalLlmClient({ url: settings.ai.reasoning.url, apiKey: config.ai.llm.apiKey ?? null, allowNonLoopback: false, timeoutMs: settings.ai.reasoning.timeoutSeconds * 1000, pinned: pinnedLocalModel() })
  const health = await model.health({ fresh: true })
  if (health.state !== 'ready') {
    console.error(`Local AI unavailable. ${health.reason ?? ''}`)
    process.exit(2)
  }
  console.log(`model ${health.model?.id} (${health.model?.runtime}) weights ${health.model?.weightsSha256?.slice(0, 12)}...; ${selected.length} case(s)${twice ? ', each run twice' : second ? ', a second run of each' : ''}`)
  const prompt = { id: CONSULT_PROMPT.id, sha256: promptSha256(CONSULT_PROMPT) }
  const run = { maxOutputTokens: settings.ai.reasoning.maxOutputTokens, temperature: 0, reasoning: 'off' }
  // Answers made with another prompt are not mixed into this record: say so and stop rather than report them as one run.
  if (store && (store.prompt.sha256 !== prompt.sha256 || store.settings.maxOutputTokens !== run.maxOutputTokens)) {
    console.error(`The record ${path.relative(REPO_ROOT, rawPath)} was made with prompt ${store.prompt.id} (${store.prompt.sha256.slice(0, 12)}...) and different settings. Remove it, or use another --out, to start a new record.`)
    process.exit(3)
  }
  store ??= { casesVersion: file.version, prompt, settings: run, runs: [] }
  for (const round of (second ? [2] : twice ? [1, 2] : [1]) as (1 | 2)[]) {
    for (const c of selected) {
      const r = await runCase(model, c, file.today, round, { maxOutputTokens: settings.ai.reasoning.maxOutputTokens, timeoutMs: settings.ai.reasoning.timeoutSeconds * 1000 })
      store.runs = [...store.runs.filter((x) => !(x.id === c.id && x.round === round)), r]
      save()
      const s = evaluateStored(c, file.today, r)
      console.log(`${c.id}${round === 2 ? ' (second run)' : ''}: ${s.valid ? 'ok' : `FAILED ${s.error}`}; wrote ${s.raw?.produced ?? 0}, kept ${s.kept}, covered ${s.coverage.covered.length}/${c.expect.mustCover.length}, leaks ${s.leaks.length}, ${(s.latencyMs / 1000).toFixed(0)} s`)
    }
  }
}

if (!store) {
  console.error(`No record of answers at ${path.relative(REPO_ROOT, rawPath)}: run the model first.`)
  process.exit(2)
}

// --- the report, always from the record ---------------------------------------------------------------------------------------------------
const runsOf = (round: 1 | 2) => file.cases.flatMap((c) => store!.runs.filter((r) => r.id === c.id && r.round === round).map((r) => ({ c, r })))
const first = runsOf(1)
const results: CaseResult[] = first.map(({ c, r }) => evaluateStored(c, file.today, r))
const secondResults: CaseResult[] = runsOf(2).map(({ c, r }) => evaluateStored(c, file.today, r))
const cases = first.map((x) => x.c)
const models = [...new Set(store.runs.filter((r) => r.model.id).map((r) => `${r.model.id} (${r.model.runtime ?? 'runtime unknown'}), weights SHA-256 ${r.model.weightsSha256 ?? 'not known'}`))]
const dates = [...new Set(store.runs.map((r) => r.startedAt.slice(0, 10)))].sort()
const meta = {
  'Model outputs recorded on': dates.join(', '),
  Model: models.join('; ') || 'none answered',
  'Prompt / output form': `${store.prompt.id} (SHA-256 ${store.prompt.sha256.slice(0, 12)}...) / ${file.version === 'consult-eval-v1' ? 'consult-schema-v1' : 'see prompt'}`,
  Settings: `temperature ${store.settings.temperature}, at most ${store.settings.maxOutputTokens} output tokens, reasoning ${store.settings.reasoning}`,
  Server: 'as the launcher starts it (scripts/llm.mjs): one request at a time and prompt caching off, so an answer does not depend on what the server answered before',
  Machine: 'the development laptop (CPU only)',
  Cases: `${cases.length} of ${file.cases.length} (${cases.filter((c) => c.split === 'dev').length} dev, ${cases.filter((c) => c.split === 'test').length} test; the dev cases were used while the prompt and checks were written; the test cases were first run once, after the prompt and checks were frozen, and again for this record, because the first recording was made against a server with prompt caching on: see docs/safety/DATASETS.md)`,
}
if (store.prompt.sha256 !== promptSha256(CONSULT_PROMPT)) console.warn('WARNING: the recorded answers were made with a different prompt from the current one; the report says which.')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(`${out}.json`, JSON.stringify({ meta, results, second: secondResults }, null, 1))
fs.writeFileSync(`${out}.md`, toMarkdown('Consultation draft evaluation (synthetic cases, real local model)', meta, results, cases, secondResults))
console.log(`written ${path.relative(REPO_ROOT, out)}.md, .json and .raw.json`)
