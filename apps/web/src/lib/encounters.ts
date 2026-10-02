import type { Encounter, TimelineEntry } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from './api.ts'

export const encounterKey = (id: string) => ['encounter', id] as const

export function useEncounter(id: string | undefined) {
  return useQuery({ queryKey: encounterKey(id ?? ''), queryFn: () => api<Encounter>(`/encounters/${id}`), enabled: !!id, staleTime: 0 })
}

export function useTimeline(patientId: string) {
  return useQuery({
    queryKey: ['patient', patientId, 'timeline'],
    queryFn: () => api<{ entries: TimelineEntry[] }>(`/patients/${patientId}/timeline`),
    select: (d) => d.entries,
  })
}

/** Starts (or resumes) the consultation for a visit and opens it. Doctors only. */
export function useStartConsultation() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (visitId: string) => api<Encounter>(`/visits/${visitId}/encounter`, { method: 'POST' }),
    onSuccess: (e) => {
      qc.setQueryData(encounterKey(e.id), e)
      void qc.invalidateQueries({ queryKey: ['visits'] })
      navigate(`/doctor/encounters/${e.id}`)
    },
  })
}
