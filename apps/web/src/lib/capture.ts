import type { CaptureStatus, EncounterAi } from '@adaxai/contracts'
import { useQuery } from '@tanstack/react-query'
import { api } from './api.ts'
import { type AiResponse, aiKey, newIdempotencyKey, useAiMutation } from './ai.ts'

export const captureKey = (encounterId: string) => ['encounter', encounterId, 'capture'] as const

/**
 * Whether recording may start, and (while recording) whether it must stop: consent and the local speech service, polled. The answer holds
 * no patient content. Not kept in the cache once the page is gone.
 */
export function useCaptureStatus(encounterId: string, opts: { poll: boolean }) {
  return useQuery({
    queryKey: captureKey(encounterId),
    queryFn: () => api<CaptureStatus>(`/encounters/${encounterId}/capture`),
    staleTime: 3_000,
    refetchInterval: opts.poll ? 4_000 : 20_000,
    // While recording, consent and the consultation's state are watched even when the tab is in the background.
    refetchIntervalInBackground: opts.poll,
    refetchOnWindowFocus: true,
    gcTime: 0,
  })
}

export const useAssignSpeakers = (encounterId: string, transcriptId: string) =>
  useAiMutation<{ assignments: { segmentId: string; speaker: string }[] }>(encounterId, (body) => api(`/transcripts/${transcriptId}/speakers`, { method: 'POST', body }))

export const useExtractPoints = (encounterId: string) => useAiMutation<string>(encounterId, (transcriptId) => api(`/transcripts/${transcriptId}/extract`, { method: 'POST', body: { idempotencyKey: newIdempotencyKey() } }))

export { fmtOffset, languageName } from './transcriptTime.ts'

export type { AiResponse, EncounterAi }
export { aiKey }
