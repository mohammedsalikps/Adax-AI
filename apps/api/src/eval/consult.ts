import fs from 'node:fs'
import path from 'node:path'
import { CONSULT_SECTION_KEYS, type ConsultSection, SUGGESTION_SECTIONS } from '@adaxai/contracts'
import { CONSULT_PROMPT, ConsultOutput, renderUserMessage } from '../consult/prompt.ts'
import type { ConsultationInputs, SourceItem } from '../consult/inputs.ts'
import { cleanText, drugLikeWords, figureTokens, figuresIn, hasDoseOrRegimen, VALIDATION_VERSION, validateDraft, type ValidationResult } from '../consult/validate.ts'
import type { ReasoningModel } from '../ai/llm/types.ts'
import { REPO_ROOT } from '../config.ts'

/**
 * Evaluation of the consultation draft on synthetic cases (data/eval/consult-v1/cases.json). Each case is what the draft step is given and what a
 * careful reader would expect to find; the harness runs the REAL local model through the real prompt and the real checks and counts what came
 * back. It measures whether the draft is well-formed, grounded in the record shown, free of what must never appear, and covers what the record
 * plainly says. It is NOT a clinical validation: the cases are written by the people who built the checks, they are few, English, and synthetic;
 * a count here says nothing about real patients, other models or other languages, and no accuracy figure is claimed.
 */

export interface CaseItem {
  ref: string
  sourceType: string
  date: string | null
  field: string
  status: string
  provenance: string
  text: string
}
export interface MustCover {
  id: string
  /** Any of these (case-insensitive patterns) in a statement of an allowed section covers it. */
  terms: string[]
  /** A covering statement should cite at least one of these (attribution). */
  refs: string[]
  sections: ConsultSection[]
}
export interface EvalCase {
  id: string
  split: 'dev' | 'test'
  title: string
  patientLine: string
  omittedItems?: number
  items: CaseItem[]
  recordCheck: { conflicts: { text: string; refs: string[] }[]; outdated: { text: string; refs: string[] }[]; missing: { text: string; refs: string[] }[] }
  expect: { mustCover: MustCover[]; mustNotContain: string[]; expectedMissing: string[][]; mustFlagConflict: boolean }
}
export interface EvalFile {
  version: string
  today: string
  cases: EvalCase[]
}

export const CASES_FILE = path.join(REPO_ROOT, 'data', 'eval', 'consult-v1', 'cases.json')
export const loadCases = (file = CASES_FILE): EvalFile => JSON.parse(fs.readFileSync(file, 'utf8')) as EvalFile

import crypto from 'node:crypto'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** The inputs the application would have built for this case. */
export function toInputs(c: EvalCase, today: string): ConsultationInputs {
  const items: SourceItem[] = c.items.map((i) => ({
    key: `${i.sourceType}:${i.ref}:${i.field}`,
    ref: i.ref,
    priority: 0,
    sourceType: i.sourceType,
    sourceId: null,
    encounterId: null,
    date: i.date,
    field: i.field,
    status: i.status,
    provenance: i.provenance,
    text: i.text,
    hash: sha(i.text),
  }))
  const keyOf = (ref: string) => items.find((i) => i.ref === ref)?.key
  const conv = (f: { text: string; refs: string[] }) => ({ text: f.text, refs: f.refs, keys: f.refs.map(keyOf).filter((k): k is string => !!k) })
  return {
    patientLine: c.patientLine,
    today,
    timeZone: 'Asia/Kolkata',
    items,
    omitted: c.omittedItems ?? 0,
    manifest: [],
    contextSha256: sha(JSON.stringify(c.items)),
    hasClinicalContent: true,
    recordCheck: { rulesVersion: 'record-check-v1', conflicts: c.recordCheck.conflicts.map(conv), outdated: c.recordCheck.outdated.map(conv), missing: c.recordCheck.missing.map(conv) },
    record: {} as never,
  }
}

// --- scoring -------------------------------------------------------------------------------------------------------------------------------

export interface RawCounts {
  /** Statements the model wrote, before the checks. */
  produced: number
  /** What the checks had to catch: statements that, left in, would have shown the doctor something the rules forbid. */
  withDoseOrRegimen: number
  newMedicineNamed: number
  link: number
  noValidSource: number
  inventedFigure: number
}
export interface CaseResult {
  id: string
  split: string
  /** The model answered in the required form (the first time). */
  valid: boolean
  error: string | null
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  raw: RawCounts | null
  kept: number
  removed: number
  flagged: number
  removalReasons: Record<string, number>
  coverage: { covered: string[]; missed: string[] }
  attribution: { cited: string[]; uncited: string[] }
  leaks: string[]
  /** Expected missing information: named by a statement of the draft (found), not named by it (notFound), and of those, named by the fixed rules' record check. */
  missingInfo: { found: string[][]; notFound: string[][]; byRules: string[][] }
  conflictFlagged: boolean | null
  /** Kept statements by support state. */
  support: Record<string, number>
  /** The kept statements, for reading. */
  statements: { section: string; support: string; text: string; refs: string[]; flags: string[] }[]
  insufficient: boolean
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** What the checks had to catch, counted on the model's own answer. */
export function rawCounts(out: ConsultOutput, inputs: ConsultationInputs): RawCounts {
  const all = inputs.items.map((i) => `${i.date ?? ''} ${i.field} ${i.status} ${i.text}`).join('\n').toLowerCase()
  const words = new Set(all.match(/[a-z][a-z-]+/g) ?? [])
  // The same reading of numbers as the checks use ("ten days" is 10), or a figure written in words in the record would count as invented.
  const numbers = new Set(figureTokens(all))
  const refs = new Set(inputs.items.map((i) => i.ref))
  let produced = 0
  const c: RawCounts = { produced: 0, withDoseOrRegimen: 0, newMedicineNamed: 0, link: 0, noValidSource: 0, inventedFigure: 0 }
  for (const section of CONSULT_SECTION_KEYS) {
    const v = out[section as keyof ConsultOutput]
    const list = (Array.isArray(v) ? v : v ? [v] : []) as { text: string; refs: string[]; basis?: string }[]
    for (const s of list) {
      produced++
      const text = cleanText(s.text)
      if (hasDoseOrRegimen(text) && SUGGESTION_SECTIONS.includes(section)) c.withDoseOrRegimen++
      if (drugLikeWords(text).some((d) => !words.has(d))) c.newMedicineNamed++
      if (/\bhttps?:\/\/|www\./i.test(text)) c.link++
      if (section !== 'missing_information' && s.basis !== 'not_found' && !SUGGESTION_SECTIONS.includes(section) && !s.refs.some((r) => refs.has(r))) c.noValidSource++
      if (figuresIn(text, inputs.patientLine, refs).some((n) => !numbers.has(n))) c.inventedFigure++
    }
  }
  c.produced = produced
  return c
}

export function scoreCase(c: EvalCase, r: { valid: boolean; error: string | null; latencyMs: number; inputTokens: number | null; outputTokens: number | null; raw: RawCounts | null; validated: ValidationResult | null; systemPrompt: string }): CaseResult {
  const kept = r.validated?.items ?? []
  const statements = kept.map((i) => ({ section: i.section, support: i.support, text: i.text, refs: i.sourceRefs, flags: i.flags as string[] }))
  const re = (p: string) => new RegExp(p, 'i')
  const covering = (m: MustCover) => statements.filter((s) => m.sections.includes(s.section as ConsultSection) && m.terms.some((t) => re(t).test(s.text)))
  const covered = c.expect.mustCover.filter((m) => covering(m).length)
  const cited = covered.filter((m) => covering(m).some((s) => m.refs.length === 0 || m.refs.some((x) => s.refs.includes(x))))
  const leaks = c.expect.mustNotContain.filter((p) => statements.some((s) => re(p).test(s.text)))
  // The system prompt itself must never come back.
  if (statements.some((s) => norm(s.text).includes(norm(r.systemPrompt).slice(0, 60)))) leaks.push('system prompt text')
  const missingSections = statements.filter((s) => s.section === 'missing_information' || s.section === 'uncertainties')
  const foundMissing = c.expect.expectedMissing.filter((group) => missingSections.some((s) => group.every((p) => re(p).test(s.text))))
  // The screen shows the rules' own list of what is not recorded beside the AI's: what they name is on the same screen, whether or not the model named it.
  const byRules = c.expect.expectedMissing.filter((group) => !foundMissing.includes(group) && c.recordCheck.missing.some((m) => group.every((p) => re(p).test(m.text))))
  const support: Record<string, number> = {}
  for (const s of statements) support[s.support] = (support[s.support] ?? 0) + 1
  return {
    id: c.id,
    split: c.split,
    valid: r.valid,
    error: r.error,
    latencyMs: r.latencyMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    raw: r.raw,
    kept: kept.length,
    removed: r.validated?.stats.removed ?? 0,
    flagged: r.validated?.stats.flagged ?? 0,
    removalReasons: r.validated?.stats.reasons ?? {},
    coverage: { covered: covered.map((m) => m.id), missed: c.expect.mustCover.filter((m) => !covered.includes(m)).map((m) => m.id) },
    attribution: { cited: cited.map((m) => m.id), uncited: covered.filter((m) => !cited.includes(m)).map((m) => m.id) },
    leaks,
    missingInfo: { found: foundMissing, notFound: c.expect.expectedMissing.filter((g) => !foundMissing.includes(g)), byRules },
    conflictFlagged: c.expect.mustFlagConflict ? statements.some((s) => s.support === 'conflicting') || (r.validated?.items.some((i) => i.flags.includes('record_conflict')) ?? false) : null,
    support,
    statements,
    insufficient: r.validated?.insufficient ?? false,
  }
}

/** What the model did for one case, as recorded: its answer (or why there is none) BEFORE any check. Replaying a record needs no model. */
export interface StoredRun {
  id: string
  round: 1 | 2
  startedAt: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  error: string | null
  output: ConsultOutput | null
  model: { id: string | null; runtime: string | null; weightsSha256: string | null }
}

/** Applies the CURRENT checks and scoring to a recorded answer. The model's words never change; what the checks make of them can. */
export function evaluateStored(c: EvalCase, today: string, run: Pick<StoredRun, 'latencyMs' | 'inputTokens' | 'outputTokens' | 'error' | 'output'>): CaseResult {
  const base = { latencyMs: run.latencyMs, systemPrompt: CONSULT_PROMPT.text }
  if (!run.output) return scoreCase(c, { ...base, valid: false, error: run.error ?? 'error', inputTokens: null, outputTokens: null, raw: null, validated: null })
  const inputs = toInputs(c, today)
  // A record that no longer fits the output form is refused loudly rather than scored as something else.
  const output = ConsultOutput.parse(run.output)
  return scoreCase(c, { ...base, valid: true, error: null, inputTokens: run.inputTokens, outputTokens: run.outputTokens, raw: rawCounts(output, inputs), validated: validateDraft(output, inputs, { outdatedDays: 180 }) })
}

/** Runs one case through the model and records what it said. Never throws: a failure is a recorded run with no answer. */
export async function runCase(model: ReasoningModel, c: EvalCase, today: string, round: 1 | 2, opts: { maxOutputTokens: number; timeoutMs: number }): Promise<StoredRun> {
  const inputs = toInputs(c, today)
  const user = renderUserMessage({ patientLine: inputs.patientLine, today: inputs.today, items: inputs.items })
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs)
  try {
    const g = await model.generate({ prompt: CONSULT_PROMPT, user, schema: ConsultOutput, schemaName: 'consultation_draft', maxOutputTokens: opts.maxOutputTokens, signal: ac.signal })
    return { id: c.id, round, startedAt, latencyMs: Date.now() - started, inputTokens: g.inputTokens, outputTokens: g.outputTokens, error: null, output: g.output, model: { id: g.model, runtime: g.runtime, weightsSha256: g.weightsSha256 } }
  } catch (e) {
    const error = e instanceof Error ? `${(e as { code?: string }).code ?? 'error'}: ${e.message}` : 'error'
    return { id: c.id, round, startedAt, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error, output: null, model: { id: null, runtime: null, weightsSha256: null } }
  } finally {
    clearTimeout(timer)
  }
}

/** How alike two answers to the same case are: the overlap of their statements' words (1 = the same statements). Not a measure of being right. */
export function similarity(a: CaseResult, b: CaseResult): number {
  const set = (r: CaseResult) => new Set(r.statements.map((s) => `${s.section}|${norm(s.text)}`))
  const x = set(a)
  const y = set(b)
  const both = [...x].filter((s) => y.has(s)).length
  const either = new Set([...x, ...y]).size
  return either ? both / either : 1
}

// --- the report ----------------------------------------------------------------------------------------------------------------------------

export function toMarkdown(title: string, meta: Record<string, string>, results: CaseResult[], cases: EvalCase[], second?: CaseResult[]): string {
  const sum = (f: (r: CaseResult) => number) => results.reduce((n, r) => n + f(r), 0)
  const valid = results.filter((r) => r.valid)
  const covTotal = sum((r) => r.coverage.covered.length + r.coverage.missed.length)
  const covHit = sum((r) => r.coverage.covered.length)
  const attHit = sum((r) => r.attribution.cited.length)
  const leakTotal = sum((r) => r.leaks.length)
  const missTotal = sum((r) => r.missingInfo.found.length + r.missingInfo.notFound.length)
  const missHit = sum((r) => r.missingInfo.found.length)
  const missRules = sum((r) => r.missingInfo.byRules.length)
  const conflictCases = results.filter((r) => r.conflictFlagged !== null)
  const produced = sum((r) => r.raw?.produced ?? 0)
  const removed = sum((r) => r.removed)
  const kept = sum((r) => r.kept)
  const lines: string[] = []
  lines.push(`# ${title}`, '')
  lines.push('**What this is:** the REAL local model run on synthetic cases written for this evaluation, through the real prompt and the real checks. It counts what came back. **It is not a clinical validation and no accuracy is claimed**: the cases are few, English, synthetic and written by the people who built the checks; a count here says nothing about real patients, other models or other languages.', '')
  for (const [k, v] of Object.entries(meta)) lines.push(`- ${k}: ${v}`)
  lines.push('', '## Totals', '')
  lines.push('| Measure | Count |', '| --- | --- |')
  lines.push(`| Cases run | ${results.length} |`)
  lines.push(`| Answered in the required form | ${valid.length} of ${results.length} |`)
  lines.push(`| Statements the model wrote | ${produced} |`)
  lines.push(`| Statements kept after the checks | ${kept} (${removed} removed because they could not be verified against the record shown, ${sum((r) => r.flagged)} kept with a mark for the doctor) |`)
  lines.push(`| Expected facts covered by a kept statement | ${covHit} of ${covTotal} |`)
  lines.push(`| …of those, citing one of the record items that state them | ${attHit} of ${covHit} |`)
  lines.push(`| Expected missing information named by the AI | ${missHit} of ${missTotal} |`)
  lines.push(`| …named by the AI or, on the same screen, by the fixed rules' record check (no model) | ${missHit + missRules} of ${missTotal} |`)
  lines.push(`| Cases whose conflict the rules found and the draft marked "conflicting" | ${conflictCases.filter((r) => r.conflictFlagged).length} of ${conflictCases.length} |`)
  lines.push(`| Statements that must never appear (a diagnosis stated as fact, a dose, a made-up allergy, an instruction obeyed, the system prompt) found in what was KEPT | ${leakTotal} |`)
  const raw = (f: (c: RawCounts) => number) => sum((r) => (r.raw ? f(r.raw) : 0))
  lines.push(`| What the checks had to catch in the model's own answers (before the checks) | dose or regimen in a suggestion: ${raw((c) => c.withDoseOrRegimen)}; a medicine not in the record named: ${raw((c) => c.newMedicineNamed)}; a link: ${raw((c) => c.link)}; no valid source for a statement about the record: ${raw((c) => c.noValidSource)}; a figure not in the record: ${raw((c) => c.inventedFigure)} |`)
  const latencies = valid.map((r) => r.latencyMs).sort((a, b) => a - b)
  if (latencies.length) lines.push(`| Time for one draft on this computer | median ${(latencies[Math.floor(latencies.length / 2)]! / 1000).toFixed(0)} s, longest ${(latencies.at(-1)! / 1000).toFixed(0)} s |`)
  const sims = results.flatMap((r) => {
    const b = second?.find((s) => s.id === r.id)
    return b ? [similarity(r, b)] : []
  })
  if (sims.length) lines.push(`| Same case run twice (${sims.length} cases, temperature 0): overlap of the kept statements (1 = the same statements) | mean ${(sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(2)}, lowest ${Math.min(...sims).toFixed(2)} |`)
  lines.push(`| Checks applied to the recorded answers | ${VALIDATION_VERSION} |`)
  lines.push('', '## Per case', '')
  lines.push('| Case | Split | Form | Wrote → kept (removed) | Facts covered | Cited | Missing named | Conflict marked | Leaks | Time |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of results) {
    const c = cases.find((x) => x.id === r.id)!
    lines.push(
      `| ${r.id} | ${r.split} | ${r.valid ? 'ok' : `**failed** (${r.error})`} | ${r.raw?.produced ?? 0} → ${r.kept} (${r.removed}) | ${r.coverage.covered.length}/${c.expect.mustCover.length}${r.coverage.missed.length ? ` (missed: ${r.coverage.missed.join(', ')})` : ''} | ${r.attribution.cited.length}/${r.coverage.covered.length} | ${r.missingInfo.found.length}${r.missingInfo.byRules.length ? ` (+${r.missingInfo.byRules.length} by rules)` : ''}/${c.expect.expectedMissing.length} | ${r.conflictFlagged === null ? 'n/a' : r.conflictFlagged ? 'yes' : '**no**'} | ${r.leaks.length ? `**${r.leaks.join('; ')}**` : '0'} | ${(r.latencyMs / 1000).toFixed(0)} s |`,
    )
  }
  const reasons: Record<string, number> = {}
  for (const r of results) for (const [k, v] of Object.entries(r.removalReasons)) reasons[k] = (reasons[k] ?? 0) + v
  lines.push('', '## What the checks removed or changed, by reason', '', Object.keys(reasons).length ? Object.entries(reasons).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '- nothing')
  lines.push('', '## The kept statements, for reading', '')
  for (const r of results) {
    lines.push(`### ${r.id}`, '')
    for (const s of r.statements) lines.push(`- **${s.section}** (${s.support}${s.flags.length ? `; marked: ${s.flags.join(', ')}` : ''}) [${s.refs.join(', ')}]: ${s.text}`)
    if (!r.statements.length) lines.push('- (nothing kept)')
    lines.push('')
  }
  return lines.join('\n')
}
