import type { EncounterAi, ReviewRequest } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/ui/Toast.tsx'
import { api } from './api.ts'

export const aiKey = (encounterId: string) => ['encounter', encounterId, 'ai'] as const

export type AiResponse = EncounterAi & { notice?: string | null; item?: { id: string; type: string; section: string | null; finalText: string | null; action: string } }

/** Mutations that return the encounter's AI state replace the cached copy; notices are shown as toasts. */
export function useAiMutation<T>(encounterId: string, fn: (body: T) => Promise<AiResponse>) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      if (d.consent) qc.setQueryData(aiKey(encounterId), d)
      if (d.notice) toast('error', d.notice)
    },
  })
}

export function useReview(encounterId: string, type: 'fact' | 'recommendation' | 'draft_item' | 'image_analysis', id: string) {
  return useAiMutation<ReviewRequest>(encounterId, (body) => api(`/ai-review/${type}/${id}`, { method: 'POST', body }))
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting review',
  accepted: 'Accepted',
  edited: 'Edited and accepted',
  rejected: 'Rejected',
  deferred: 'Deferred',
  superseded: 'Replaced by a newer run',
}

export const JOB_LABEL: Record<string, string> = {
  transcription: 'Transcription',
  note_draft: 'Note draft',
  extraction: 'Fact extraction',
  safety_check: 'Safety rules',
  recommendations: 'AI recommendations',
  image_analysis: 'Image description',
  patient_qa: 'Mana summary',
  consultation_draft: 'Consultation draft (local AI)',
}

/** A fresh key per user action, so a double click or resend runs the job once. */
export const newIdempotencyKey = () => crypto.randomUUID()
