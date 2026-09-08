/**
 * Rule-derived clinical decision support.
 *
 * NOTHING HERE IS A DIAGNOSIS. Every entry is produced by an explicit rule
 * over data already in the record — a vital sign outside its reference range,
 * a condition on the chart, a recorded allergy, a line the doctor said in the
 * transcript. No model runs, no clinical inference is performed, and nothing
 * is ever written to the diagnosis or the prescription automatically.
 *
 * Each entry therefore carries a `basis`: the exact recorded fact that
 * triggered it. A suggestion with no basis is a bug, not a suggestion.
 */

export type InsightCategory =
  | 'observation'
  | 'risk'
  | 'examination'
  | 'investigation'
  | 'medication-safety'
  | 'follow-up'
  | 'lifestyle'

/** Where the triggering fact came from, so the doctor can go and check it. */
export type InsightSource =
  | 'vitals'
  | 'vitals-history'
  | 'conditions'
  | 'allergies'
  | 'medications'
  | 'transcript'

/** The doctor's decision. Suggestions start pending and stay that way until
 *  the doctor acts — nothing is accepted by default. */
export type InsightDecision = 'pending' | 'accepted' | 'rejected'

export interface ClinicalInsight {
  id: string
  category: InsightCategory
  /** What the doctor is being asked to consider. Never phrased as a finding. */
  text: string
  /** The recorded fact that produced this entry. Always populated. */
  basis: string
  source: InsightSource
}

export interface ClinicalAnalysis {
  generatedAt: string
  /** Read-only restatement of what is already recorded. Not decisions. */
  observations: ClinicalInsight[]
  /** Entries the doctor accepts or rejects individually. */
  suggestions: ClinicalInsight[]
}

/** Shown wherever rule-derived suggestions appear. */
export const INSIGHT_DISCLAIMER =
  'Rule-based suggestions from recorded data — not a diagnosis. The doctor decides.'

/** Shown when the record contains nothing the rules can act on. */
export const NO_INSIGHTS =
  'Nothing to suggest from the current record.'
