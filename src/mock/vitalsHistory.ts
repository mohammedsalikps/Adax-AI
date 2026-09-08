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
    {
      recordedAt: '2025-07-03T11:05:00',
      values: {
        heartRate: 94,
        systolicBp: 126,
        diastolicBp: 81,
        spo2: 95,
        temperature: 38.2,
        respiratoryRate: 20,
        bloodGlucose: 112,
      },
    },
    {
      recordedAt: '2025-02-07T11:05:00',
      values: {
        heartRate: 100,
        systolicBp: 123,
        diastolicBp: 80,
        spo2: 94,
        temperature: 38.5,
        respiratoryRate: 22,
        bloodGlucose: 106,
      },
    },
    {
      recordedAt: '2024-09-03T11:05:00',
      values: {
        heartRate: 106,
        systolicBp: 121,
        diastolicBp: 78,
        spo2: 92,
        temperature: 38.5,
        respiratoryRate: 23,
        bloodGlucose: 100,
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
    {
      recordedAt: '2025-09-01T10:02:00',
      values: {
        heartRate: 66,
        systolicBp: 106,
        diastolicBp: 68,
        spo2: 99,
        temperature: 36.3,
        respiratoryRate: 14,
      },
    },
    {
      recordedAt: '2025-04-08T10:02:00',
      values: {
        heartRate: 63,
        systolicBp: 103,
        diastolicBp: 65,
        spo2: 99,
        temperature: 36.3,
        respiratoryRate: 14,
      },
    },
    {
      recordedAt: '2024-11-02T10:02:00',
      values: {
        heartRate: 61,
        systolicBp: 101,
        diastolicBp: 63,
        spo2: 99,
        temperature: 36.2,
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
    {
      recordedAt: '2025-12-18T11:40:00',
      values: {
        heartRate: 82,
        systolicBp: 140,
        diastolicBp: 89,
        spo2: 97,
        temperature: 37.0,
        respiratoryRate: 18,
      },
    },
    {
      recordedAt: '2025-07-25T11:40:00',
      values: {
        heartRate: 85,
        systolicBp: 143,
        diastolicBp: 90,
        spo2: 97,
        temperature: 37.1,
        respiratoryRate: 18,
      },
    },
    {
      recordedAt: '2025-02-18T11:40:00',
      values: {
        heartRate: 87,
        systolicBp: 145,
        diastolicBp: 92,
        spo2: 97,
        temperature: 37.3,
        respiratoryRate: 19,
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
    {
      recordedAt: '2026-03-17T16:05:00',
      values: {
        heartRate: 90,
        systolicBp: 119,
        diastolicBp: 76,
        spo2: 94,
        temperature: 36.8,
        respiratoryRate: 20,
      },
    },
    {
      recordedAt: '2025-10-22T16:05:00',
      values: {
        heartRate: 85,
        systolicBp: 120,
        diastolicBp: 77,
        spo2: 95,
        temperature: 36.7,
        respiratoryRate: 19,
      },
    },
    {
      recordedAt: '2025-05-18T16:05:00',
      values: {
        heartRate: 81,
        systolicBp: 121,
        diastolicBp: 77,
        spo2: 96,
        temperature: 36.7,
        respiratoryRate: 17,
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
    {
      recordedAt: '2026-04-12T10:35:00',
      values: {
        heartRate: 68,
        systolicBp: 145,
        diastolicBp: 90,
        spo2: 96,
        temperature: 36.6,
        respiratoryRate: 16,
        bloodGlucose: 103,
      },
    },
    {
      recordedAt: '2025-11-17T10:35:00',
      values: {
        heartRate: 70,
        systolicBp: 139,
        diastolicBp: 87,
        spo2: 97,
        temperature: 36.6,
        respiratoryRate: 16,
        bloodGlucose: 102,
      },
    },
    {
      recordedAt: '2025-06-13T10:35:00',
      values: {
        heartRate: 71,
        systolicBp: 132,
        diastolicBp: 83,
        spo2: 97,
        temperature: 36.6,
        respiratoryRate: 15,
        bloodGlucose: 101,
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
    {
      recordedAt: '2025-11-22T12:15:00',
      values: {
        heartRate: 93,
        systolicBp: 108,
        diastolicBp: 69,
        spo2: 98,
        temperature: 36.5,
        respiratoryRate: 17,
      },
    },
    {
      recordedAt: '2025-06-29T12:15:00',
      values: {
        heartRate: 87,
        systolicBp: 112,
        diastolicBp: 71,
        spo2: 98,
        temperature: 36.5,
        respiratoryRate: 17,
      },
    },
    {
      recordedAt: '2025-01-23T12:15:00',
      values: {
        heartRate: 82,
        systolicBp: 116,
        diastolicBp: 74,
        spo2: 98,
        temperature: 36.6,
        respiratoryRate: 16,
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
    {
      recordedAt: '2025-11-04T14:50:00',
      values: {
        heartRate: 82,
        systolicBp: 138,
        diastolicBp: 89,
        spo2: 95,
        temperature: 36.7,
        respiratoryRate: 18,
        bloodGlucose: 112,
      },
    },
    {
      recordedAt: '2025-06-11T14:50:00',
      values: {
        heartRate: 80,
        systolicBp: 133,
        diastolicBp: 86,
        spo2: 96,
        temperature: 36.7,
        respiratoryRate: 17,
        bloodGlucose: 109,
      },
    },
    {
      recordedAt: '2025-01-05T14:50:00',
      values: {
        heartRate: 77,
        systolicBp: 129,
        diastolicBp: 83,
        spo2: 97,
        temperature: 36.6,
        respiratoryRate: 16,
        bloodGlucose: 105,
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
    {
      recordedAt: '2026-03-20T09:55:00',
      values: {
        heartRate: 74,
        systolicBp: 127,
        diastolicBp: 78,
        spo2: 97,
        temperature: 36.4,
        respiratoryRate: 15,
      },
    },
    {
      recordedAt: '2025-10-25T09:55:00',
      values: {
        heartRate: 74,
        systolicBp: 125,
        diastolicBp: 78,
        spo2: 97,
        temperature: 36.5,
        respiratoryRate: 15,
      },
    },
    {
      recordedAt: '2025-05-21T09:55:00',
      values: {
        heartRate: 74,
        systolicBp: 124,
        diastolicBp: 78,
        spo2: 98,
        temperature: 36.5,
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
