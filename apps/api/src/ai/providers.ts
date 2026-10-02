import type { AiSection, AiStatus, TranscriptSegment } from '@adaxai/contracts'
import type { Config } from '../config.ts'
import { createAnthropicDrafter } from './anthropic.ts'
import { OpenAiCompatibleTranscriber } from './stt.ts'

export interface DraftItemOut {
  section: AiSection
  text: string
  sourceSegmentIds: string[]
}

export interface NoteDraftResult {
  items: DraftItemOut[]
  /** Model that actually answered (may differ from the requested one after a server-side fallback). */
  model: string
  inputTokens: number | null
  outputTokens: number | null
  requestId: string | null
}

/** Turns transcript segments into suggested note passages, each citing segment ids. */
export interface NoteDrafter {
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  draft(segments: TranscriptSegment[]): Promise<NoteDraftResult>
}

export interface Transcriber {
  readonly provider: string
  readonly model: string
  transcribe(audio: Buffer, mimeType: string, filename: string): Promise<{ text: string; requestId: string | null }>
}

/** A provider failure that is safe to show (no provider internals, no patient data). */
export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}

export interface AiProviders {
  drafter: NoteDrafter | null
  transcriber: Transcriber | null
  /** Why a provider is unavailable, shown to users instead of any fabricated output. */
  reasons: { llm: string | null; stt: string | null }
}

export function providersFromConfig(config: Config): AiProviders {
  const drafter = config.ai.anthropicApiKey ? createAnthropicDrafter(config.ai.anthropicApiKey, config.ai.noteModel) : null
  const transcriber = config.ai.stt.apiKey ? new OpenAiCompatibleTranscriber(config.ai.stt) : null
  return {
    drafter,
    transcriber,
    reasons: {
      llm: drafter ? null : 'AI note drafting is not configured on this server (ANTHROPIC_API_KEY is not set).',
      stt: transcriber ? null : 'Speech-to-text is not configured on this server (AI_STT_API_KEY is not set). Audio is stored; type or paste the transcript instead.',
    },
  }
}

export function aiStatus(p: AiProviders): AiStatus {
  return {
    llm: { available: !!p.drafter, provider: p.drafter?.provider ?? null, model: p.drafter?.model ?? null, reason: p.reasons.llm },
    stt: { available: !!p.transcriber, provider: p.transcriber?.provider ?? null, model: p.transcriber?.model ?? null, reason: p.reasons.stt },
  }
}
