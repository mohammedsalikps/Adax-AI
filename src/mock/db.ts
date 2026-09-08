import type { Appointment, AppointmentStatus } from '@/types/appointment'
import type {
  Consultation,
  ConsultationAiDraft,
  PastVisit,
  TranscriptLine,
} from '@/types/consultation'
import type { CurrentMedication, Drug } from '@/types/prescription'
import type { Patient } from '@/types/patient'
import type { VitalsSnapshot } from '@/types/vitals'
import { toIsoDateString } from '@/lib/format'
import { createId, nextPatientId } from '@/lib/ids'
import { createSeedAppointments } from './appointments'
import { SEED_CONSULTATIONS } from './consultations'
import { SEED_CURRENT_MEDICATIONS } from './currentMedications'
import { SEED_FORMULARY } from './medications'
import { SEED_PATIENTS } from './patients'
import { DEMO_DOCTOR } from './doctor'
import { getVitalsHistory } from './vitalsHistory'
import { SEED_VISITS } from './visits'
import {
  getFamilyHistory,
  getLabReports,
  getStudyReports,
} from '@/mock/patientRecords'
import type { FamilyHistoryEntry, LabReport, StudyReport } from '@/types/record'

/* ------------------------------------------------------------------
   Mock repository. Simulates a clinic database using browser storage
   only — there is no server, no network call and no real database.

   Every read is asynchronous and slightly delayed so the interface
   exercises its real loading states. Replacing this module with an HTTP
   client later requires no change to any calling component.
------------------------------------------------------------------ */

const STORAGE_KEY = 'medconsult.mockdb.v1'
const READ_LATENCY_MS = 220
const WRITE_LATENCY_MS = 420

interface DatabaseSnapshot {
  version: 1
  /** yyyy-mm-dd the schedule was generated for. */
  scheduleDate: string
  patients: Patient[]
  visits: PastVisit[]
  appointments: Appointment[]
  consultations: Consultation[]
  /** Vitals recorded in-app, merged with the seed history on read. */
  recordedVitals: Record<string, VitalsSnapshot[]>
}

/** Appointment joined with its patient, the shape the queue screen needs. */
export interface QueueEntry {
  appointment: Appointment
  patient: Patient
}

export type NewPatientInput = Omit<Patient, 'id' | 'registeredOn' | 'lastVisitOn'>

/** Fields supplied when a consultation is first saved. */
export type NewConsultationInput = Omit<
  Consultation,
  'id' | 'createdAt' | 'updatedAt' | 'doctorName'
>

/** Fields a saved consultation may be revised with. */
export type ConsultationUpdate = Partial<
  Omit<Consultation, 'id' | 'patientId' | 'createdAt' | 'doctorName'>
>

/** The subset of a chart the Edit Patient form is allowed to change. */
export type PatientUpdate = Partial<
  Pick<
    Patient,
    | 'fullName'
    | 'contact'
    | 'emergencyContact'
    | 'allergies'
    | 'chronicConditions'
    | 'bloodGroup'
  >
>

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

function createSnapshot(): DatabaseSnapshot {
  return {
    version: 1,
    scheduleDate: toIsoDateString(),
    patients: structuredClone(SEED_PATIENTS),
    visits: structuredClone(SEED_VISITS),
    appointments: createSeedAppointments(),
    consultations: structuredClone(SEED_CONSULTATIONS),
    recordedVitals: {},
  }
}

function persist(snapshot: DatabaseSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage unavailable (private mode, quota). The session continues
    // in memory; data simply does not survive a reload.
  }
}

function read(): DatabaseSnapshot {
  let snapshot: DatabaseSnapshot | null = null

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DatabaseSnapshot>
      if (parsed.version === 1 && Array.isArray(parsed.patients)) {
        snapshot = {
          ...(parsed as DatabaseSnapshot),
          consultations: parsed.consultations ?? structuredClone(SEED_CONSULTATIONS),
          recordedVitals: parsed.recordedVitals ?? {},
        }
      }
    }
  } catch {
    snapshot = null
  }

  if (!snapshot) {
    const fresh = createSnapshot()
    persist(fresh)
    return fresh
  }

  // Rebuild the schedule when the stored one is from an earlier day, so
  // the queue never displays yesterday's slots. Patients and visits —
  // including any registered during the demo — are preserved.
  if (snapshot.scheduleDate !== toIsoDateString()) {
    snapshot = {
      ...snapshot,
      scheduleDate: toIsoDateString(),
      appointments: createSeedAppointments(),
    }
    persist(snapshot)
  }

  return snapshot
}

function write(mutate: (snapshot: DatabaseSnapshot) => void): DatabaseSnapshot {
  const snapshot = read()
  mutate(snapshot)
  persist(snapshot)
  return snapshot
}

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

export const mockDb = {
  /** Every registered patient, most recently registered first. */
  async listPatients(): Promise<Patient[]> {
    const { patients } = read()
    const sorted = [...patients].sort((a, b) =>
      b.registeredOn.localeCompare(a.registeredOn),
    )
    return delay(sorted, READ_LATENCY_MS)
  },

  async getPatient(patientId: string): Promise<Patient | undefined> {
    const { patients } = read()
    const match = patients.find(
      (patient) => normalise(patient.id) === normalise(patientId),
    )
    return delay(match, READ_LATENCY_MS)
  },

  /** Matches on patient ID, ABHA number, name or phone. */
  async searchPatients(query: string): Promise<Patient[]> {
    const term = normalise(query)
    if (!term) return delay([], READ_LATENCY_MS)

    const digits = term.replace(/\D/g, '')
    const { patients } = read()

    const matches = patients.filter((patient) => {
      if (normalise(patient.id).includes(term)) return true
      if (normalise(patient.fullName).includes(term)) return true
      if (digits.length >= 4) {
        if (patient.contact.phone.includes(digits)) return true
        if (patient.abhaNumber?.includes(digits)) return true
      }
      return false
    })

    return delay(matches, READ_LATENCY_MS)
  },

  /** Registers a patient and issues the next clinic ID for this year. */
  async createPatient(input: NewPatientInput): Promise<Patient> {
    const existing = read().patients.map((patient) => patient.id)
    const patient: Patient = {
      ...input,
      id: nextPatientId(existing),
      registeredOn: toIsoDateString(),
    }

    write((snapshot) => {
      snapshot.patients.push(patient)
    })

    return delay(patient, WRITE_LATENCY_MS)
  },

  /**
   * Applies edits to an existing chart. Rejects an unknown patient rather
   * than silently creating one.
   */
  async updatePatient(patientId: string, changes: PatientUpdate): Promise<Patient> {
    let updated: Patient | undefined

    write((snapshot) => {
      const index = snapshot.patients.findIndex((item) => item.id === patientId)
      if (index === -1) return
      updated = { ...snapshot.patients[index], ...changes }
      snapshot.patients[index] = updated
    })

    if (!updated) {
      throw new Error(`No patient found with ID ${patientId}.`)
    }

    return delay(updated, WRITE_LATENCY_MS)
  },

  /** Medications recorded on the chart, active ones first. */
  async listMedications(patientId: string): Promise<CurrentMedication[]> {
    const matches = SEED_CURRENT_MEDICATIONS.filter(
      (medication) => medication.patientId === patientId,
    ).sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.startedOn.localeCompare(a.startedOn)
    })
    return delay(matches, READ_LATENCY_MS)
  },

  /** Seed vitals plus anything recorded in-app, most recent first. */
  async listVitalsHistory(patientId: string): Promise<VitalsSnapshot[]> {
    const { recordedVitals } = read()
    const merged = [...getVitalsHistory(patientId), ...(recordedVitals[patientId] ?? [])]
    merged.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    return delay(merged, READ_LATENCY_MS)
  },

  /** Stores a newly measured set of vitals against the chart. */
  async recordVitals(
    patientId: string,
    snapshot: VitalsSnapshot,
  ): Promise<VitalsSnapshot> {
    write((current) => {
      const existing = current.recordedVitals[patientId] ?? []
      current.recordedVitals[patientId] = [...existing, snapshot]
    })
    return delay(snapshot, WRITE_LATENCY_MS)
  },

  /* ------------------------------------------------------------ consultations */

  async getConsultation(consultationId: string): Promise<Consultation | undefined> {
    const { consultations } = read()
    return delay(
      consultations.find((item) => item.id === consultationId),
      READ_LATENCY_MS,
    )
  },

  /** Consultations for one patient, most recent first. */
  async listConsultations(patientId: string): Promise<Consultation[]> {
    const { consultations } = read()
    const matches = consultations
      .filter((item) => item.patientId === patientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return delay(matches, READ_LATENCY_MS)
  },

  async createConsultation(input: NewConsultationInput): Promise<Consultation> {
    const timestamp = new Date().toISOString()
    const consultation: Consultation = {
      ...input,
      id: createId('con'),
      doctorName: DEMO_DOCTOR.fullName,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    write((snapshot) => {
      snapshot.consultations.push(consultation)
    })

    return delay(consultation, WRITE_LATENCY_MS)
  },

  /** Stores the transcript against a saved consultation. */
  async saveTranscript(
    consultationId: string,
    transcript: TranscriptLine[],
  ): Promise<Consultation> {
    return this.updateConsultation(consultationId, { transcript })
  },

  /**
   * Stores the most recent AI draft against a saved consultation. Storing a
   * draft never changes the consultation's clinical fields — applying it is
   * a separate, explicit action by the doctor.
   */
  async saveAiDraft(
    consultationId: string,
    aiDraft: ConsultationAiDraft,
  ): Promise<Consultation> {
    return this.updateConsultation(consultationId, { aiDraft })
  },

  /** Revises a saved consultation. Rejects an unknown id. */
  async updateConsultation(
    consultationId: string,
    changes: ConsultationUpdate,
  ): Promise<Consultation> {
    let updated: Consultation | undefined

    write((snapshot) => {
      const index = snapshot.consultations.findIndex(
        (item) => item.id === consultationId,
      )
      if (index === -1) return
      updated = {
        ...snapshot.consultations[index],
        ...changes,
        updatedAt: new Date().toISOString(),
      }
      snapshot.consultations[index] = updated
    })

    if (!updated) {
      throw new Error(`No consultation found with ID ${consultationId}.`)
    }

    return delay(updated, WRITE_LATENCY_MS)
  },

  /** Past visits for one patient, most recent first. */
  async listVisits(patientId: string): Promise<PastVisit[]> {
    const { visits } = read()
    const matches = visits
      .filter((visit) => visit.patientId === patientId)
      .sort((a, b) => b.visitedOn.localeCompare(a.visitedOn))
    return delay(matches, READ_LATENCY_MS)
  },

  /**
   * Investigation records. These are reference data rather than working
   * records — nothing in the application creates or edits them — so they are
   * read straight from the seed rather than from the mutable snapshot.
   */
  async listLabReports(patientId: string): Promise<LabReport[]> {
    return delay(getLabReports(patientId), READ_LATENCY_MS)
  },

  async listStudyReports(patientId: string): Promise<StudyReport[]> {
    return delay(getStudyReports(patientId), READ_LATENCY_MS)
  },

  async listFamilyHistory(patientId: string): Promise<FamilyHistoryEntry[]> {
    return delay(getFamilyHistory(patientId), READ_LATENCY_MS)
  },

  /** Today's schedule joined with patient records, ordered by slot time. */
  async listQueue(): Promise<QueueEntry[]> {
    const { appointments, patients } = read()

    const entries = appointments
      .map((appointment) => {
        const patient = patients.find((item) => item.id === appointment.patientId)
        return patient ? { appointment, patient } : null
      })
      .filter((entry): entry is QueueEntry => entry !== null)
      .sort((a, b) => a.appointment.slotAt.localeCompare(b.appointment.slotAt))

    return delay(entries, READ_LATENCY_MS)
  },

  async updateAppointmentStatus(
    appointmentId: string,
    status: AppointmentStatus,
  ): Promise<void> {
    write((snapshot) => {
      const appointment = snapshot.appointments.find(
        (item) => item.id === appointmentId,
      )
      if (appointment) appointment.status = status
    })
    return delay(undefined, WRITE_LATENCY_MS)
  },

  /** Static formulary — not persisted, since it never changes. */
  async listFormulary(): Promise<Drug[]> {
    return delay(SEED_FORMULARY, READ_LATENCY_MS)
  },

  /** Discards all stored data and restores the seed set. */
  reset(): void {
    persist(createSnapshot())
  },
}
