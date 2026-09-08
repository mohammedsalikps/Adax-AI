import type { Appointment } from '@/types/appointment'

/** Slot on today's date, so the demonstration queue is always current. */
function todayAt(hours: number, minutes: number): string {
  const slot = new Date()
  slot.setHours(hours, minutes, 0, 0)
  return slot.toISOString()
}

/**
 * Today's clinic schedule. Regenerated whenever the stored data is from a
 * previous day, so the queue never shows stale slots.
 */
export function createSeedAppointments(): Appointment[] {
  return [
    {
      id: 'apt_001',
      patientId: 'PT-2026-00097',
      slotAt: todayAt(9, 15),
      arrivedAt: todayAt(9, 8),
      status: 'completed',
      visitType: 'follow-up',
      chiefComplaint: 'Post-operative review, right knee',
      vitalsRecorded: true,
    },
    {
      id: 'apt_002',
      patientId: 'PT-2026-00190',
      slotAt: todayAt(9, 45),
      arrivedAt: todayAt(9, 40),
      status: 'completed',
      visitType: 'follow-up',
      chiefComplaint: 'Thyroid function review',
      vitalsRecorded: true,
    },
    {
      id: 'apt_003',
      patientId: 'PT-2026-00142',
      slotAt: todayAt(10, 30),
      arrivedAt: todayAt(10, 18),
      status: 'in-consultation',
      visitType: 'follow-up',
      chiefComplaint: 'Diabetes review, fatigue and foot numbness',
      vitalsRecorded: true,
    },
    {
      id: 'apt_004',
      patientId: 'PT-2026-00118',
      slotAt: todayAt(10, 45),
      arrivedAt: todayAt(10, 36),
      status: 'waiting',
      visitType: 'follow-up',
      chiefComplaint: 'Recurrent migraine, trigger diary review',
      vitalsRecorded: true,
    },
    {
      id: 'apt_005',
      patientId: 'PT-2026-00163',
      slotAt: todayAt(11, 0),
      arrivedAt: todayAt(10, 52),
      status: 'waiting',
      visitType: 'follow-up',
      chiefComplaint: 'Chest discomfort on exertion',
      vitalsRecorded: false,
    },
    {
      id: 'apt_006',
      patientId: 'PT-2026-00156',
      slotAt: todayAt(11, 30),
      status: 'waiting',
      visitType: 'follow-up',
      chiefComplaint: 'Asthma review, night-time symptoms',
      vitalsRecorded: false,
    },
    {
      id: 'apt_007',
      patientId: 'PT-2026-00171',
      slotAt: todayAt(12, 0),
      status: 'waiting',
      visitType: 'follow-up',
      chiefComplaint: 'Anaemia follow-up, repeat haemoglobin',
      vitalsRecorded: false,
    },
    {
      id: 'apt_008',
      patientId: 'PT-2026-00184',
      slotAt: todayAt(12, 15),
      status: 'waiting',
      visitType: 'first-visit',
      chiefComplaint: 'Sleep study results discussion',
      vitalsRecorded: false,
    },
  ]
}
