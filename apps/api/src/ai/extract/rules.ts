import type { FactCategory, TranscriptSegment, VitalKind } from '@adaxai/contracts'
import type { ExtractedFact, FactExtractor } from '../providers.ts'
import { CLINICIAN_SIDE, PATIENT_SIDE } from '../transcripts.ts'
import { BODY_PARTS, CONDITIONS, DRUG_SUFFIX, DRUGS, FINDING_WORDS, HEDGE_CUES, HINGLISH, INVESTIGATIONS, NEGATION_CUES, RED_FLAGS, RELATIVES, SYMPTOMS, WEAK_SYMPTOMS } from './lexicon.ts'

/**
 * Important-point extraction by fixed rules (no model, no network, nothing leaves this process). Version `extract-rules-v1`.
 *
 * What it does: reads the transcript lines one sentence at a time and proposes points (chief complaint, symptoms, durations, history,
 * medicines, allergies, examination findings, vital signs, assessments, plans, investigations, concerns, follow-up), each tied to the line
 * it came from, with negation and hedging noted. What it does not do: understand. It matches words from the lists in lexicon.ts and a
 * few sentence shapes, in English only; a medicine, symptom or phrase that is not covered is not found; a sentence it cannot place is
 * left out rather than guessed. Every point is a draft for the doctor to confirm or reject: nothing it produces is part of the record.
 *
 * Who said a line comes from the speaker label if there is one. If there is none it is guessed from the wording ("I", "my" versus "you"),
 * and a point whose speaker was guessed says so and needs the doctor's explicit confirmation.
 */
export const EXTRACT_RULES_VERSION = 'extract-rules-v1'

type Side = 'patient' | 'clinician'
interface Unit {
  seg: TranscriptSegment
  /** The lines it came from: one, or several when a sentence was cut where a recording part ended and is read whole. */
  ids: string[]
  /** The sentence starts or ends where a recording part was cut, so it may be part of a sentence that continues elsewhere. */
  cutOff: boolean
  /** Index of the line (not the sentence) in the transcript. */
  line: number
  text: string
  question: boolean
  side: Side | null
  /** The side came from a speaker label (true) or was guessed from the wording (false). */
  labelled: boolean
  /** The line before asked how long / about allergies, so a bare answer is read as one. */
  afterDurationQuestion: boolean
  afterAllergyQuestion: boolean
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
const phrases = (list: string[]) => `(?<![\\p{L}\\p{N}])(?:${[...list].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`
const G = (src: string) => new RegExp(src, 'giu')
const I = (src: string) => new RegExp(src, 'iu')

const SRC = {
  symptom: phrases(SYMPTOMS),
  condition: phrases(CONDITIONS),
  drug: phrases(DRUGS),
  investigation: phrases(INVESTIGATIONS),
  relative: phrases(RELATIVES),
  body: phrases(BODY_PARTS),
  hedge: phrases(HEDGE_CUES),
  negation: phrases(NEGATION_CUES),
  finding: phrases(FINDING_WORDS),
}
const ANY = { symptom: I(SRC.symptom), condition: I(SRC.condition), body: I(SRC.body), investigation: I(SRC.investigation), finding: I(SRC.finding) }

const NUM = String.raw`(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|couple\s+of|a\s+couple\s+of|few|a\s+few|several|half\s+an?|sixteen|fourteen)`
const UNIT = String.raw`(?:minute|hour|day|week|month|year)s?`
const DURATION_SRC = String.raw`(?:(?:for|since|over|past|last|about|around|nearly|almost|from)\s+)?(?:the\s+)?(?:(?:last|past)\s+)?${NUM}(?:\s+and\s+a\s+half)?\s*${UNIT}(?:\s+ago)?|since\s+(?:yesterday|this\s+morning|last\s+night|morning|childhood|birth|last\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|evening|night))?)|from\s+yesterday|for\s+ages|overnight`
const SELF_CORRECTION = I(String.raw`(?:${DURATION_SRC})[,.]?\s+(?:no|sorry|i\s+mean|actually|wait)[,.]?\s+(?:[a-z,\s]{0,40}?)((?:${DURATION_SRC}))`)

const FIRST = /\b(?:i|i'm|i've|i'd|i'll|my|me|mine|myself)\b/i
const THIRD = /\b(?:he|she|his|her|him|they|their|baby|child|kid)\b/i
const SECOND = /\b(?:you|your|you're|you've|yours)\b/i
const IMPERATIVE = /^(?:please\s+)?(?:take|rest|drink|avoid|stop|continue|start|apply|use|stay|follow|keep|try|eat|come|open|breathe|lie|sit|let me|do not|don't|make sure|gargle|walk|reduce|increase|limit|check|return|see me|give|bring|small|sleep)\b/i
const CLINICIAN_VERBS = /\bi(?:'ll| will| would| am going to|'m going to)\s+(?:give|prescribe|start|refer|check|examine|listen|do|arrange|write|send|put|add|reduce|increase|review)\b/i

// ---- numbers said aloud --------------------------------------------------------------------------------------------------------------
const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const isNumWord = (w: string) => w in ONES || w in TENS || w === 'hundred'

/** "a hundred and thirty over eighty" -> "130 over 80"; "thirty eight point two" -> "38.2". Only runs of number words are touched. */
export function digitise(text: string): string {
  const tokens = text.split(/(\s+)/)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const core = t.toLowerCase().replace(/[^a-z]/g, '')
    const trailing = t.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? ''
    const startsRun = isNumWord(core) || (core === 'a' && /^hundred\b/i.test(tokens[i + 2] ?? ''))
    if (!startsRun) {
      out.push(t)
      continue
    }
    let value = 0
    let current = 0
    let j = i
    let end = i
    while (j < tokens.length) {
      const w = (tokens[j] ?? '').toLowerCase().replace(/[^a-z]/g, '')
      if (w in ONES) current += ONES[w]!
      else if (w in TENS) current += TENS[w]!
      else if (w === 'hundred') current = (current || 1) * 100
      else if (w === 'a' && j === i) current = 0
      else if (w === 'and' && j + 2 < tokens.length && isNumWord((tokens[j + 2] ?? '').toLowerCase().replace(/[^a-z]/g, ''))) {
        // "hundred and thirty"
      } else break
      end = j
      if (/[,.;:!?]$/.test(tokens[j]!)) break
      j += 2
    }
    value += current
    let text2 = String(value)
    // "point two"
    const next = (tokens[end + 2] ?? '').toLowerCase().replace(/[^a-z]/g, '')
    if (next === 'point' && (tokens[end + 4] ?? '').toLowerCase().replace(/[^a-z]/g, '') in ONES) {
      text2 += `.${ONES[(tokens[end + 4] ?? '').toLowerCase().replace(/[^a-z]/g, '')]}`
      end += 4
    }
    out.push(text2 + (/[^\p{L}\p{N}]+$/u.exec(tokens[end]!)?.[0] ?? trailing === '' ? '' : (/[^\p{L}\p{N}]+$/u.exec(tokens[end]!)?.[0] ?? '')))
    i = end
  }
  return out.join('')
}

// ---------------------------------------------------------------------------------------------------------------------------------------

function sideOf(speaker: string | null, text: string): { side: Side | null; labelled: boolean } {
  if (speaker && PATIENT_SIDE.has(speaker)) return { side: 'patient', labelled: true }
  if (speaker && CLINICIAN_SIDE.has(speaker)) return { side: 'clinician', labelled: true }
  const clinician = (SECOND.test(text) ? 1 : 0) + (IMPERATIVE.test(text.trim()) ? 1 : 0) + (CLINICIAN_VERBS.test(text) ? 2 : 0)
  const patient = FIRST.test(text) || THIRD.test(text) ? 1 : 0
  if (clinician > patient) return { side: 'clinician', labelled: false }
  if (patient > clinician) return { side: 'patient', labelled: false }
  return { side: null, labelled: false }
}

function isUnsupportedLanguage(seg: TranscriptSegment): boolean {
  if (seg.language && !/^en/i.test(seg.language)) return true
  const letters = [...seg.text].filter((c) => /\p{L}/u.test(c))
  if (letters.length && letters.filter((c) => /\p{Script=Latin}/u.test(c)).length / letters.length < 0.7) return true
  const words = seg.text.toLowerCase().split(/[^\p{L}]+/u)
  return words.filter((w) => HINGLISH.includes(w)).length >= 3
}

const DURATION_Q = /\b(?:how long|since when|when did|when was|for how long|how many (?:days|weeks|months)|how long has|when (?:did|do) (?:it|this|the \w+) start)\b/i
const ALLERGY_Q = /\ballerg(?:y|ies|ic)\b|\breaction to (?:any )?(?:medicine|drug)s?\b/i

const TERMINAL = /[.!?…]["'”’)\]]*\s*$/
const STARTS_LOWER = /^\s*[a-z]/
const MAX_UNIT_CHARS = 600
const recorded = (seg: TranscriptSegment) => typeof seg.startMs === 'number'

/**
 * A recording is sent in parts, and a part can end in the middle of a sentence ("I do not" | "have chest pain."). The speech model sees each
 * part alone, so such a sentence arrives as two lines, and read one at a time the second says the opposite of what was said. Recorded lines
 * that end without sentence punctuation, with a next line from the same speaker that starts in lower case, are read together (and both lines
 * are named as the source). A line that still starts or ends mid-sentence is marked, and the points from it need the doctor's check.
 */
function stitch(segments: TranscriptSegment[]): { seg: TranscriptSegment; ids: string[]; cutStart: boolean; cutEnd: boolean }[] {
  const out: { seg: TranscriptSegment; ids: string[]; cutStart: boolean; cutEnd: boolean }[] = []
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i]!
    let text = first.text
    const ids = [first.id]
    let last = first
    while (recorded(last) && !isUnsupportedLanguage(last) && !TERMINAL.test(text) && ids.length < 4) {
      const next = segments[i + 1]
      if (!next || !recorded(next) || next.speaker !== first.speaker || isUnsupportedLanguage(next) || !STARTS_LOWER.test(next.text)) break
      text = `${text.trim()} ${next.text.trim()}`
      ids.push(next.id)
      last = next
      i++
    }
    out.push({ seg: ids.length > 1 ? { ...first, text } : first, ids, cutStart: recorded(first) && STARTS_LOWER.test(first.text), cutEnd: recorded(last) && !TERMINAL.test(text) })
  }
  return out
}

/** A very long run of words with no sentence end is cut at a word boundary, so no step of reading it grows with the square of its length. */
function pieces(sentence: string): string[] {
  if (sentence.length <= MAX_UNIT_CHARS) return [sentence]
  const out: string[] = []
  let rest = sentence
  while (rest.length > MAX_UNIT_CHARS) {
    const at = rest.lastIndexOf(' ', MAX_UNIT_CHARS)
    const cut = at > 0 ? at : MAX_UNIT_CHARS
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

function toUnits(segments: TranscriptSegment[]): { units: Unit[]; skipped: number } {
  const out: Unit[] = []
  let skipped = 0
  let askedDuration = false
  let askedAllergy = false
  stitch(segments).forEach(({ seg, ids, cutStart, cutEnd }, line) => {
    if (isUnsupportedLanguage(seg)) {
      skipped++
      askedDuration = false
      askedAllergy = false
      return
    }
    const sentences = seg.text
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s+(?=[A-Z"'(])/u)
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap(pieces)
    let nextDuration = false
    let nextAllergy = false
    sentences.forEach((s, k) => {
      const question = /\?\s*$/.test(s)
      const { side, labelled } = sideOf(seg.speaker, s)
      out.push({ seg, ids, cutOff: (k === 0 && cutStart) || (k === sentences.length - 1 && cutEnd), line, text: s, question, side, labelled, afterDurationQuestion: askedDuration, afterAllergyQuestion: askedAllergy })
      if (question && DURATION_Q.test(s)) nextDuration = true
      if (question && ALLERGY_Q.test(s)) nextAllergy = true
    })
    askedDuration = nextDuration
    askedAllergy = nextAllergy
  })
  return { units: out, skipped }
}

/** Clauses of a sentence: split at ", and" / ", but" / ";" / " but " (never at a bare "and": "fever and a dry cough" is one thing). */
function clausesOf(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  const re = /,\s+(?:and|but|then|so)\s+|;\s*|\s+but\s+|\s+however,?\s+/giu
  let last = 0
  for (const m of text.matchAll(re)) {
    out.push({ text: text.slice(last, m.index), start: last })
    last = m.index + m[0].length
  }
  out.push({ text: text.slice(last), start: last })
  return out.filter((c) => c.text.trim().length > 1)
}

function negatedBefore(clause: string, index: number): boolean {
  // Only the last few words matter, so only the text just before the match is split (linear in the length of the line, not quadratic).
  const before = clause.slice(Math.max(0, index - 200), index)
  const words = before.split(/\s+/).filter(Boolean)
  const window = words.slice(-6).join(' ')
  // The scope of a negation ends at a contrast word.
  const scope = window.split(/\b(?:but|however|although|except|just|only|apart from)\b/i).pop()!
  if (!G(SRC.negation).test(scope)) return false
  // "not sure about X" hedges, it does not deny.
  return !/\bnot\s+(?:sure|certain)\b/i.test(scope)
}

function hedgeIn(text: string): string | null {
  const m = G(SRC.hedge).exec(text)
  return m ? m[0].toLowerCase() : null
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim()
const dedupeKey = (category: string, term: string, negated: boolean) => `${category}|${norm(term)}|${negated ? 'n' : 'p'}`

const BLANK = { substance: null, medication: null, dose: null, duration: null, vitalKind: null, value: null, unit: null } as const

interface Draft {
  category: FactCategory
  text: string
  unit: Unit
  negated?: boolean
  hedge?: string | null
  details?: Partial<ExtractedFact['details']>
  /** Of several of these in one reply, only the last stands (a correction: "two days, no, three days"). */
  lastWins?: string
}

const EXAM_NOUNS = 'throat|chest|abdomen|tummy|stomach|belly|ears?|eyes?|skin|knees?|back|lungs?|heart|tonsils|glands|neck|joints?|feet|foot|legs?|arms?|ankles?|nose|mouth|tongue|spine|shoulder|hip|liver|pulses?|reflexes|reflex|sensation|movements?|power|tone|gait|abdominal|wheezes?|crackles|murmur|rash|wound'
const FINDING_RE = G(String.raw`\b(?:your|his|her|the)\s+(?:[a-z]+\s+){0,2}(?:${EXAM_NOUNS})\b[^.?!,;]{0,50}?\b(?:is|are|looks?|sounds?|feels?|seems?|has|have|was|were)\b[^.?!,;]{0,50}`)
const NO_FINDING_RE = G(String.raw`\b(?:no|any)\s+(?:wheeze|wheezing|swelling|tenderness|redness|rash|murmur|crackles|crepitations|lumps?|rigidity|guarding)\b[^.?!,;]{0,30}`)
const DIRECT_FINDING_RE = G(String.raw`\b(?:there (?:is|are|'s)|i (?:can )?(?:see|feel|hear|notice|found)|when i [^.?!,;]{3,40},\s*it (?:is|feels))\s+[^.?!,;]{0,80}\b(?:tender\w*|swelling|redness|wheeze\w*|crackles|murmur|rash|inflamed|congested|enlarged|painful|reduced|limited|normal|fine)\b[^.?!,;]{0,40}`)

/** Pulls the proposed points out of the transcript. Exported for the evaluation harness and the tests. */
export function extractFacts(segments: TranscriptSegment[]): { facts: ExtractedFact[]; skippedLines: number } {
  const { units: us, skipped } = toUnits(segments)
  const drafts: Draft[] = []
  const seen = new Set<string>()
  let chief = false
  let patientLines = 0
  let lastPatientLine = -1

  const add = (d: Draft, termForDedupe?: string) => {
    if (termForDedupe) {
      const k = dedupeKey(d.category, termForDedupe, !!d.negated)
      if (seen.has(k)) return
      seen.add(k)
    }
    drafts.push(d)
  }

  for (const u of us) {
    const isPatient = u.side === 'patient'
    const isClinician = u.side === 'clinician'
    if (isPatient && u.labelled && u.line !== lastPatientLine) {
      patientLines++
      lastPatientLine = u.line
    }
    const sentenceHedge = hedgeIn(u.text)

    // A patient's worry can be put as a question ("Will I need insulin one day?").
    if (u.question) {
      if (!isClinician && /\b(?:will\s+(?:i|this|it|he|she)\b|is it (?:an?\s|something|serious|cancer|dangerous|\w+ing\b)|is this (?:serious|dangerous)|am i going to|what if|should i be (?:worried|concerned)|could it be|do i have to take [^?]*(?:life|always|forever|long))/i.test(u.text)) {
        add({ category: 'patient_concern', text: u.text, unit: u }, u.text.slice(0, 40))
      }
      continue
    }

    const clauses = clausesOf(u.text)

    // ---- red flags (patient statements) ----------------------------------------------------------------------------------------------
    if (!isClinician) {
      for (const rf of RED_FLAGS) {
        const m = rf.re.exec(u.text)
        if (!m) continue
        const negated = negatedBefore(u.text, m.index)
        add({ category: negated ? 'symptom' : 'red_flag', text: m[0], unit: u, negated, hedge: sentenceHedge }, `${negated ? 'symptom' : 'red_flag'}-${rf.label}`)
      }
    }

    for (const c of clauses) {
      const clause = c.text.replace(/^\s*(?:and|also|then|so|okay|ok|yes|no,|well|um|uh|alright|anyway)[,\s]+/i, '').trim()
      if (clause.length < 2) continue
      const digits = digitise(clause)

      // ---- allergy --------------------------------------------------------------------------------------------------------------------
      const noAllergy = /\b(?:no|not|any|without)\s+(?:known\s+)?(?:(?:drug|food|medicine|medication)\s+)?allerg(?:y|ies)\b/i.exec(clause)
      const allergyOf = /\ballerg(?:ic|y|ies)\s+(?:to|on|with)?\s*([a-z][a-z\s-]{1,40}?)(?=[,.;!?]|\s+(?:and|but|or|since|when|so|also)\b|$)/i.exec(clause)
      const allergyPrefix = /\b([a-z][a-z-]{3,30})\s+allergy\b/i.exec(clause)
      const reaction = /\b([a-z][a-z-]{3,30})\s+(?:gave|give|caused|cause|made|makes?)\s+(?:me|him|her)\s+(?:a\s+)?(?:rash|reaction|swelling|hives|itching|vomiting|trouble breathing|sneeze)/i.exec(clause)
      const reactionTo = /\breaction\s+to\s+([a-z][a-z\s-]{2,30}?)(?=[,.;!?]|\s+(?:and|but)\b|$)/i.exec(clause)
      const dustAllergy = /\b(dust|pollen|pollution|smoke|peanuts?|eggs?|milk|shellfish|prawns?|latex)\s+(?:makes?|gives?|causes?)\s+(?:him|her|me)\s+(?:sneeze|cough|itch|wheeze|rash)/i.exec(clause)
      const reactionWord = /\b(?:rash|hives|swelling|reaction|breathing trouble|vomit\w*|itch\w*)\b/i.test(clause)
      const inAllergyClause = !!(noAllergy || allergyOf || allergyPrefix || reaction || reactionTo || dustAllergy)
      const drugMatches = [...clause.matchAll(G(SRC.drug))]
      if (!isClinician && noAllergy) {
        add({ category: 'allergy', text: noAllergy[0], unit: u, negated: true, hedge: sentenceHedge }, 'no-allergy')
      } else if (!isClinician && (allergyOf || allergyPrefix || reaction || reactionTo || dustAllergy)) {
        const sub = (allergyOf?.[1] ?? allergyPrefix?.[1] ?? reaction?.[1] ?? reactionTo?.[1] ?? dustAllergy?.[1] ?? '').replace(/\b(?:any|a|an|the|some|certain|to)\b/gi, '').trim()
        if (sub && !/^(?:this|that|it|things|stuff|nothing|medicine|drug)$/i.test(sub)) add({ category: 'allergy', text: clause, unit: u, hedge: sentenceHedge, details: { substance: sub } }, sub)
      } else if (!isClinician && drugMatches.length && (u.afterAllergyQuestion || reactionWord) && !/\b(?:took|take|taking)\b/i.test(clause.slice(0, drugMatches[0]!.index))) {
        // A medicine named in answer to "any allergy?", or with a reaction ("amoxicillin ... I got a rash").
        add({ category: 'allergy', text: clause, unit: u, hedge: sentenceHedge, details: { substance: drugMatches[0]![0].toLowerCase() } }, drugMatches[0]![0])
      }

      // ---- vital signs (said aloud) ---------------------------------------------------------------------------------------------------
      if (!isPatient) {
        const whole = digits !== clause ? clause : null
        const bp = /\b(?:blood pressure|bp)\s*(?:reading\s*)?(?:is|was|of|:|comes to|=)?\s*(\d{2,3})\s*(?:over|\/|by)\s*(\d{2,3})\b/i.exec(digits) ?? /\b(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})\b/.exec(digits)
        if (bp && +bp[1]! >= 60 && +bp[1]! <= 260 && +bp[2]! >= 30 && +bp[2]! <= 160 && +bp[1]! > +bp[2]!) add({ category: 'vital_sign', text: whole ?? bp[0], unit: u, details: { vitalKind: 'systolic_bp' as VitalKind, value: +bp[1]!, unit: 'mmHg' } }, `bp-${bp[1]}-${bp[2]}`)
        const pulse = /\b(?:pulse|heart rate|pulse rate)\s*(?:is|was|of|:|=)?\s*(\d{2,3})\b/i.exec(digits)
        if (pulse && +pulse[1]! >= 20 && +pulse[1]! <= 250) add({ category: 'vital_sign', text: whole ?? pulse[0], unit: u, details: { vitalKind: 'heart_rate' as VitalKind, value: +pulse[1]!, unit: 'bpm' } }, `pulse-${pulse[1]}`)
        const temp = /\b(?:temperature|temp|fever)\s*(?:reading\s*)?(?:is|was|of|:|=|at)?\s*(\d{2,3}(?:\.\d)?)\b/i.exec(digits)
        if (temp && ((+temp[1]! >= 33 && +temp[1]! <= 43) || (+temp[1]! >= 91 && +temp[1]! <= 109))) add({ category: 'vital_sign', text: whole ?? temp[0], unit: u, details: { vitalKind: 'temperature' as VitalKind, value: +temp[1]!, unit: +temp[1]! > 50 ? 'F' : '°C' } }, `temp-${temp[1]}`)
        const spo2 = /\b(?:oxygen|saturation|saturations|sats?|spo2|spo 2)\s*(?:level\s*)?(?:is|was|of|:|=|at)?\s*(\d{2,3})\s*(?:percent|%)?/i.exec(digits)
        if (spo2 && +spo2[1]! >= 50 && +spo2[1]! <= 100) add({ category: 'vital_sign', text: whole ?? spo2[0], unit: u, details: { vitalKind: 'spo2' as VitalKind, value: +spo2[1]!, unit: '%' } }, `spo2-${spo2[1]}`)
        const rr = /\b(?:respiratory rate|breathing rate|respiration rate)\s*(?:is|was|of|:|=)?\s*(\d{1,2})\b|\b(\d{1,2})\s+breaths?\s+(?:a|per)\s+minute\b/i.exec(digits)
        if (rr) add({ category: 'vital_sign', text: whole ?? rr[0], unit: u, details: { vitalKind: 'respiratory_rate' as VitalKind, value: +(rr[1] ?? rr[2]!), unit: '/min' } }, `rr-${rr[1] ?? rr[2]}`)
        const weight = /\b(?:weight|you weigh|weighing)\s*(?:is|was|of|:|=)?\s*(\d{2,3}(?:\.\d)?)\s*(?:kg|kilos?|kilograms?)/i.exec(digits)
        if (weight) add({ category: 'vital_sign', text: whole ?? weight[0], unit: u, details: { vitalKind: 'weight' as VitalKind, value: +weight[1]!, unit: 'kg' } }, `weight-${weight[1]}`)
        const sugar = /\b(?:blood sugar|sugar|glucose)\s*(?:level\s*)?(?:is|was|of|:|=|at)?\s*(\d{2,3})\b(?!\s*(?:days?|weeks?|years?))/i.exec(digits)
        if (sugar && +sugar[1]! >= 30 && +sugar[1]! <= 700) add({ category: 'vital_sign', text: whole ?? sugar[0], unit: u, details: { vitalKind: 'blood_glucose' as VitalKind, value: +sugar[1]!, unit: 'mg/dL' } }, `glucose-${sugar[1]}`)
      }

      // ---- investigations (either side, advised or done) ------------------------------------------------------------------------------
      for (const m of clause.matchAll(G(SRC.investigation))) {
        const term = m[0]
        // "chest x-ray", "urine test": keep the word before when it makes the name.
        const before = clause.slice(0, m.index).match(/([a-z]+)\s+$/i)?.[1]
        const phrase = before && /^(?:chest|urine|stool|blood|full|fasting|thyroid|liver|kidney|lipid|knee|spine|back|abdominal|pelvic|brain|head|neck|dengue|malaria|covid|pregnancy|throat|skin|allergy|repeat|eye)$/i.test(before) && !new RegExp(`^${before}\\b`, 'i').test(term) ? `${before} ${term}` : term
        const negated = negatedBefore(clause, m.index) || /\b(?:don't|do not|no)\s+need\b|\bnot\s+(?:now|today|at (?:the moment|this stage))\b/i.test(clause)
        add({ category: 'investigation_mention', text: phrase, unit: u, negated, hedge: sentenceHedge }, phrase)
      }
      // "a kidney test", "an eye check": a body word and a test/check/scan
      for (const m of clause.matchAll(/\b(?:an?|the|your)\s+((?:kidney|liver|eye|ear|heart|sugar|urine|stool|blood|thyroid|lung|vision|hearing)\s+(?:test|check|count|scan|profile|function))\b/gi)) add({ category: 'investigation_mention', text: m[1]!, unit: u, hedge: sentenceHedge }, m[1]!)

      // ---- medicines -------------------------------------------------------------------------------------------------------------------
      const drugs = new Map<string, number>()
      for (const m of drugMatches) drugs.set(m[0].toLowerCase(), m.index)
      const suffixed = DRUG_SUFFIX.exec(clause)
      if (suffixed && /\b(?:tablet|tablets|capsule|capsules|syrup|injection|course|dose|mg|milligrams?|ml)\b/i.test(clause)) drugs.set(suffixed[0].toLowerCase(), suffixed.index)
      const tabletOf = /\b(?:took|taking|take|on|using|given|started|had)\s+(?:a|one|two|some|my)?\s*([a-z][a-z0-9-]{3,})\s+(?:tablet|tablets|capsule|capsules|syrup|injection|drops)\b/i.exec(clause)
      if (tabletOf && !/^(?:one|two|some|that|this|the|your|new|small|big|white|red)$/i.test(tabletOf[1]!)) drugs.set(tabletOf[1]!.toLowerCase(), tabletOf.index)
      const dose = /(\d+(?:\.\d+)?)\s*(?:milligrams?|mg|micrograms?|mcg|ml|millilitres?|units?|grams?)\b/i.exec(clause)?.[0] ?? null
      const stopVerb = /^(?:and\s+)?(?:please\s+)?(?:stop|avoid|do not|don't|reduce|increase|continue|keep taking|switch|change|cut|no more)\b/i.test(clause) || /\b(?:reduce|increase|stop)\s+(?:the\s+)?\w+/i.test(clause)
      const allergyDrug = allergyOf?.[1] ?? allergyPrefix?.[1] ?? reaction?.[1] ?? reactionTo?.[1] ?? ''
      let drugsPlan = false
      for (const [drug, at] of drugs) {
        if (inAllergyClause && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(drug)}(?![\\p{L}\\p{N}])`, 'iu').test(allergyDrug)) continue
        if (!isClinician && drugMatches.length && (u.afterAllergyQuestion || reactionWord) && !/\b(?:took|take|taking)\b/i.test(clause.slice(0, at))) continue
        if (isPatient || (!isClinician && (FIRST.test(clause) || THIRD.test(clause)))) {
          const negated = /\b(?:not|never|stopped|quit|no longer)\s+(?:\w+\s+){0,2}(?:taking|take|using|on)\b/i.test(clause) || negatedBefore(clause, at)
          add({ category: 'medication_history', text: clause, unit: u, negated, hedge: sentenceHedge, details: { medication: drug, dose } }, drug)
        } else if (isClinician || SECOND.test(clause) || IMPERATIVE.test(clause)) {
          if (stopVerb) drugsPlan = true
          else add({ category: 'medication_mention', text: clause, unit: u, hedge: sentenceHedge, details: { medication: drug, dose } }, drug)
        }
      }
      // "stop the ibuprofen", "reduce the amlodipine to ...": an instruction about a medicine is a plan point
      if (drugsPlan) add({ category: 'plan', text: clause, unit: u }, clause)
      const hasDrug = drugs.size > 0

      // ---- the patient's own statements -----------------------------------------------------------------------------------------------
      if (!isClinician && (isPatient || !SECOND.test(clause))) {
        // duration (the last mention in a reply stands: "two days, no, three days")
        const corrected = SELF_CORRECTION.exec(clause)
        const durations = corrected ? [corrected[1]!] : [...clause.matchAll(G(DURATION_SRC))].map((m) => m[0])
        const aboutCondition = ANY.symptom.test(clause) || ANY.condition.test(clause) || /\b(?:started|began|going on|had this|had it|has been|been having|since)\b/i.test(clause)
        if (durations.length && (u.afterDurationQuestion || aboutCondition) && !/\bago\b.*\b(?:took|bought|came|went)\b/i.test(clause) && !/\b(?:i|we) (?:was|were) (?:stuck|waiting|late)\b/i.test(clause)) {
          const d = durations[durations.length - 1]!.trim()
          add({ category: 'duration', text: corrected ? d : clause, unit: u, hedge: corrected ? null : sentenceHedge, details: { duration: d.replace(/^(?:for|since|over|about|around|nearly|almost|from)\s+/i, '') }, lastWins: `${u.line}` })
        }

        // concerns
        const concern = /\b(?:(?:i(?:'m| am| was| get|'ve been| have been))\s+(?:a bit |a little |very |really |quite |so |too |getting )?(?:worried|concerned|scared|afraid|anxious|nervous|frightened)|worries me|should i be (?:worried|concerned)|what if|is it (?:something )?serious|something serious|could be the new|it could be (?:the )?(?:new|something))\b[^.?!]*/i.exec(clause)
        if (concern) add({ category: 'patient_concern', text: clause, unit: u }, concern[0].slice(0, 40))

        // family history
        const relative = G(SRC.relative).exec(clause)
        const familyCondition = G(SRC.condition).exec(clause)
        const familyDeath = /\b(?:died|passed away|death)\b/i.test(clause)
        const isFamily = !!relative && (!!familyCondition || familyDeath || /\b(?:heart attack|stroke|cancer)\b/i.test(clause)) && /\b(?:my|our|his|her|their)\b/i.test(clause.slice(0, (relative?.index ?? 0) + 1)) && !/\b(?:i|he|she) (?:have|has|had)\s+\w+\s+(?:since|for)\b/i.test(clause.slice(0, relative.index))
        if (isFamily) add({ category: 'family_history', text: clause, unit: u, negated: negatedBefore(clause, familyCondition?.index ?? 0), hedge: sentenceHedge }, `${relative![0]}-${familyCondition?.[0] ?? 'death'}`)

        // chief complaint stated as a reason for the visit
        const cameFor = /\b(?:i|we)(?:'ve| have)?\s+(?:come|came|am here|are here|'m here)\s+(?:in\s+)?(?:for|because|with|about)\b|\bmy (?:problem|complaint) is\b|\bi(?:'m| am) here for\b/i.test(clause)
        if (cameFor && !chief && (isPatient || !u.labelled)) {
          chief = true
          add({ category: 'chief_complaint', text: clause, unit: u, hedge: sentenceHedge })
        }

        // past medical history
        if (!isFamily && !cameFor) {
          for (const m of clause.matchAll(G(SRC.condition))) {
            if (/^(?:migraine)$/i.test(m[0])) continue
            const lead = clause.slice(0, m.index + m[0].length)
            const stated = /\b(?:i|i'm|i've|i have|i had|i was|i am|my|he|she|he had|she had|diagnosed|history of|suffer\w*|known|operated|since|they said|doctor said|removed)\b/i.test(lead)
            if (stated && !/\b(?:check|review|follow[- ]?up|checkup|test)\b/i.test(clause.slice(m.index, m.index + m[0].length + 12))) add({ category: 'past_medical_history', text: clause, unit: u, negated: negatedBefore(clause, m.index), hedge: sentenceHedge }, m[0])
          }
          if (/\b(?:ten|\d+|\w+)\s+years?\s+of\s+(?:sugar|pressure)\b|\b(?:i|he|she)\s+(?:have|has|had)\s+(?:the\s+)?(?:sugar|pressure|bp)\b/i.test(clause) && !seen.has(dedupeKey('past_medical_history', 'sugar', false))) add({ category: 'past_medical_history', text: clause, unit: u, hedge: sentenceHedge }, 'pressure-bp')
          if (/\b(?:had|got|have)\b[^.?!]{0,40}\b(?:removed|taken out|operated|operation|surgery)\b/i.test(clause)) add({ category: 'past_medical_history', text: clause, unit: u }, `surgery-${clause.slice(0, 30)}`)
        }

        // symptoms and the chief complaint
        const found: { term: string; index: number; negated: boolean }[] = []
        for (const m of clause.matchAll(G(SRC.symptom))) {
          const term = m[0].toLowerCase()
          const negated = negatedBefore(clause, m.index)
          if (WEAK_SYMPTOMS.has(term) && !negated) {
            const near = clause.slice(Math.max(0, m.index - 24), m.index + term.length + 24)
            if (!ANY.body.test(near) && !/\b(?:severe|bad|terrible|worse|mild|sharp|dull|constant|burning|throbbing|a lot of|lot of)\b/i.test(near)) continue
          }
          if (found.some((f) => m.index >= f.index && m.index < f.index + f.term.length)) continue
          // a symptom word inside a medicine phrase ("cough syrup") is not a symptom
          if (/\b(?:cough syrup|cold medicine|pain\s?killers?)\b/i.test(clause) && /^(?:cough|cold|pain)$/i.test(term)) continue
          found.push({ term, index: m.index, negated })
        }
        if (found.length) {
          const firstPositive = found.find((f) => !f.negated)
          const statesComing = /\b(?:came|come|coming|here)\s+(?:in\s+)?(?:for|because|with|about)\b|\bmy (?:problem|complaint)\b|\bbeen having\b|\b(?:i|he|she|they|baby)\s+(?:have|has|had|got|am having|is having|'ve got|'ve had|have been having|developed|feel|feels|felt|get|gets)\b|\b(?:hurts?|hurting|paining)\b|\bhas\s+(?:a|an|some)\b/i.test(clause)
          if (!chief && firstPositive && patientLines <= 4 && (isPatient || !u.labelled) && (statesComing || patientLines <= 2)) {
            chief = true
            for (const f of found) if (!f.negated) seen.add(dedupeKey('symptom', f.term, false))
            add({ category: 'chief_complaint', text: clause, unit: u, hedge: sentenceHedge })
            // what the patient denies in the same breath is still a point ("no breathing trouble, just the cough")
            for (const f of found) {
              if (!f.negated) continue
              const lead = clause.slice(0, f.index)
              const cue = [...lead.matchAll(G(SRC.negation))].pop()
              add({ category: 'symptom', text: clause.slice(cue ? cue.index : Math.max(0, f.index - 12), f.index + f.term.length).trim(), unit: u, negated: true, hedge: sentenceHedge }, f.term)
            }
          } else {
            for (const f of found) {
              let span = clause
              if (f.negated) {
                const lead = clause.slice(0, f.index)
                const cue = [...lead.matchAll(G(SRC.negation))].pop()
                span = clause.slice(cue ? cue.index : Math.max(0, f.index - 12), f.index + f.term.length).trim()
              }
              add({ category: 'symptom', text: span, unit: u, negated: f.negated, hedge: sentenceHedge }, f.term)
            }
          }
        }
        // "I get up two times at night to pass urine", "I have to go again and again": night or frequent urination
        if (/\b(?:get up|wake up|have to go|go again|pass(?:ing)? urine)\b[^.?!]*\b(?:night|again and again|often|every hour|many times|two times|three times)\b/i.test(clause) && !seen.has(dedupeKey('symptom', 'frequent urination', false))) add({ category: 'symptom', text: clause, unit: u, hedge: sentenceHedge }, 'frequent urination')
        else if (!chief && !found.length && /\b(?:burns?|stings?)\b[^.?!]*\burine\b/i.test(clause) && patientLines <= 4) {
          chief = true
          add({ category: 'chief_complaint', text: clause, unit: u, hedge: sentenceHedge })
        }
      }

      // ---- the clinician's statements -------------------------------------------------------------------------------------------------
      if (!isPatient && (isClinician || SECOND.test(clause) || IMPERATIVE.test(clause.trim()) || CLINICIAN_VERBS.test(clause) || /\b(?:his|her)\b/i.test(clause))) {
        // examination findings
        let foundExam = false
        for (const m of clause.matchAll(FINDING_RE)) {
          if (!ANY.finding.test(m[0]) && !/\b(?:fine|normal|clear)\b/i.test(m[0])) continue
          foundExam = true
          add({ category: 'examination_finding', text: m[0], unit: u, hedge: sentenceHedge }, m[0])
        }
        for (const m of clause.matchAll(NO_FINDING_RE)) {
          foundExam = true
          add({ category: 'examination_finding', text: m[0], unit: u, negated: true }, m[0])
        }
        for (const m of clause.matchAll(DIRECT_FINDING_RE)) {
          foundExam = true
          add({ category: 'examination_finding', text: m[0], unit: u, hedge: sentenceHedge }, m[0])
        }

        // assessment
        const assessment = /\b(?:i think|i believe|i suspect|looks? like|looks? to be|sounds? like|seems? to be|seems? like|most likely|probably|could be|might be|may be|is likely|is possible|possibly|maybe|perhaps|consistent with|suggests|this is (?:a|an|just a|probably a)|you (?:have|'ve got|have got|may have|might have)\s+(?:a|an|some)?|can cause|due to|because of)\b[^.?!]*/i.exec(clause)
        if (assessment && !hasDrug && !foundExam && !/^(?:so\s+)?(?:take|rest|drink)\b/i.test(clause) && (ANY.condition.test(clause) || ANY.symptom.test(clause) || /\b(?:infection|strain|sprain|nerve|damage|problem|gastritis|inflammation|irritation|allergy|asthma|disease|condition|stress|tension|viral|bacterial|disc)\b/i.test(clause))) {
          add({ category: 'clinician_assessment', text: clause, unit: u, hedge: hedgeIn(clause) ?? sentenceHedge }, clause)
        }

        // follow-up
        const timeRef = /\b(?:in|after|within|next|every|on)\s+(?:\d+|a|one|two|three|four|five|six|seven|ten|few|couple(?: of)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:day|week|month|year)?s?\b|\bnext\s+(?:week|month|visit|appointment|time)\b|\btomorrow\b|\bafter\s+(?:the\s+)?(?:test|report|result|scan|culture)s?\b|\bwhen\s+(?:the\s+)?(?:\w+\s+)?(?:report|result)s?\b/i
        const followVerb = /\b(?:come|see|visit|return|review|meet|call|bring|follow[- ]?up|check up|recheck|re-check|get back|report back)\b/i
        const conditional = /\bif\s+(?:it|this|he|she|the \w+|you)\s+(?:is|are|does|do|gets?|has|have|still|doesn't|does not|isn't|is not)\b[^.?!]*\b(?:not better|worse|persists?|continues?|still there|does not (?:settle|improve)|doesn't (?:settle|improve))\b[^.?!]*/i
        const followUp = (followVerb.test(clause) && timeRef.test(clause)) || /\b(?:come back|come see|see me again|follow[- ]?up|bring (?:him|her) back)\b/i.test(clause) || (conditional.test(clause) && /\b(?:in|after|within)\s+\w+\s+(?:day|week|month)s?\b/i.test(clause)) || /\bsee me\b/i.test(clause)
        if (followUp && !/\bwill do\b/i.test(clause)) add({ category: 'follow_up', text: clause, unit: u }, clause)

        // plan: advice that is not a medicine, a test or a follow-up
        if (!hasDrug && !followUp && !foundExam) {
          const lead = String.raw`(?:(?:and|also|then|so|okay|ok|now|please|you should|you need to|you must|you can|you could|you may|make sure (?:you|to)|better to|it(?:'s| is) better to|try to|i (?:advise|suggest|recommend)(?: that)?(?: you)?(?: to)?|i(?:'d| would) (?:like|advise|suggest|recommend) (?:you )?(?:to )?|i will|i'll|we will|we'll|let's|let us)\s+)*`
          const verbs = String.raw`(?:rest|drink|avoid|stop|continue|start|apply|use|gargle|stay|eat|exercise|walk|reduce|increase|keep|follow|sleep|elevate|massage|wait|limit|cut|quit|lose|do|have|put|wash|rinse|steam|inhale|refer|admit|arrange|monitor|measure|check|ice|stretch|take it easy|take a|take some|go|lift|sit|stand|wear|change|switch|repeat|give|bring|let|allow|offer|make|cover|dress|feed|small meals|no\s+(?:spicy|oily|tea|coffee|alcohol|smoking|salt|sugar|cold|fried|junk|heavy)|do not|don't)`
          const advice = new RegExp(`^${lead}(${verbs})\\b[^?]*`, 'i').exec(clause.trim()) ?? /^(?:no|a physiotherapist|physiotherapy)\b[^?]{0,80}/i.exec(clause.trim())
          const examInstruction = /^(?:please\s+)?(?:open|breathe|lie|sit|turn|cough|say|look|show|relax|bend|raise|lift|squeeze|let me|follow my)\b/i.test(clause.trim()) || /\bplease\b[^.?!]*\b(?:open|breathe|lie|turn|cough|say|look|bend)\b/i.test(clause)
          if (advice && !examInstruction && !ANY.investigation.test(clause) && !/^(?:do you|did you|have you)\b/i.test(clause.trim()) && !/\b(?:we will check|let me check|i will check)\b/i.test(clause)) {
            // a list of advice in one clause ("rest at home, drink plenty of fluids and gargle ...") is several points
            const split = new RegExp(`,\\s+(?:and\\s+)?(?=${verbs}\\b)|\\s+and\\s+(?=(?:drink|avoid|gargle|stay|eat|exercise|walk|reduce|keep|follow|sleep|elevate|wait|limit|quit|wash|rinse|steam|inhale|monitor|apply|use|give|do not|don't|no\\s+\\w+)\\b)`, 'i')
            for (const part of clause.split(split)) {
              const t = part.replace(/^(?:and|also|then|so|okay|ok|now|please)\s+/i, '').trim()
              if (t.length > 3 && !ANY.investigation.test(t) && !followVerb.test(t.split(/\s+/).slice(0, 2).join(' '))) add({ category: 'plan', text: t, unit: u }, t)
            }
          }
        }
      }
    }
  }

  // A reply that gave several durations keeps the last one only.
  const lastDuration = new Map<string, number>()
  drafts.forEach((d, i) => d.lastWins && lastDuration.set(`${d.category}|${d.lastWins}`, i))
  const kept = drafts.filter((d, i) => !d.lastWins || lastDuration.get(`${d.category}|${d.lastWins}`) === i)

  const facts: ExtractedFact[] = kept.map((d) => {
    const speakerGuessed = !d.unit.labelled
    const reasons: string[] = []
    if (d.hedge) reasons.push(`Hedged in the conversation ("${d.hedge}")`)
    if (speakerGuessed) reasons.push('Who said this was guessed from the wording (no speaker label): assign speakers, or check it against the conversation')
    if (d.unit.cutOff) reasons.push('This line seems to be cut where a recording part ended (it starts or ends in the middle of a sentence): check it against the lines around it')
    if (d.unit.seg.speaker === 'Relative' || d.unit.seg.speaker === 'Attendant') reasons.push(`Said by a ${d.unit.seg.speaker.toLowerCase()}, not by the patient: confirm that it applies to the patient`)
    const attribution: ExtractedFact['attribution'] = d.unit.side === 'patient' ? 'patient_reported' : d.unit.side === 'clinician' ? 'clinician_stated' : 'other_speaker'
    return {
      category: d.category,
      text: d.text.replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim().slice(0, 600),
      attribution,
      certainty: reasons.length ? 'uncertain' : 'stated',
      uncertaintyReason: reasons.length ? reasons.join('. ') : null,
      negated: !!d.negated,
      details: { ...BLANK, ...d.details },
      sourceSegmentIds: d.unit.ids,
    }
  })
  return { facts, skippedLines: skipped }
}

export class RuleFactExtractor implements FactExtractor {
  readonly provider = 'adaxai-rules'
  readonly model = EXTRACT_RULES_VERSION
  readonly promptVersion = EXTRACT_RULES_VERSION
  readonly local = true
  readonly languages = ['en']

  async extract(segments: TranscriptSegment[]) {
    const { facts, skippedLines } = extractFacts(segments)
    return { facts, model: EXTRACT_RULES_VERSION, inputTokens: null, outputTokens: null, requestId: null, skippedLines }
  }
}
