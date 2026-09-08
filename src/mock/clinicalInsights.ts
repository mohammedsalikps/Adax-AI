import { VITAL_DEFINITIONS, formatVitalValue, referenceRangeLabel } from '@/lib/vitals'
import type {
  ClinicalAnalysis,
  ClinicalInsight,
  InsightCategory,
  InsightSource,
} from '@/types/insight'
import type { TranscriptLine } from '@/types/consultation'
import type { Patient } from '@/types/patient'
import type { CurrentMedication } from '@/types/prescription'
import type { VitalKey, VitalsSnapshot } from '@/types/vitals'

/* ------------------------------------------------------------------
   Rule-based clinical decision support over the existing record.

   This is NOT a model and performs NO clinical reasoning. It is a fixed
   set of rules, each of which fires only when a specific recorded fact is
   present, and each of which records that fact as its `basis`.

   Hard boundaries, matching the rest of the application:
     - It never states a diagnosis, only what the doctor might consider.
     - It never names a drug to prescribe. Medication rules only raise
       safety checks against what is already on the chart.
     - Nothing it produces is written to the consultation automatically.
------------------------------------------------------------------ */

const SIMULATED_LATENCY_MS = 700

let counter = 0
function insight(
  category: InsightCategory,
  source: InsightSource,
  text: string,
  basis: string,
): ClinicalInsight {
  counter += 1
  return { id: `insight_${counter}`, category, source, text, basis }
}

/** Vitals the rules comment on, in the order they should be read. */
const REVIEWED_VITALS: VitalKey[] = [
  'systolicBp',
  'diastolicBp',
  'heartRate',
  'spo2',
  'temperature',
  'respiratoryRate',
  'bloodGlucose',
]

/**
 * Direction of the last three recorded values for one measurement.
 * Returns null unless every step moves the same way — a wobble is not a trend.
 */
function directionOf(values: number[]): 'rising' | 'falling' | null {
  if (values.length < 3) return null
  const recent = values.slice(-3)
  const steps = recent.slice(1).map((value, index) => value - recent[index])
  if (steps.every((step) => step > 0)) return 'rising'
  if (steps.every((step) => step < 0)) return 'falling'
  return null
}

export interface ClinicalAnalysisInput {
  patient: Patient
  latestVitals?: VitalsSnapshot
  vitalsHistory?: VitalsSnapshot[]
  medications?: CurrentMedication[]
  transcript?: TranscriptLine[]
}

/**
 * Applies every rule to the record and returns what fired.
 *
 * Pure and synchronous, so it can be unit tested without timers.
 */
export function buildClinicalAnalysis({
  patient,
  latestVitals,
  vitalsHistory = [],
  medications = [],
  transcript = [],
}: ClinicalAnalysisInput): ClinicalAnalysis {
  const observations: ClinicalInsight[] = []
  const suggestions: ClinicalInsight[] = []

  /* ---------------------------------------------------- vitals out of range */
  const outOfRange: string[] = []
  for (const key of REVIEWED_VITALS) {
    const reading = latestVitals?.readings[key]
    if (!reading || reading.status === 'normal') continue

    const definition = VITAL_DEFINITIONS[key]
    const shown = `${formatVitalValue(key, reading.value)} ${definition.unit}`
    outOfRange.push(`${definition.label} ${shown}`)

    observations.push(
      insight(
        reading.status === 'critical' ? 'risk' : 'observation',
        'vitals',
        `${definition.label} is ${reading.status === 'critical' ? 'outside' : 'at the edge of'} the reference range at ${shown}.`,
        `Recorded ${definition.label.toLowerCase()} ${shown}; reference ${referenceRangeLabel(key)}.`,
      ),
    )
  }

  /* ------------------------------------------------- direction over history */
  const ordered = [...vitalsHistory].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  )
  for (const key of REVIEWED_VITALS) {
    const series = ordered
      .map((snapshot) => snapshot.readings[key]?.value)
      .filter((value): value is number => value !== undefined)
    const direction = directionOf(series)
    if (!direction) continue

    const definition = VITAL_DEFINITIONS[key]
    const shown = series.slice(-3).map((value) => formatVitalValue(key, value))
    observations.push(
      insight(
        'observation',
        'vitals-history',
        `${definition.label} has been ${direction} across the last three recorded readings.`,
        `${shown.join(' → ')} ${definition.unit}.`,
      ),
    )
  }

  /* ---------------------------------------------------- recorded conditions */
  for (const condition of patient.chronicConditions) {
    observations.push(
      insight('observation', 'conditions', `${condition} is on the chart.`, `Recorded condition: ${condition}.`),
    )
  }

  /* --------------------------------------------------------- allergy safety */
  for (const allergy of patient.allergies) {
    suggestions.push(
      insight(
        'medication-safety',
        'allergies',
        `Confirm nothing prescribed today contains ${allergy.substance}.`,
        `Recorded allergy: ${allergy.substance} (${allergy.severity}) — ${allergy.reaction}.`,
      ),
    )
  }

  /* ----------------------------------------------------- current medication */
  const active = medications.filter((medication) => medication.active)
  if (active.length > 0) {
    suggestions.push(
      insight(
        'medication-safety',
        'medications',
        'Review the existing medication list before adding to it.',
        `${active.length} active medication${active.length === 1 ? '' : 's'} on the chart: ${active
          .map((medication) => `${medication.brandName} ${medication.strength}`)
          .join(', ')}.`,
      ),
    )
  }

  /* ------------------------------------------------ investigations to weigh */
  const glucose = latestVitals?.readings.bloodGlucose
  const diabetic = patient.chronicConditions.some((condition) =>
    /diabet/i.test(condition),
  )
  if (glucose && glucose.status !== 'normal' && diabetic) {
    suggestions.push(
      insight(
        'investigation',
        'vitals',
        'Consider whether a current HbA1c would help before adjusting management.',
        `Blood glucose ${formatVitalValue('bloodGlucose', glucose.value)} mg/dL is outside ${referenceRangeLabel('bloodGlucose')}, with diabetes on the chart.`,
      ),
    )
  }

  const systolic = latestVitals?.readings.systolicBp
  const hypertensive = patient.chronicConditions.some((condition) =>
    /hypertens/i.test(condition),
  )
  if (systolic && systolic.status !== 'normal' && hypertensive) {
    suggestions.push(
      insight(
        'examination',
        'vitals',
        'Consider a repeat blood pressure reading before acting on this one.',
        `Single recorded systolic ${formatVitalValue('systolicBp', systolic.value)} mmHg is outside ${referenceRangeLabel('systolicBp')}, with hypertension on the chart.`,
      ),
    )
  }

  /* --------------------------------------------- symptoms said out loud ---- */
  const patientSpeech = transcript
    .filter((line) => line.speaker === 'patient')
    .map((line) => line.text)

  const SYMPTOM_RULES: { pattern: RegExp; text: string; label: string }[] = [
    {
      pattern: /numb|tingl/i,
      label: 'numbness or tingling',
      text: 'Consider examining peripheral sensation in the feet.',
    },
    {
      pattern: /blurred|vision/i,
      label: 'a vision change',
      text: 'Consider whether a fundus or visual acuity check is warranted.',
    },
    {
      pattern: /chest (pain|discomfort)|breathless/i,
      label: 'chest discomfort or breathlessness',
      text: 'Consider a cardiovascular examination before the visit ends.',
    },
    {
      pattern: /tired|fatigue|exhaust/i,
      label: 'tiredness',
      text: 'Consider what could account for the reported tiredness.',
    },
  ]

  for (const rule of SYMPTOM_RULES) {
    const quoted = patientSpeech.find((text) => rule.pattern.test(text))
    if (!quoted) continue
    suggestions.push(
      insight(
        'examination',
        'transcript',
        rule.text,
        `The patient mentioned ${rule.label}: “${quoted.trim()}”`,
      ),
    )
  }

  const dietMentioned = patientSpeech.find((text) => /diet|eating|food|meal/i.test(text))
  if (dietMentioned) {
    suggestions.push(
      insight(
        'lifestyle',
        'transcript',
        'Diet came up in the conversation — consider recording any advice given.',
        `The patient said: “${dietMentioned.trim()}”`,
      ),
    )
  }

  /* -------------------------------------------------------------- follow-up */
  if (outOfRange.length > 0) {
    suggestions.push(
      insight(
        'follow-up',
        'vitals',
        'Consider whether this visit needs a follow-up date.',
        `Outside the reference range today: ${outOfRange.join('; ')}.`,
      ),
    )
  }

  return {
    generatedAt: new Date().toISOString(),
    observations,
    suggestions,
  }
}

/**
 * Async wrapper mirroring the rest of the mock layer's latency, so the
 * interface exercises its real loading state.
 */
export function generateClinicalAnalysis(
  input: ClinicalAnalysisInput,
): Promise<ClinicalAnalysis> {
  const analysis = buildClinicalAnalysis(input)
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(analysis), SIMULATED_LATENCY_MS)
  })
}
