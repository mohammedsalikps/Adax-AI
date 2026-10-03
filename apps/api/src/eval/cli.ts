// Usage (from apps/api):  npx tsx src/eval/cli.ts [--split dev|test|all] [--lang en|all] [--misses] [--extras]
// Runs the important-points extractor over the synthetic consultation set and prints per-category precision and recall.
// No network, no database, no model: the extractor is a fixed rule set. For speech-to-text, see src/eval/stt.ts.
import { loadDataset } from './dataset.ts'
import { runExtraction, toMarkdown } from './score.ts'

const args = process.argv.slice(2)
const opt = (name: string, fallback: string) => (args.includes(`--${name}`) ? (args[args.indexOf(`--${name}`) + 1] ?? fallback) : fallback)
const split = opt('split', 'dev')
const lang = opt('lang', 'en')
let data = loadDataset()
if (split !== 'all') data = data.filter((c) => c.split === split)
if (lang !== 'all') data = data.filter((c) => c.language === lang)

for (const condition of ['labelled', 'unlabelled'] as const) {
  const r = runExtraction(data, condition)
  console.log(toMarkdown(`${split} split, ${lang}, speakers ${condition}`, r))
  console.log('')
  if (condition === 'labelled' && args.includes('--misses')) for (const m of r.misses) console.log(`MISS ${m.file} t${m.gold.turn} [${m.gold.category}] "${m.gold.key}"  <=  ${m.turnText}`)
  if (condition === 'labelled' && args.includes('--extras')) for (const e of r.extras) console.log(`EXTRA ${e.file} [${e.fact.category}${e.fact.negated ? ' NEG' : ''}] ${e.fact.text}`)
}
