import type { FactCategory, TranscriptSegment } from '@adaxai/contracts'
import { extractFacts } from '../ai/extract/rules.ts'
import type { ExtractedFact } from '../ai/providers.ts'
import type { Consultation, Gold } from './dataset.ts'

export interface Counts {
  tp: number
  fp: number
  fn: number
  /** Of the matched pairs: the negation flag agreed / the hedge flag agreed. */
  negationAgree: number
  hedgeAgree: number
  /** Of the matched pairs the extractor put on one side (patient said / doctor said): how many named the side that really spoke the turn. */
  sideAgree: number
  sideAsked: number
}
export const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0, negationAgree: 0, hedgeAgree: 0, sideAgree: 0, sideAsked: 0 })

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A point matches a gold row when it has the same category, comes from the same turn, and its words contain the gold key. */
export function matches(f: ExtractedFact, turnOf: Map<string, number>, g: Gold): boolean {
  if (f.category !== g.category) return false
  if (!f.sourceSegmentIds.some((id) => turnOf.get(id) === g.turn)) return false
  const text = norm(`${f.text} ${f.details.medication ?? ''} ${f.details.substance ?? ''} ${f.details.duration ?? ''}`)
  return text.includes(norm(g.key))
}

export function scoreConsultation(facts: ExtractedFact[], turnOf: Map<string, number>, gold: Gold[], speakers: readonly string[] = []): { byCategory: Map<FactCategory, Counts>; misses: Gold[]; extras: ExtractedFact[] } {
  const by = new Map<FactCategory, Counts>()
  const get = (c: FactCategory) => {
    if (!by.has(c)) by.set(c, zero())
    return by.get(c)!
  }
  const used = new Set<number>()
  const misses: Gold[] = []
  for (const g of gold) {
    const i = facts.findIndex((f, k) => !used.has(k) && matches(f, turnOf, g))
    const c = get(g.category)
    if (i < 0) {
      c.fn++
      misses.push(g)
      continue
    }
    used.add(i)
    c.tp++
    const side = facts[i]!.attribution
    if (speakers[g.turn] && (side === 'patient_reported' || side === 'clinician_stated')) {
      c.sideAsked++
      if (side === (speakers[g.turn] === 'Patient' ? 'patient_reported' : 'clinician_stated')) c.sideAgree++
    }
    if (facts[i]!.negated === g.negated) c.negationAgree++
    if ((facts[i]!.certainty === 'uncertain' && /Hedged/.test(facts[i]!.uncertaintyReason ?? '')) === g.uncertain) c.hedgeAgree++
  }
  const extras: ExtractedFact[] = []
  facts.forEach((f, k) => {
    if (!used.has(k)) {
      get(f.category as FactCategory).fp++
      extras.push(f)
    }
  })
  return { byCategory: by, misses, extras }
}

export type Condition = 'labelled' | 'unlabelled'

/** The consultation as transcript lines: one per turn (S1 is turn 0). "unlabelled" drops the speaker names, as a live recording has them. */
export function segmentsOf(c: Consultation, condition: Condition = 'labelled', textOf: (turn: number) => string = (i) => c.turns[i]!.text): { segments: TranscriptSegment[]; turnOf: Map<string, number> } {
  const turnOf = new Map<string, number>()
  const segments = c.turns.map((t, i) => {
    const id = `S${i + 1}`
    turnOf.set(id, i)
    return { id, speaker: condition === 'labelled' ? t.speaker : null, text: textOf(i), ...(c.language ? { language: c.language } : {}) }
  })
  return { segments, turnOf }
}

export interface Report {
  files: number
  gold: number
  predicted: number
  overall: Counts
  byCategory: Map<FactCategory, Counts>
  skippedFiles: string[]
  misses: { file: string; gold: Gold; turnText: string }[]
  extras: { file: string; fact: ExtractedFact }[]
}

export function runExtraction(data: Consultation[], condition: Condition = 'labelled', textOf?: (c: Consultation, turn: number) => string): Report {
  const report: Report = { files: 0, gold: 0, predicted: 0, overall: zero(), byCategory: new Map(), skippedFiles: [], misses: [], extras: [] }
  for (const c of data) {
    report.files++
    const { segments, turnOf } = segmentsOf(c, condition, textOf ? (i) => textOf(c, i) : undefined)
    const { facts, skippedLines } = extractFacts(segments)
    if (skippedLines) report.skippedFiles.push(c.id)
    const s = scoreConsultation(facts, turnOf, c.gold, c.turns.map((t) => t.speaker))
    report.gold += c.gold.length
    report.predicted += facts.length
    for (const [cat, k] of s.byCategory) {
      const t = report.byCategory.get(cat) ?? zero()
      for (const key of Object.keys(k) as (keyof Counts)[]) t[key] += k[key]
      report.byCategory.set(cat, t)
      for (const key of Object.keys(k) as (keyof Counts)[]) report.overall[key] += k[key]
    }
    for (const g of s.misses) report.misses.push({ file: c.id, gold: g, turnText: c.turns[g.turn]!.text })
    for (const f of s.extras) report.extras.push({ file: c.id, fact: f })
  }
  return report
}

export const precision = (c: Counts) => (c.tp + c.fp ? c.tp / (c.tp + c.fp) : null)
export const recall = (c: Counts) => (c.tp + c.fn ? c.tp / (c.tp + c.fn) : null)
export const f1 = (c: Counts) => {
  const p = precision(c)
  const r = recall(c)
  return p !== null && r !== null && p + r > 0 ? (2 * p * r) / (p + r) : null
}
const pct = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(0)}%`)

export function toMarkdown(title: string, r: Report): string {
  const rows = [...r.byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const line = (name: string, c: Counts) => `| ${name} | ${c.tp + c.fn} | ${c.tp + c.fp} | ${c.tp} | ${pct(precision(c))} | ${pct(recall(c))} | ${pct(f1(c))} |`
  return [
    `**${title}** (${r.files} files, ${r.gold} gold points, ${r.predicted} proposed points)`,
    '',
    '| Category | Gold | Proposed | Matched | Precision | Recall | F1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(([name, c]) => line(name, c)),
    line('**All**', r.overall),
    '',
    `Of the matched points: negation agreed on ${pct(r.overall.tp ? r.overall.negationAgree / r.overall.tp : null)}, hedging agreed on ${pct(r.overall.tp ? r.overall.hedgeAgree / r.overall.tp : null)}; who said it (patient or doctor) was right on ${pct(r.overall.sideAsked ? r.overall.sideAgree / r.overall.sideAsked : null)} of the ${r.overall.sideAsked} points placed on a side.`,
  ].join('\n')
}
