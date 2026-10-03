import type { ConditionInput, ConditionStatusChange, InvestigationInput, InvestigationStatusChange, MedicationInput, MedicationStatusChange, PatientHistory } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'

export const historyKey = (patientId: string) => ['patient', patientId, 'history'] as const

/** A patient's longitudinal history: conditions, medicines, results, earlier signed consultations, allergies, latest vitals. */
export function usePatientHistory(patientId: string, opts: { poll?: boolean } = {}) {
  // A consultation that stays open re-reads the record every two minutes (each read is audited), so an allergy added elsewhere is not missed for long.
  return useQuery({ queryKey: historyKey(patientId), queryFn: () => api<PatientHistory>(`/patients/${patientId}/history`), staleTime: 15_000, ...(opts.poll && { refetchInterval: 120_000 }) })
}

/** Every write refreshes the history (and the rest of the patient's data); the API records and audits each change. */
function useHistoryMutation<V>(patientId: string, run: (v: V) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient', patientId] }),
  })
}

export const useAddCondition = (patientId: string) => useHistoryMutation(patientId, (body: ConditionInput) => api(`/patients/${patientId}/conditions`, { method: 'POST', body }))
export const useChangeCondition = (patientId: string) => useHistoryMutation(patientId, (v: { id: string; body: ConditionStatusChange }) => api(`/patients/${patientId}/conditions/${v.id}/status`, { method: 'POST', body: v.body }))
export const useAddMedication = (patientId: string) => useHistoryMutation(patientId, (body: MedicationInput) => api(`/patients/${patientId}/medications`, { method: 'POST', body }))
export const useChangeMedication = (patientId: string) => useHistoryMutation(patientId, (v: { id: string; body: MedicationStatusChange }) => api(`/patients/${patientId}/medications/${v.id}/status`, { method: 'POST', body: v.body }))
export const useAddInvestigation = (patientId: string) => useHistoryMutation(patientId, (body: InvestigationInput) => api(`/patients/${patientId}/investigations`, { method: 'POST', body }))
export const useChangeInvestigation = (patientId: string) => useHistoryMutation(patientId, (v: { id: string; body: InvestigationStatusChange }) => api(`/patients/${patientId}/investigations/${v.id}/status`, { method: 'POST', body: v.body }))
export const useAddAllergy = (patientId: string) => useHistoryMutation(patientId, (body: { substance: string; reaction?: string | null; severity: 'mild' | 'moderate' | 'severe' | 'unknown' }) => api(`/patients/${patientId}/allergies`, { method: 'POST', body }))

/** "Since 2019" or "Since Mar 2019". */
export function sinceLabel(year: number, month: number | null): string {
  if (!month) return `Since ${year}`
  return `Since ${new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'short' })} ${year}`
}

/** The reference range of a result as it should read. */
export function rangeLabel(r: { refLow: number | null; refHigh: number | null; refText: string | null; unit: string | null }): string {
  if (r.refText) return r.refText
  const u = r.unit ? ` ${r.unit}` : ''
  if (r.refLow != null && r.refHigh != null) return `${r.refLow}–${r.refHigh}${u}`
  if (r.refHigh != null) return `up to ${r.refHigh}${u}`
  if (r.refLow != null) return `at least ${r.refLow}${u}`
  return '—'
}
