import type { Observation, PatientDetail, PatientSummary, Visit } from '@adaxai/contracts'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useMe } from './auth.tsx'

/** Where the OPD queue is for this role (the doctor's landing page is Home, the nurse's is the queue). */
export function usePortalQueuePath(): string {
  const { data: me } = useMe()
  return me?.role === 'doctor' ? '/doctor/queue' : '/nurse'
}

/** Base path of the current clinical portal ('/nurse' or '/doctor'). */
export function usePortalBase(): '/nurse' | '/doctor' {
  const { data: me } = useMe()
  return me?.role === 'doctor' ? '/doctor' : '/nurse'
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const patientKey = (id: string) => ['patient', id] as const

export function usePatient(id: string | undefined) {
  return useQuery({ queryKey: patientKey(id ?? ''), queryFn: () => api<PatientDetail>(`/patients/${id}`), enabled: !!id })
}

/**
 * Searches patients (every search is audited with the patients it disclosed).
 * With `enabled: false` nothing is requested: callers that only need a search
 * once the person has typed something must say so, or an empty term lists the
 * facility's most recently updated patients.
 */
export function usePatientSearch(q: string, { enabled = true }: { enabled?: boolean } = {}) {
  const debounced = useDebounced(q.trim())
  return useQuery({
    enabled,
    queryKey: ['patients', 'search', debounced],
    queryFn: ({ signal }) => api<{ patients: PatientSummary[] }>('/patients', { query: { q: debounced || undefined }, signal }),
    select: (d) => d.patients,
    placeholderData: keepPreviousData,
  })
}

/**
 * Patient lookup for a picker: nothing is requested until two characters are
 * typed, results are shown only for what is typed now (never the previous
 * term's), and the state says whether it is waiting, done, or failed.
 */
export function usePatientLookup(q: string) {
  const term = q.trim()
  const debounced = useDebounced(term)
  const ready = term.length >= 2
  const query = useQuery({
    enabled: ready && debounced.length >= 2,
    queryKey: ['patients', 'search', debounced],
    queryFn: ({ signal }) => api<{ patients: PatientSummary[] }>('/patients', { query: { q: debounced }, signal }),
    select: (d) => d.patients,
  })
  const current = ready && debounced === term
  const status: 'idle' | 'searching' | 'done' | 'error' = !ready ? 'idle' : current && query.isError ? 'error' : current && query.isSuccess && !query.isFetching ? 'done' : 'searching'
  return { status, patients: status === 'done' ? (query.data ?? []) : [], error: query.error, retry: () => void query.refetch() }
}

export function usePatientObservations(id: string, includeErrors = false) {
  return useQuery({
    queryKey: ['patient', id, 'observations', includeErrors],
    queryFn: () => api<{ observations: Observation[] }>(`/patients/${id}/observations`, { query: { includeErrors: includeErrors ? 'true' : undefined } }),
    select: (d) => d.observations,
  })
}

export function useVisits(params: { mine?: boolean; date?: string }) {
  return useQuery({
    queryKey: ['visits', params],
    queryFn: () => api<{ date: string; visits: Visit[] }>('/visits', { query: { mine: params.mine ? 'true' : undefined, date: params.date } }),
    // The queue is shared between nurses and doctors; poll so changes appear without reloading.
    refetchInterval: 5_000,
  })
}

/** Mutations that change a patient update the cached profile and refresh queue lists. */
export function usePatientMutation<TBody>(patientId: string, path: string, method: 'POST' | 'PUT' | 'PATCH' = 'POST') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TBody) => api<PatientDetail>(`/patients/${patientId}${path}`, { method, body }),
    onSuccess: (p) => {
      qc.setQueryData(patientKey(patientId), p)
      void qc.invalidateQueries({ queryKey: ['visits'] })
    },
  })
}

export function useVisitMutation<TBody>(visitId: string, path: string, method: 'POST' | 'PATCH' = 'POST') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TBody) => api<Visit>(`/visits/${visitId}${path}`, { method, body }),
    onSuccess: (v) => {
      // Put the visit as the server returned it into the cached queue first: the row's next action then
      // sends the visit's current status (e.g. after vitals moved it to intake), not the one before.
      qc.setQueriesData<{ date: string; visits: Visit[] }>({ queryKey: ['visits'] }, (d) => (d ? { ...d, visits: d.visits.map((x) => (x.id === v.id ? v : x)) } : d))
      void qc.invalidateQueries({ queryKey: ['visits'] })
      // A checked-in appointment follows its visit (closed in the queue, or signed).
      void qc.invalidateQueries({ queryKey: ['appointments'] })
      void qc.invalidateQueries({ queryKey: ['patient', v.patient.id] })
    },
  })
}
