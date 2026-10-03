import { digitise } from '../ai/extract/rules.ts'

/**
 * Word error rate for the speech-to-text evaluation, with the (small, fixed, documented) normalisation applied to BOTH the script and the
 * model's text: case, punctuation and hyphens are ignored; number words and digits are compared as digits ("five hundred" = "500");
 * "mg" and "ml" are spelled out. Nothing else is forgiven: a different drug spelling, a missed word or a hallucinated one all count.
 */
const UNITS: Record<string, string> = { mg: 'milligrams', mcg: 'micrograms', ml: 'millilitres', kg: 'kilograms', ok: 'okay', 'x ray': 'xray' }

export function normaliseForWer(text: string): string[] {
  const t = digitise(
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/(\d),(\d)/g, '$1$2')
      .replace(/[-–—]/g, ' ')
      .replace(/(\d)\s*(mg|mcg|ml|kg)\b/g, '$1 $2'),
  )
    .replace(/[^\p{L}\p{N}\s.']/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = t.split(' ').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (w === 'x' && words[i + 1] === 'ray') {
      out.push('xray')
      i++
      continue
    }
    out.push(UNITS[w] ?? w)
  }
  return out
}

export interface WerResult {
  refWords: number
  errors: number
  substitutions: number
  deletions: number
  insertions: number
}

/** Word-level Levenshtein distance with the error kinds counted. */
export function wer(reference: string[], hypothesis: string[]): WerResult {
  const n = reference.length
  const m = hypothesis.length
  const d: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0))
  for (let i = 0; i <= n; i++) d[i]![0] = i
  for (let j = 0; j <= m; j++) d[0]![j] = j
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1))
  let i = n
  let j = m
  let substitutions = 0
  let deletions = 0
  let insertions = 0
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j]! === d[i - 1]![j - 1]! + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1)) {
      if (reference[i - 1] !== hypothesis[j - 1]) substitutions++
      i--
      j--
    } else if (i > 0 && d[i]![j]! === d[i - 1]![j]! + 1) {
      deletions++
      i--
    } else {
      insertions++
      j--
    }
  }
  return { refWords: n, errors: substitutions + deletions + insertions, substitutions, deletions, insertions }
}

export const addWer = (a: WerResult, b: WerResult): WerResult => ({
  refWords: a.refWords + b.refWords,
  errors: a.errors + b.errors,
  substitutions: a.substitutions + b.substitutions,
  deletions: a.deletions + b.deletions,
  insertions: a.insertions + b.insertions,
})
export const zeroWer = (): WerResult => ({ refWords: 0, errors: 0, substitutions: 0, deletions: 0, insertions: 0 })
export const werRate = (r: WerResult) => (r.refWords ? r.errors / r.refWords : null)
