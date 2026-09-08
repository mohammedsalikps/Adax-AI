import type { VitalDefinition, VitalKey, VitalStatus } from '@/types/vitals'

/* ------------------------------------------------------------------
   Reference ranges for display purposes only. These are conventional
   adult ranges used to colour the interface — they are NOT a clinical
   decision aid and carry no diagnostic meaning.
------------------------------------------------------------------ */

export const VITAL_DEFINITIONS: Record<VitalKey, VitalDefinition> = {
  heartRate: {
    key: 'heartRate',
    label: 'Heart rate',
    shortLabel: 'HR',
    unit: 'bpm',
    normalRange: [60, 100],
    cautionRange: [50, 120],
    decimals: 0,
  },
  systolicBp: {
    key: 'systolicBp',
    label: 'Systolic BP',
    shortLabel: 'SBP',
    unit: 'mmHg',
    normalRange: [90, 130],
    cautionRange: [85, 160],
    decimals: 0,
  },
  diastolicBp: {
    key: 'diastolicBp',
    label: 'Diastolic BP',
    shortLabel: 'DBP',
    unit: 'mmHg',
    normalRange: [60, 85],
    cautionRange: [55, 100],
    decimals: 0,
  },
  spo2: {
    key: 'spo2',
    label: 'Oxygen saturation',
    shortLabel: 'SpO₂',
    unit: '%',
    normalRange: [95, 100],
    cautionRange: [92, 100],
    decimals: 0,
  },
  temperature: {
    key: 'temperature',
    label: 'Temperature',
    shortLabel: 'Temp',
    unit: '°C',
    normalRange: [36.1, 37.2],
    cautionRange: [35.5, 38],
    decimals: 1,
  },
  respiratoryRate: {
    key: 'respiratoryRate',
    label: 'Respiratory rate',
    shortLabel: 'RR',
    unit: '/min',
    normalRange: [12, 20],
    cautionRange: [10, 24],
    decimals: 0,
  },
  bloodGlucose: {
    key: 'bloodGlucose',
    label: 'Blood glucose',
    shortLabel: 'Glucose',
    unit: 'mg/dL',
    normalRange: [70, 110],
    cautionRange: [60, 140],
    decimals: 0,
  },
}

export const VITAL_ORDER: VitalKey[] = [
  'heartRate',
  'systolicBp',
  'diastolicBp',
  'spo2',
  'temperature',
  'respiratoryRate',
  'bloodGlucose',
]

/** Places a reading in its normal, borderline or out-of-range band. */
export function classifyVital(key: VitalKey, value: number): VitalStatus {
  const { normalRange, cautionRange } = VITAL_DEFINITIONS[key]
  if (value >= normalRange[0] && value <= normalRange[1]) return 'normal'
  if (value >= cautionRange[0] && value <= cautionRange[1]) return 'caution'
  return 'critical'
}

export function formatVitalValue(key: VitalKey, value: number): string {
  return value.toFixed(VITAL_DEFINITIONS[key].decimals)
}

/** "60–100 bpm", shown beneath a reading as its reference range. */
export function referenceRangeLabel(key: VitalKey): string {
  const { normalRange, unit } = VITAL_DEFINITIONS[key]
  return `${normalRange[0]}–${normalRange[1]} ${unit}`
}
