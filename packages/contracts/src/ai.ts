import { z } from 'zod'

/** Note sections the assistant may draft into (never diagnoses or prescriptions). */
export const AI_SECTIONS = ['chiefComplaint', 'history', 'pastHistory', 'examination', 'assessment', 'plan', 'followUp'] as const
export const AiSection = z.enum(AI_SECTIONS)
export type AiSection = z.infer<typeof AiSection>

export const ProviderStatus = z.object({ available: z.boolean(), provider: z.string().nullable(), model: z.string().nullable(), reason: z.string().nullable() })
export const AiStatus = z.object({ llm: ProviderStatus, stt: ProviderStatus })
export type AiStatus = z.infer<typeof AiStatus>

export const TranscriptSource = z.enum(['typed', 'pasted', 'audio_upload', 'browser_recording'])
export const TranscriptSegment = z.object({ id: z.string(), speaker: z.string().nullable(), text: z.string() })
export type TranscriptSegment = z.infer<typeof TranscriptSegment>

export const Transcript = z.object({
  id: z.uuid(),
  source: TranscriptSource,
  audioFileId: z.uuid().nullable(),
  segments: z.array(TranscriptSegment),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
})
export type Transcript = z.infer<typeof Transcript>

export const CreateTranscriptRequest = z.object({
  text: z.string().trim().min(1, 'Enter the transcript').max(50_000, 'At most 50,000 characters'),
  source: z.enum(['typed', 'pasted']).default('pasted'),
})
export type CreateTranscriptRequest = z.input<typeof CreateTranscriptRequest>

export const DraftDecision = z.enum(['pending', 'accepted', 'edited', 'rejected'])
export const AiDraftItem = z.object({
  id: z.uuid(),
  section: AiSection,
  text: z.string(),
  sourceSegmentIds: z.array(z.string()),
  /** True when the model cited no segment that exists in the transcript. */
  unsupported: z.boolean(),
  decision: DraftDecision,
  finalText: z.string().nullable(),
  decidedAt: z.string().nullable(),
})
export type AiDraftItem = z.infer<typeof AiDraftItem>

export const AiRun = z.object({
  id: z.uuid(),
  kind: z.enum(['stt', 'note_draft']),
  status: z.enum(['succeeded', 'failed']),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  latencyMs: z.number().nullable(),
  createdAt: z.string(),
})
export type AiRun = z.infer<typeof AiRun>

export const AiDraft = z.object({
  id: z.uuid(),
  transcriptId: z.uuid(),
  createdAt: z.string(),
  run: AiRun,
  items: z.array(AiDraftItem),
})
export type AiDraft = z.infer<typeof AiDraft>

export const AudioRecording = z.object({ fileId: z.uuid(), source: z.enum(['audio_upload', 'browser_recording']), mimeType: z.string(), sizeBytes: z.number(), createdAt: z.string(), transcriptId: z.uuid().nullable() })
export type AudioRecording = z.infer<typeof AudioRecording>

export const EncounterAi = z.object({
  consent: z.object({ granted: z.boolean(), scope: z.enum(['ongoing', 'encounter']).nullable(), recordedAt: z.string().nullable() }),
  status: AiStatus,
  audio: z.array(AudioRecording),
  transcripts: z.array(Transcript),
  drafts: z.array(AiDraft),
  runs: z.array(AiRun),
})
export type EncounterAi = z.infer<typeof EncounterAi>

export const DraftDecisionRequest = z.object({
  decision: z.enum(['accepted', 'edited', 'rejected']),
  /** Required for "edited": the doctor's corrected text. */
  text: z.string().trim().max(8000).optional(),
  /** Required to accept an item the model could not tie to the transcript. */
  confirmUnsupported: z.boolean().optional(),
})
export type DraftDecisionRequest = z.input<typeof DraftDecisionRequest>

export const AiConsentRequest = z.object({ method: z.enum(['verbal', 'written']) })
