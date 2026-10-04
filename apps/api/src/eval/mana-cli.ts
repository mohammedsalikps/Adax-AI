// Usage (from the repo root):
//   npx tsx apps/api/src/eval/mana-cli.ts [--replay] [--out data/eval/results/mana-v1]
//       --replay applies the CURRENT answer checks again to the model's recorded answers (what it wrote before any check), so that a change to a check is scored
//       without asking the model; plans and tool results stay as recorded.
// Scores the recorded answers of the Mana evaluation (data/eval/results/mana-v1.raw.json, made by `MANA_EVAL=1 npx vitest run test/mana-eval.real.test.ts`
// from apps/api, which asks the real local model) with the checks as they are NOW, and writes the report (<out>.md and <out>.json). It asks no model and
// reads no database, so a change to a check can be re-scored at once. The report says which prompts and which model made the recorded answers.
// Nothing here is a clinical validation: see the first lines of the report.
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../config.ts'
import { buildReport, loadCases, type RawFile, toMarkdown } from './mana.ts'

const args = process.argv.slice(2)
const opt = (name: string, fallback: string) => (args.includes(`--${name}`) ? (args[args.indexOf(`--${name}`) + 1] ?? fallback) : fallback)
const out = path.resolve(REPO_ROOT, opt('out', 'data/eval/results/mana-v1'))
const rawPath = `${out}.raw.json`
if (!fs.existsSync(rawPath)) {
  console.error(`No recorded answers at ${rawPath}. Run: (cd apps/api && MANA_EVAL=1 npx vitest run test/mana-eval.real.test.ts)`)
  process.exit(2)
}
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8')) as RawFile
const cases = loadCases()
if (raw.casesVersion !== cases.version) console.warn(`The recorded answers are for cases ${raw.casesVersion}; the cases file is ${cases.version}.`)
const report = buildReport(cases, raw, { replay: args.includes('--replay') })
fs.writeFileSync(`${out}.md`, toMarkdown(report))
fs.writeFileSync(`${out}.json`, JSON.stringify(report, null, 1))
console.log(`wrote ${out}.md and ${out}.json: ${report.turns} questions in ${report.cases} cases${report.missing.length ? `; not yet run: ${report.missing.join(', ')}` : ''}`)
for (const [k, m] of Object.entries(report.metrics)) if (m.applicable) console.log(`  ${k}: ${m.passed} of ${m.applicable}`)
