import type { AiStatus, AskManaRequest, ManaAnswer, ManaAnswerList } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'
import { newIdempotencyKey } from './ai.ts'

export const manaKey = (patientId: string) => ['patient', patientId, 'mana'] as const

export function useManaAnswers(patientId: string) {
  return useQuery({ queryKey: manaKey(patientId), queryFn: () => api<ManaAnswerList>(`/patients/${patientId}/mana/questions`), select: (d) => d.answers })
}

export function useAiStatus(enabled = true) {
  return useQuery({ queryKey: ['ai', 'status'], queryFn: () => api<AiStatus>('/ai/status'), enabled, staleTime: 60_000 })
}

/** Replaces (or prepends) one answer in the cached list. */
function useStoreAnswer(patientId: string) {
  const qc = useQueryClient()
  return (a: ManaAnswer) =>
    qc.setQueryData<ManaAnswerList>(manaKey(patientId), (old) => {
      const rest = (old?.answers ?? []).filter((x) => x.id !== a.id)
      const exists = (old?.answers ?? []).some((x) => x.id === a.id)
      return { answers: exists ? (old?.answers ?? []).map((x) => (x.id === a.id ? a : x)) : [a, ...rest] }
    })
}

export function useAskMana(patientId: string) {
  const store = useStoreAnswer(patientId)
  return useMutation({
    mutationFn: (body: Omit<AskManaRequest, 'idempotencyKey'>) => api<ManaAnswer>(`/patients/${patientId}/mana/questions`, { method: 'POST', body: { ...body, idempotencyKey: newIdempotencyKey() } }),
    onSuccess: store,
  })
}

export function useManaAction(patientId: string, action: 'review' | 'retry') {
  const store = useStoreAnswer(patientId)
  return useMutation({ mutationFn: (id: string) => api<ManaAnswer>(`/mana/questions/${id}/${action}`, { method: 'POST' }), onSuccess: store })
}
