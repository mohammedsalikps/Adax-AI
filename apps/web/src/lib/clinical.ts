import type { Observation, PatientDetail, PatientSummary, Visit } from '@adaxai/contracts'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useMe } from './auth.tsx'

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

export function usePatientSearch(q: string) {
  const debounced = useDebounced(q.trim())
  return useQuery({
    queryKey: ['patients', 'search', debounced],
    queryFn: ({ signal }) => api<{ patients: PatientSummary[] }>('/patients', { query: { q: debounced || undefined }, signal }),
    select: (d) => d.patients,
    placeholderData: keepPreviousData,
  })
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
      void qc.invalidateQueries({ queryKey: ['patient', v.patient.id] })
    },
  })
}
