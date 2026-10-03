import { flagVital, type TranscriptSegment, VITALS, type VitalKind } from '@adaxai/contracts'
import type { AppSettings, RoutingRules } from '../settings/schema.ts'
import { type EvidenceOut, nameMatches, segmentProvenance, sharedGroup } from './compare.ts'
import type { ContextItem, PatientContext } from './context.ts'
import { CLINICIAN_SIDE } from './transcripts.ts'

/** Version of the deterministic safety rules; stored as the run's model. */
export const SAFETY_RULES_VERSION = 'safety-rules-v1'

export interface RuleRecommendation {
  kind: 'red_flag' | 'safety_check' | 'clarification' | 'missing_information'
  urgency: 'routine' | 'attention'
  text: string
  rationale: string
  instruction: string | null
  missingInformation: { text: string }[]
  evidence: EvidenceOut[]
}

/** A fact already reviewed or pending, with its evidence, from the latest extraction. */
export interface FactForRules {
  text: string
  flags: string[]
  evidence: EvidenceOut[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NEGATION = /\b(no|not|never|without|denies|deny|denied|don'?t|doesn'?t|didn'?t|hasn'?t|haven'?t)\b(?:\W+\w+){0,3}\W*$/i

/**
 * Whole-word, case-insensitive phrase match. A mention preceded closely by a
 * negation ("no chest pain") does not count. This is a simple rule, not
 * language understanding; it is documented as such.
 */
export function findPhrase(text: string, phrase: string): boolean {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
  for (const m of text.matchAll(re)) {
    // The negation must be within the last few words before the phrase, so only the text just before it is looked at (linear in the length of the line).
    if (!NEGATION.test(text.slice(Math.max(0, m.index - 120), m.index))) return true
  }
  return false
}

const ev = (i: ContextItem, relation: 'supports' | 'conflicts' = 'supports', note: string | null = null): EvidenceOut => ({ relation, sourceType: i.sourceType, sourceId: i.sourceId, sourceRef: i.ref, provenance: i.provenance, excerpt: i.text, note })

/**
 * Explicit safety rules over the record and the transcript. Runs without any
 * AI provider. Each result cites the record items or transcript lines it is
 * based on.
 */
export function safetyChecks(ctx: PatientContext, segments: TranscriptSegment[], facts: FactForRules[], safety: AppSettings['safety'], routing: RoutingRules): RuleRecommendation[] {
  const out: RuleRecommendation[] = []
  const item = (type: ContextItem['sourceType'], id: string | null) => ctx.items.find((i) => i.sourceType === type && i.sourceId === id)

  // 1. Prescribed medicine vs. recorded allergy (name match or configured group).
  for (const p of ctx.currentPrescription) {
    for (const a of ctx.activeAllergies) {
      const direct = nameMatches(p.drugName, a.substance)
      const group = direct ? null : sharedGroup(p.drugName, a.substance, safety.allergyGroups)
      if (!direct && !group) continue
      out.push({
        kind: 'safety_check',
        urgency: 'attention',
        text: `Check ${p.drugName}: the patient has a recorded allergy to ${a.substance}.`,
        rationale: direct ? `The prescribed medicine's name matches the recorded allergen.` : `Both are in the configured "${group}" group (an illustrative list, not a drug database).`,
        instruction: null,
        missingInformation: [],
        evidence: [ev(item('prescription_item', p.id)!), ev(item('allergy', a.id)!)],
      })
    }
  }

  // 2. Allergy status not recorded.
  if (!ctx.activeAllergies.length && !ctx.patient.noKnownAllergies) {
    const a = ctx.items.find((i) => i.sourceType === 'patient' && i.ref.startsWith('A'))!
    out.push({ kind: 'missing_information', urgency: ctx.currentPrescription.length ? 'attention' : 'routine', text: 'Record the patient’s allergy status.', rationale: 'Neither an allergy nor “no known allergies” is recorded.', instruction: null, missingInformation: [{ text: 'Allergy status' }], evidence: [ev(a)] })
  }

  // 3. Vital signs at this visit: missing, or outside the adult reference range.
  if (!ctx.visitObservations.length) {
    out.push({ kind: 'missing_information', urgency: 'routine', text: 'No vital signs have been recorded at this visit.', rationale: 'There are no observations linked to this visit.', instruction: null, missingInformation: [{ text: 'Vital signs at this visit' }], evidence: [] })
  }
  const latest = new Map<string, (typeof ctx.visitObservations)[number]>()
  for (const o of ctx.visitObservations) if (!latest.has(o.kind)) latest.set(o.kind, o)
  for (const o of latest.values()) {
    const kind = o.kind as VitalKind
    const flag = flagVital(kind, o.value, ctx.ageYears)
    if (!flag || flag === 'normal') continue
    const d = VITALS[kind]
    const critical = flag.startsWith('critical')
    out.push({
      kind: critical ? 'red_flag' : 'safety_check',
      urgency: critical ? 'attention' : 'routine',
      text: `Review ${d.label} ${o.value} ${d.unit}: ${flag.endsWith('low') ? 'below' : 'above'} the adult reference range${critical ? ' (critical limit)' : ''}.`,
      rationale: `Adult reference ${d.reference![0]}–${d.reference![1]} ${d.unit}. A display aid, not a diagnosis.`,
      instruction: critical ? routing.criticalVitalsInstruction : null,
      missingInformation: [],
      evidence: [ev(item('observation', o.id)!)],
    })
  }

  // 4. Statements that conflict with the record (from the deterministic fact comparison).
  for (const f of facts) {
    if (!f.flags.includes('conflicts_with_record')) continue
    const conflicts = f.evidence.filter((e) => e.relation === 'conflicts')
    out.push({
      kind: 'clarification',
      urgency: conflicts.some((c) => c.sourceType === 'allergy') ? 'attention' : 'routine',
      text: `Clarify: "${f.text}" does not match the record.`,
      rationale: conflicts.map((c) => c.note ?? c.excerpt).join(' '),
      instruction: null,
      missingInformation: [],
      evidence: [...f.evidence.filter((e) => e.sourceType === 'transcript_segment'), ...conflicts],
    })
  }

  // 5. Configured red-flag phrases said by the patient side (or an unidentified speaker).
  for (const rf of routing.redFlags) {
    const hits = segments.filter((s) => !(s.speaker && CLINICIAN_SIDE.has(s.speaker)) && rf.phrases.some((p) => findPhrase(s.text, p)))
    if (!hits.length) continue
    out.push({
      kind: 'red_flag',
      urgency: 'attention',
      text: `Red-flag statement (${rf.id.replace(/-/g, ' ')}): clinician review required.`,
      rationale: `A configured red-flag phrase appears in the transcript (rules ${routing.version}).`,
      instruction: rf.instruction,
      missingInformation: [],
      evidence: hits.map((s) => ({ relation: 'supports' as const, sourceType: 'transcript_segment', sourceId: null, sourceRef: s.id, provenance: segmentProvenance(s), excerpt: `${s.speaker ? `${s.speaker}: ` : ''}${s.text}`, note: null })),
    })
  }
  return out
}
