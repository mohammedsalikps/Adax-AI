import { FactCategory, type TranscriptSegment } from '@adaxai/contracts'
import { describe, expect, it } from 'vitest'
import { digitise, EXTRACT_RULES_VERSION, extractFacts, RuleFactExtractor } from '../src/ai/extract/rules.ts'
import { loadDataset } from '../src/eval/dataset.ts'
import { runExtraction, segmentsOf } from '../src/eval/score.ts'

/** Lines as "Doctor: …" / "Patient: …" (labelled) or bare text (unlabelled), numbered S1, S2, … */
const lines = (...ls: string[]): TranscriptSegment[] =>
  ls.map((l, i) => {
    const m = /^(Doctor|Patient):\s*(.*)$/.exec(l)
    return { id: `S${i + 1}`, speaker: m ? m[1]! : null, text: m ? m[2]! : l }
  })
const facts = (...ls: string[]) => extractFacts(lines(...ls)).facts
const of = (category: string, fs: ReturnType<typeof facts>) => fs.filter((f) => f.category === category)

describe('numbers said aloud', () => {
  it.each([
    ['a hundred and thirty over eighty', '130 over 80'],
    ['one hundred twenty eight over eighty two', '128 over 82'],
    ['oxygen is ninety eight', 'oxygen is 98'],
    ['thirty eight point two', '38.2'],
    ['no numbers here at all', 'no numbers here at all'],
  ])('%s', (input, out) => expect(digitise(input)).toBe(out))
})

describe('what is a point and what is not', () => {
  it('a question is not a statement: nothing is extracted from "Do you have a fever?"', () => {
    expect(facts('Doctor: Do you have a fever or any chest pain?')).toEqual([])
  })

  it('reads negation and does not let it leak across "but" or "just"', () => {
    const fs = facts('Patient: No fever and no chest pain, but I have a cough.')
    expect(of('symptom', fs).filter((f) => f.negated).map((f) => f.text)).toEqual(expect.arrayContaining([expect.stringMatching(/fever/i)]))
    const cough = fs.filter((f) => /cough/i.test(f.text) && !f.negated)
    expect(cough.length).toBeGreaterThan(0)
    const lone = facts('Patient: No breathing trouble, just the cough.')
    expect(lone.filter((f) => f.negated).map((f) => f.text.toLowerCase())).toEqual(['no breathing trouble'])
  })

  it('takes the corrected duration, and only as an answer or about a complaint', () => {
    const fs = facts('Doctor: Since when have you had this?', 'Patient: Two days, no, three days.', 'Patient: I was stuck in traffic for forty minutes.')
    const d = of('duration', fs)
    expect(d.map((f) => f.details.duration)).toEqual(['three days'])
  })

  it('finds allergies, including a medicine named in answer to the question and a denial', () => {
    expect(of('allergy', facts('Patient: I am allergic to penicillin.')).map((f) => f.details.substance)).toEqual(['penicillin'])
    expect(of('allergy', facts('Patient: No known drug allergies.'))[0]).toMatchObject({ negated: true })
    const answered = facts('Doctor: Any allergy to medicines?', 'Patient: I think it was amoxicillin, I got a rash.')
    expect(of('allergy', answered).map((f) => f.details.substance)).toEqual(['amoxicillin'])
    expect(of('medication_history', answered)).toEqual([])
  })

  it('tells what the patient takes from what the doctor prescribes, and an instruction to stop from a prescription', () => {
    const fs = facts('Patient: I take metformin 500 milligrams every morning.', 'Doctor: I will start you on amlodipine 5 milligrams. Stop the ibuprofen.')
    expect(of('medication_history', fs).map((f) => [f.details.medication, f.attribution])).toEqual([['metformin', 'patient_reported']])
    expect(of('medication_mention', fs).map((f) => [f.details.medication, f.details.dose])).toEqual([['amlodipine', '5 milligrams']])
    expect(of('plan', fs).map((f) => f.text)).toEqual(['Stop the ibuprofen.'.replace(/\.$/, '')])
  })

  it('records vital signs said aloud with their values, and ignores impossible ones', () => {
    const fs = facts('Doctor: Your blood pressure is a hundred and thirty over eighty. Pulse is 78. Oxygen is 97. Temperature is 38.2.', 'Doctor: Your pulse is 400.')
    const v = of('vital_sign', fs)
    expect(v.map((f) => [f.details.vitalKind, f.details.value])).toEqual([
      ['systolic_bp', 130],
      ['heart_rate', 78],
      ['spo2', 97],
      ['temperature', 38.2],
    ])
  })

  it('splits a list of advice into points, and does not take an examination instruction for advice', () => {
    const fs = facts('Doctor: Open your mouth please. Rest at home, drink plenty of warm fluids and gargle with warm salt water.')
    expect(of('plan', fs).map((f) => f.text)).toEqual(['Rest at home', 'drink plenty of warm fluids', 'gargle with warm salt water'])
  })

  it('finds a test, whether advised or already done, and a follow-up', () => {
    const fs = facts('Doctor: If the fever stays we will do a blood test and a chest x-ray. Come back and see me in five days.', 'Patient: I had an ECG last month.')
    expect(of('investigation_mention', fs).map((f) => f.text)).toEqual(expect.arrayContaining(['blood test', 'chest x-ray', 'ECG']))
    expect(of('follow_up', fs)).toHaveLength(1)
  })

  it('marks a hedged statement as uncertain and says which word hedged it', () => {
    const f = of('clinician_assessment', facts('Doctor: I think this is probably a viral infection.'))[0]!
    expect(f).toMatchObject({ certainty: 'uncertain' })
    expect(f.uncertaintyReason).toMatch(/Hedged/)
  })
})

describe('who said it', () => {
  it('uses the speaker label when there is one', () => {
    const [f] = facts('Patient: I have a headache since yesterday.')
    expect(f).toMatchObject({ attribution: 'patient_reported', certainty: 'stated', uncertaintyReason: null })
  })

  it('guesses from the wording when there is none, and says so: such a point needs the doctor’s explicit confirmation', () => {
    const fs = facts('I have a headache since yesterday.', 'You should rest at home.')
    expect(fs.length).toBeGreaterThan(0)
    for (const f of fs) {
      expect(f.certainty).toBe('uncertain')
      expect(f.uncertaintyReason).toMatch(/guessed from the wording/)
    }
    expect(fs.map((f) => f.attribution)).toEqual(expect.arrayContaining(['patient_reported', 'clinician_stated']))
  })
})

describe('language', () => {
  it('does not attempt Hindi, Devanagari or Hinglish, and says how many lines it left out', () => {
    expect(extractFacts([{ id: 'S1', speaker: 'Patient', text: 'मुझे तीन दिन से बुखार है।' }])).toEqual({ facts: [], skippedLines: 1 })
    expect(extractFacts([{ id: 'S1', speaker: 'Patient', text: 'Mujhe teen din se bukhar hai.', language: 'hi' }])).toEqual({ facts: [], skippedLines: 1 })
    expect(extractFacts([{ id: 'S1', speaker: 'Patient', text: 'Mujhe bahut dard hai aur bukhar nahi hai doctor sahab.' }]).skippedLines).toBe(1)
    const mixed = extractFacts([
      { id: 'S1', speaker: 'Patient', text: 'I have a fever.' },
      { id: 'S2', speaker: 'Patient', text: 'दर्द है', language: 'hi' },
    ])
    expect(mixed.skippedLines).toBe(1)
    expect(mixed.facts.every((f) => f.sourceSegmentIds[0] === 'S1')).toBe(true)
  })
})

describe('properties that must hold for any input', () => {
  const data = loadDataset().filter((c) => c.supported)

  it('every point cites a line that exists, uses a known category, and is made only of words that were said', () => {
    for (const c of data) {
      for (const condition of ['labelled', 'unlabelled'] as const) {
        const { segments } = segmentsOf(c, condition)
        const byId = new Map(segments.map((s) => [s.id, s.text]))
        for (const f of extractFacts(segments).facts) {
          expect(FactCategory.safeParse(f.category).success, f.category).toBe(true)
          expect(f.sourceSegmentIds).toHaveLength(1)
          const source = byId.get(f.sourceSegmentIds[0]!)
          expect(source, `${c.id}: ${f.text}`).toBeDefined()
          // Verbatim: nothing is paraphrased or invented (whitespace aside).
          const squash = (s: string) => s.replace(/\s+/g, ' ').toLowerCase()
          expect(squash(source!), `${c.id} [${f.category}] "${f.text}"`).toContain(squash(f.text))
          expect(f.text.trim().length).toBeGreaterThan(1)
        }
      }
    }
  })

  it('is deterministic', () => {
    const { segments } = segmentsOf(data[0]!, 'labelled')
    expect(extractFacts(segments)).toEqual(extractFacts(segments))
  })

  it('finds nothing in small talk', () => {
    expect(facts('Patient: The traffic was terrible today.', 'Doctor: Ha, that road is always like that. Did you see the match last night?', 'Patient: What a finish.')).toEqual([])
  })

  it('is a local extractor: it says so, in English only, and carries its version', async () => {
    const x = new RuleFactExtractor()
    expect(x).toMatchObject({ provider: 'adaxai-rules', model: EXTRACT_RULES_VERSION, promptVersion: EXTRACT_RULES_VERSION, local: true, languages: ['en'] })
    const out = await x.extract(lines('Patient: I have a fever.'))
    expect(out).toMatchObject({ model: EXTRACT_RULES_VERSION, inputTokens: null, outputTokens: null, requestId: null })
  })
})

/** Lines of a recording, as the speech model returns them: each has a time (typed text has none). */
const recorded = (speaker: string | null, ...texts: string[]): TranscriptSegment[] =>
  texts.map((text, i) => ({ id: `S${i + 1}`, speaker, text, startMs: i * 20_000, endMs: i * 20_000 + 5000, language: 'en' }))

describe('a sentence cut where a recording part ended', () => {
  it('"I do not" | "have chest pain." is read whole: it is a denial, sourced from both lines', () => {
    const fs = extractFacts(recorded('Patient', 'I do not', 'have chest pain.')).facts
    expect(fs.some((f) => !f.negated && /chest pain/i.test(f.text))).toBe(false)
    const denial = fs.find((f) => /chest pain/i.test(f.text))
    expect(denial).toMatchObject({ negated: true, sourceSegmentIds: ['S1', 'S2'] })
  })

  it('"I have a cough but no" | "fever." keeps the negation on the fever', () => {
    const fs = extractFacts(recorded('Patient', 'I have a cough but no', 'fever.')).facts
    expect(fs.find((f) => /fever/i.test(f.text))).toMatchObject({ negated: true })
    expect(fs.find((f) => /cough/i.test(f.text))).toMatchObject({ negated: false })
  })

  it('a recorded line that still ends mid-sentence is flagged for the doctor, with the reason in words', () => {
    const fs = extractFacts(recorded('Patient', 'I have had fever and a cough for three days and I', 'Okay. That is all.')).facts
    const fever = fs.find((f) => /fever/i.test(f.text))!
    expect(fever.certainty).toBe('uncertain')
    expect(fever.uncertaintyReason).toMatch(/cut where a recording part ended/)
  })

  it('typed lines have no times and are never stitched or flagged', () => {
    const fs = extractFacts(lines('Patient: I do not', 'Patient: have chest pain.')).facts
    expect(fs.every((f) => f.sourceSegmentIds.length === 1)).toBe(true)
    expect(fs.every((f) => !/cut where a recording part ended/.test(f.uncertaintyReason ?? ''))).toBe(true)
  })

  it('does not join lines of different speakers, nor a line that starts a new sentence', () => {
    const a = extractFacts([...recorded('Patient', 'I do not'), { id: 'S2', speaker: 'Doctor', text: 'have you had chest pain.', startMs: 20_000, endMs: 25_000, language: 'en' }]).facts
    expect(a.every((f) => f.sourceSegmentIds.length === 1)).toBe(true)
    const b = extractFacts(recorded('Patient', 'I have a fever and', 'No chest pain.')).facts
    expect(b.find((f) => /chest pain/i.test(f.text))).toMatchObject({ negated: true, sourceSegmentIds: ['S2'] })
  })
})

describe('who said it, when the speaker is a relative', () => {
  it('a point said by a relative or attendant is on the patient side but needs a check by the doctor', () => {
    const fs = extractFacts([{ id: 'S1', speaker: 'Relative', text: 'She has had diabetes for ten years.' }]).facts
    expect(fs.length).toBeGreaterThan(0)
    for (const f of fs) {
      expect(f.certainty).toBe('uncertain')
      expect(f.uncertaintyReason).toMatch(/Said by a relative/)
    }
  })
})

describe('very long input does not stall the process', () => {
  const time = (fn: () => unknown) => {
    const t0 = performance.now()
    fn()
    return performance.now() - t0
  }

  it('50,000 characters with no sentence end are read in well under a second', () => {
    const long = 'no cough '.repeat(5500)
    expect(time(() => extractFacts([{ id: 'S1', speaker: 'Patient', text: long }]))).toBeLessThan(1500)
    expect(time(() => extractFacts([{ id: 'S1', speaker: 'Patient', text: 'cough '.repeat(8000) }]))).toBeLessThan(1500)
    expect(time(() => extractFacts([{ id: 'S1', speaker: 'Patient', text: 'for two days '.repeat(4000) }]))).toBeLessThan(1500)
  })
})

describe('measured on the synthetic set (development split)', () => {
  // Floors a little under what was measured when the rules were written; they catch a regression, they are not a quality claim.
  const dev = loadDataset().filter((c) => c.split === 'dev' && c.supported)

  it('keeps precision and recall on the speaker-labelled development transcripts', () => {
    const r = runExtraction(dev, 'labelled')
    const p = r.overall.tp / (r.overall.tp + r.overall.fp)
    const rec = r.overall.tp / (r.overall.tp + r.overall.fn)
    expect(p).toBeGreaterThan(0.75)
    expect(rec).toBeGreaterThan(0.8)
  })

  it('does worse without speaker labels, and that is the point: unlabelled lines need the doctor', () => {
    const labelled = runExtraction(dev, 'labelled')
    const unlabelled = runExtraction(dev, 'unlabelled')
    expect(unlabelled.overall.tp).toBeLessThanOrEqual(labelled.overall.tp)
  })
})

describe('measured once on the held-out test split (3 Oct 2026, after the rules were frozen)', () => {
  // Floors under what was measured (English, speaker-labelled: precision 75%, recall 53%; the same rules scored 83% and 89% on the development split they
  // were written against). They catch a regression; they are not a quality claim, and the gap between the two splits is the finding.
  const held = loadDataset().filter((c) => c.split === 'test')

  it('English: precision and recall stay above the floors', () => {
    const r = runExtraction(
      held.filter((c) => c.language === 'en'),
      'labelled',
    )
    expect(r.overall.tp / (r.overall.tp + r.overall.fp)).toBeGreaterThan(0.65)
    expect(r.overall.tp / (r.overall.tp + r.overall.fn)).toBeGreaterThan(0.43)
  })

  it('Hindi and Hinglish: nothing is extracted, and every such file is reported as skipped rather than guessed at', () => {
    const r = runExtraction(
      held.filter((c) => !c.supported),
      'labelled',
    )
    expect(r.predicted).toBe(0)
    expect(r.skippedFiles.sort()).toEqual(['h01', 'h02', 'x01'])
  })
})
