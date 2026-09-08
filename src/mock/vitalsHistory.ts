import { classifyVital } from '@/lib/vitals'
import type { VitalKey, VitalReading, VitalsSnapshot } from '@/types/vitals'

/* ------------------------------------------------------------------
   Vitals recorded at reception during previous visits. Fictional.
   Statuses are derived from the reference ranges rather than written
   by hand, so the seed data and the interface can never disagree.
------------------------------------------------------------------ */

interface RawSnapshot {
  recordedAt: string
  values: Partial<Record<VitalKey, number>>
}

const RAW_HISTORY: Record<string, RawSnapshot[]> = {
  'PT-2026-00142': [
    {
      recordedAt: '2026-06-12T10:22:00',
      values: {
        heartRate: 82,
        systolicBp: 146,
        diastolicBp: 90,
        spo2: 97,
        temperature: 36.8,
        respiratoryRate: 16,
        bloodGlucose: 152,
      },
    },
    {
      recordedAt: '2026-03-08T09:48:00',
      values: {
        heartRate: 78,
        systolicBp: 132,
        diastolicBp: 84,
        spo2: 98,
        temperature: 36.6,
        respiratoryRate: 15,
        bloodGlucose: 128,
      },
    },
    {
      recordedAt: '2025-11-15T11:05:00',
      values: {
        heartRate: 88,
        systolicBp: 128,
        diastolicBp: 82,
        spo2: 96,
        temperature: 37.6,
        respiratoryRate: 18,
        bloodGlucose: 118,
      },
    },
  ],
  'PT-2026-00118': [
    {
      recordedAt: '2026-05-28T15:10:00',
      values: {
        heartRate: 72,
        systolicBp: 112,
        diastolicBp: 74,
        spo2: 99,
        temperature: 36.5,
        respiratoryRate: 14,
      },
    },
    {
      recordedAt: '2026-01-14T10:02:00',
      values: {
        heartRate: 68,
        systolicBp: 108,
        diastolicBp: 70,
        spo2: 99,
        temperature: 36.4,
        respiratoryRate: 14,
      },
    },
  ],
  'PT-2026-00097': [
    {
      recordedAt: '2026-08-19T09:20:00',
      values: {
        heartRate: 76,
        systolicBp: 134,
        diastolicBp: 86,
        spo2: 97,
        temperature: 36.7,
        respiratoryRate: 16,
      },
    },
    {
      recordedAt: '2026-05-02T11:40:00',
      values: {
        heartRate: 80,
        systolicBp: 138,
        diastolicBp: 88,
        spo2: 97,
        temperature: 36.9,
        respiratoryRate: 17,
      },
    },
  ],
  'PT-2026-00156': [
    {
      recordedAt: '2026-07-30T16:05:00',
      values: {
        heartRate: 94,
        systolicBp: 118,
        diastolicBp: 76,
        spo2: 93,
        temperature: 36.8,
        respiratoryRate: 22,
      },
    },
  ],
  'PT-2026-00163': [
    {
      recordedAt: '2026-08-25T10:35:00',
      values: {
        heartRate: 66,
        systolicBp: 152,
        diastolicBp: 94,
        spo2: 96,
        temperature: 36.6,
        respiratoryRate: 16,
        bloodGlucose: 104,
      },
    },
  ],
  'PT-2026-00171': [
    {
      recordedAt: '2026-04-06T12:15:00',
      values: {
        heartRate: 98,
        systolicBp: 104,
        diastolicBp: 66,
        spo2: 98,
        temperature: 36.5,
        respiratoryRate: 18,
      },
    },
  ],
  'PT-2026-00184': [
    {
      recordedAt: '2026-03-19T14:50:00',
      values: {
        heartRate: 84,
        systolicBp: 142,
        diastolicBp: 92,
        spo2: 94,
        temperature: 36.7,
        respiratoryRate: 19,
        bloodGlucose: 116,
      },
    },
  ],
  'PT-2026-00190': [
    {
      recordedAt: '2026-08-02T09:55:00',
      values: {
        heartRate: 74,
        systolicBp: 128,
        diastolicBp: 78,
        spo2: 97,
        temperature: 36.4,
        respiratoryRate: 15,
      },
    },
  ],
}

function toSnapshot(raw: RawSnapshot): VitalsSnapshot {
  const readings: Partial<Record<VitalKey, VitalReading>> = {}

  for (const [key, value] of Object.entries(raw.values)) {
    const vitalKey = key as VitalKey
    readings[vitalKey] = {
      key: vitalKey,
      value,
      status: classifyVital(vitalKey, value),
      recordedAt: raw.recordedAt,
    }
  }

  return { recordedAt: raw.recordedAt, readings }
}

/** Recorded vitals for one patient, most recent first. */
export function getVitalsHistory(patientId: string): VitalsSnapshot[] {
  return (RAW_HISTORY[patientId] ?? [])
    .map(toSnapshot)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
}
