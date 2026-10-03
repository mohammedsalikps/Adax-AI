import { describe, expect, it } from 'vitest'
import { addWer, normaliseForWer, wer, werRate, zeroWer } from '../src/eval/wer.ts'

describe('word error rate (the speech-to-text evaluation)', () => {
  const w = (ref: string, hyp: string) => wer(normaliseForWer(ref), normaliseForWer(hyp))

  it('counts substitutions, deletions and insertions separately', () => {
    expect(w('I have a fever', 'I have a fever')).toMatchObject({ errors: 0, refWords: 4 })
    expect(w('I have a fever', 'I have the fever')).toMatchObject({ substitutions: 1, deletions: 0, insertions: 0, errors: 1 })
    expect(w('I have a fever', 'I have fever')).toMatchObject({ substitutions: 0, deletions: 1, insertions: 0, errors: 1 })
    expect(w('I have a fever', 'I have a high fever')).toMatchObject({ substitutions: 0, deletions: 0, insertions: 1, errors: 1 })
    expect(werRate(w('I have a fever', 'I have a fever'))).toBe(0)
    expect(werRate(w('alpha bravo charlie delta', 'completely different here now'))).toBe(1)
  })

  it('an empty answer is all deletions, and an empty script is not divided by', () => {
    expect(w('no allergies at all', '')).toMatchObject({ deletions: 4, errors: 4, refWords: 4 })
    expect(werRate(zeroWer())).toBeNull()
  })

  it('is lenient about case, punctuation, hyphens and how numbers and units are written, and about nothing else', () => {
    expect(w('Take five hundred milligrams twice a day.', 'Take 500 mg twice a day')).toMatchObject({ errors: 0 })
    expect(w('a chest x-ray', 'A chest X-ray.')).toMatchObject({ errors: 0 })
    expect(w('thirty eight point two', '38.2')).toMatchObject({ errors: 0 })
    // A different drug, or a missing negation, is an error however it is spelt.
    expect(w('no chest pain', 'chest pain').errors).toBe(1)
    expect(w('take metformin', 'take metoprolol').errors).toBe(1)
  })

  it('sums across turns', () => {
    const total = addWer(w('a b c d', 'a b c e'), w('x y', 'x y'))
    expect(total).toMatchObject({ refWords: 6, errors: 1 })
    expect(werRate(total)).toBeCloseTo(1 / 6)
  })
})
