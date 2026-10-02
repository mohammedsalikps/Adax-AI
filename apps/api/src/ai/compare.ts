import { type FactFlag, type Provenance, type TranscriptSegment, VITALS, type VitalKind } from '@adaxai/contracts'
import type { AppSettings } from '../settings/schema.ts'
import type { ContextItem, PatientContext } from './context.ts'
import type { ExtractedFact } from './providers.ts'
import { CLINICIAN_SIDE, PATIENT_SIDE } from './transcripts.ts'

/** Version of the deterministic comparison rules; stored as the run's model. */
export const COMPARE_RULES_VERSION = 'record-compare-v1'

export interface EvidenceOut {
  relation: 'supports' | 'conflicts'
  sourceType: string
  sourceId: string | null
  sourceRef: string
  provenance: Provenance
  excerpt: string
  note: string | null
}

export interface ComparedFact {
  fact: ExtractedFact
  /** Only segment ids that exist in the transcript. */
  citedSegments: TranscriptSegment[]
  flags: FactFlag[]
  evidence: EvidenceOut[]
}

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3)

/** True when one name contains the other as whole words (e.g. "amoxicillin 500" ~ "Amoxicillin"). */
export function nameMatches(a: string, b: string): boolean {
  const wa = words(a)
  const wb = words(b)
  if (!wa.length || !wb.length) return false
  const sa = ` ${wa.join(' ')} `
  const sb = ` ${wb.join(' ')} `
  return sa.includes(` ${wb.join(' ')} `) || sb.includes(` ${wa.join(' ')} `) || wa.some((w) => w.length >= 5 && wb.includes(w))
}

/** Configured group (e.g. "penicillin") that both names belong to, if any. */
export function sharedGroup(a: string, b: string, groups: Record<string, string[]>): string | null {
  for (const [group, members] of Object.entries(groups)) {
    const inGroup = (n: string) => members.some((m) => nameMatches(n, m)) || nameMatches(n, group)
    if (inGroup(a) && inGroup(b)) return group
  }
  return null
}

export const segmentProvenance = (s: TranscriptSegment): Provenance => (s.speaker && PATIENT_SIDE.has(s.speaker) ? 'patient_reported' : s.speaker && CLINICIAN_SIDE.has(s.speaker) ? 'clinician_stated' : 'transcript_unlabelled')

const recordEvidence = (i: ContextItem, relation: 'supports' | 'conflicts', note: string | null): EvidenceOut => ({ relation, sourceType: i.sourceType, sourceId: i.sourceId, sourceRef: i.ref, provenance: i.provenance, excerpt: i.text, note })

/**
 * Checks extracted facts against the transcript and the existing record with
 * explicit rules (no language model): which cited lines exist, whether the
 * attributed speaker matches, and whether allergies, medicines and vital
 * signs agree with what is recorded.
 */
export function compareFacts(facts: ExtractedFact[], segments: TranscriptSegment[], ctx: PatientContext, safety: AppSettings['safety']): ComparedFact[] {
  const byId = new Map(segments.map((s) => [s.id, s]))
  const itemsOf = (type: ContextItem['sourceType'], id: string | null) => ctx.items.find((i) => i.sourceType === type && i.sourceId === id)
  return facts.map((fact) => {
    const cited = [...new Set(fact.sourceSegmentIds)].map((id) => byId.get(id)).filter((s): s is TranscriptSegment => !!s)
    const flags = new Set<FactFlag>()
    const evidence: EvidenceOut[] = cited.map((s) => ({ relation: 'supports', sourceType: 'transcript_segment', sourceId: null, sourceRef: s.id, provenance: segmentProvenance(s), excerpt: `${s.speaker ? `${s.speaker}: ` : ''}${s.text}`, note: null }))
    if (!cited.length) flags.add('no_source')
    if (fact.certainty === 'uncertain') flags.add('uncertain')
    if (fact.category === 'red_flag') flags.add('red_flag')

    // Speaker check, only where the transcript names the speakers.
    const speakers = cited.map((s) => s.speaker).filter((x): x is string => !!x)
    if (speakers.length === cited.length && cited.length) {
      if (fact.attribution === 'patient_reported' && speakers.every((s) => CLINICIAN_SIDE.has(s))) flags.add('speaker_mismatch')
      if (fact.attribution === 'clinician_stated' && speakers.every((s) => PATIENT_SIDE.has(s))) flags.add('speaker_mismatch')
    }

    const d = fact.details
    if (fact.category === 'allergy') {
      if (fact.negated) {
        for (const a of ctx.activeAllergies) {
          const item = itemsOf('allergy', a.id)
          if (item) evidence.push(recordEvidence(item, 'conflicts', 'Said there are no allergies, but this allergy is recorded.'))
          flags.add('conflicts_with_record')
        }
        if (!ctx.activeAllergies.length && ctx.patient.noKnownAllergies) {
          const item = ctx.items.find((i) => i.sourceType === 'patient' && i.ref.startsWith('A'))
          if (item) evidence.push(recordEvidence(item, 'supports', null))
        }
      } else if (d.substance) {
        const match = ctx.activeAllergies.find((a) => nameMatches(a.substance, d.substance!))
        if (match) evidence.push(recordEvidence(itemsOf('allergy', match.id)!, 'supports', null))
        else {
          flags.add('not_in_record')
          if (ctx.patient.noKnownAllergies) {
            const item = ctx.items.find((i) => i.sourceType === 'patient' && i.ref.startsWith('A'))
            if (item) evidence.push(recordEvidence(item, 'conflicts', 'The record states no known allergies.'))
            flags.add('conflicts_with_record')
          }
        }
      }
    }

    if (fact.category === 'medication_history' && d.medication && !fact.negated) {
      const match = ctx.priorPrescriptions.find((m) => nameMatches(m.drugName, d.medication!))
      if (match) evidence.push(recordEvidence(itemsOf('prescription_item', match.id)!, 'supports', 'Previously prescribed here.'))
      else flags.add('not_in_record')
    }

    if (fact.category === 'past_medical_history' && !fact.negated) {
      const match = ctx.priorDiagnoses.find((dx) => nameMatches(dx.description, fact.text))
      if (match) evidence.push(recordEvidence(itemsOf('diagnosis', match.id)!, 'supports', null))
    }

    if (fact.category === 'vital_sign' && d.vitalKind && d.value !== null) {
      const kind = d.vitalKind as VitalKind
      const measured = ctx.visitObservations.find((o) => o.kind === kind)
      if (measured) {
        const item = itemsOf('observation', measured.id)!
        const tol = safety.vitalTolerance[kind] ?? 0
        const diff = Math.abs(measured.value - d.value)
        if (diff > tol) {
          flags.add('conflicts_with_record')
          evidence.push(recordEvidence(item, 'conflicts', `Measured ${measured.value} ${VITALS[kind].unit}; said ${d.value} (difference above the configured ${tol}).`))
        } else evidence.push(recordEvidence(item, 'supports', null))
      }
    }
    return { fact, citedSegments: cited, flags: [...flags], evidence }
  })
}
