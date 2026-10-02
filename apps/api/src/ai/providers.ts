import type { AiSection, AiStatus, TranscriptSegment, VitalKind } from '@adaxai/contracts'
import type { Config } from '../config.ts'
import type { AppSettings } from '../settings/schema.ts'
import { createAnthropicProviders } from './anthropic.ts'
import { OpenAiCompatibleTranscriber } from './stt.ts'

/**
 * Provider-neutral interfaces. The clinical application depends only on
 * these; adapters (anthropic.ts, stt.ts, or an HTTP client to a self-hosted
 * Python model service) implement them. Swapping a provider never touches
 * routes, storage or review logic.
 */

export interface CallMeta {
  /** Model that actually answered (may differ from the requested one after a server-side fallback). */
  model: string
  inputTokens: number | null
  outputTokens: number | null
  requestId: string | null
}

export interface DraftItemOut {
  section: AiSection
  text: string
  sourceSegmentIds: string[]
}
export interface NoteDraftResult extends CallMeta {
  items: DraftItemOut[]
}

/** Turns transcript segments into suggested note passages, each citing segment ids. */
export interface NoteDrafter {
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  draft(segments: TranscriptSegment[]): Promise<NoteDraftResult>
}

export interface ExtractedFact {
  category: string
  text: string
  attribution: 'patient_reported' | 'clinician_stated' | 'other_speaker'
  certainty: 'stated' | 'uncertain'
  uncertaintyReason: string | null
  negated: boolean
  details: { substance: string | null; medication: string | null; dose: string | null; duration: string | null; vitalKind: VitalKind | null; value: number | null; unit: string | null }
  sourceSegmentIds: string[]
}
export interface FactExtractor {
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  extract(segments: TranscriptSegment[]): Promise<CallMeta & { facts: ExtractedFact[] }>
}

export interface RecommendationOut {
  kind: string
  urgency: 'routine' | 'attention'
  text: string
  rationale: string
  supportingRefs: string[]
  conflicts: { text: string; refs: string[] }[]
  missingInformation: string[]
}
export interface RecommendationInput {
  patientLine: string
  recordText: string
  transcriptText: string
}
export interface Recommender {
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  recommend(input: RecommendationInput): Promise<CallMeta & { recommendations: RecommendationOut[]; insufficientData: boolean; insufficientDataReason: string | null }>
}

export interface ImageDescription {
  quality: 'adequate' | 'limited' | 'inadequate'
  qualityReason: string
  observations: { text: string; location: string; confidence: 'low' | 'medium' | 'high' }[]
  limitations: string[]
  summary: string
}
export interface ImageDescriber {
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  describe(image: Buffer, mimeType: string, context: { imageType: string; bodySite: string | null }): Promise<CallMeta & { result: ImageDescription }>
}

/** One cited statement in a Mana AI summary (refs are record item references such as M1). */
export interface CitedText {
  text: string
  refs: string[]
}
export interface RecordQuestionInput {
  /** Age band and sex only. */
  patientLine: string
  /** Record items, one per line: [ref] date · field · status: excerpt */
  recordText: string
  question: string
}
/** Answers a doctor's question from the given record items only (Mana AI). */
export interface RecordQuestionAnswerer {
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  answer(input: RecordQuestionInput): Promise<CallMeta & { statements: CitedText[]; conflicts: CitedText[]; notFound: string[] }>
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

export type AiFeatures = AppSettings['ai']['features']
export const ALL_FEATURES: AiFeatures = { noteDraft: true, extraction: true, recommendations: true, imageAnalysis: true, liveTranscription: true, patientQa: true }

export interface AiProviders {
  drafter: NoteDrafter | null
  transcriber: Transcriber | null
  extractor?: FactExtractor | null
  recommender?: Recommender | null
  describer?: ImageDescriber | null
  qa?: RecordQuestionAnswerer | null
  /** Why a provider is unavailable, shown to users instead of any fabricated output. */
  reasons: { llm: string | null; stt: string | null; vision?: string | null; qa?: string | null }
  features?: AiFeatures
  liveChunkSeconds?: number
}

export function providersFromConfig(config: Config, settings: AppSettings): AiProviders {
  // `settings` already has the environment model overrides applied (effectiveSettings).
  const llm = config.ai.anthropicApiKey ? createAnthropicProviders(config.ai.anthropicApiKey, settings.ai.llm, settings.ai.vision) : null
  const stt = settings.ai.stt
  const transcriber = config.ai.stt.apiKey ? new OpenAiCompatibleTranscriber({ apiKey: config.ai.stt.apiKey, baseUrl: stt.baseUrl, model: stt.model, providerName: stt.provider }) : null
  const f = settings.ai.features
  const off = (name: string) => `${name} is switched off in config/adaxai.yaml.`
  const noKey = 'ANTHROPIC_API_KEY is not set on this server'
  return {
    drafter: f.noteDraft ? (llm?.drafter ?? null) : null,
    extractor: f.extraction ? (llm?.extractor ?? null) : null,
    recommender: f.recommendations ? (llm?.recommender ?? null) : null,
    describer: f.imageAnalysis ? (llm?.describer ?? null) : null,
    qa: f.patientQa ? (llm?.qa ?? null) : null,
    transcriber,
    features: f,
    liveChunkSeconds: settings.ai.stt.liveChunkSeconds,
    reasons: {
      llm: llm ? null : `AI drafting, extraction and recommendations are not configured: ${noKey}.`,
      stt: transcriber ? null : 'Speech-to-text is not configured on this server (AI_STT_API_KEY is not set). Audio is stored; type or paste the transcript instead.',
      vision: !f.imageAnalysis ? off('AI image analysis') : llm ? null : `AI image analysis is not configured: ${noKey}. Photographs are still stored for clinician review.`,
      qa: !f.patientQa ? off('Mana AI summaries') : llm ? null : `Mana AI summaries are not configured: ${noKey}. Answers read directly from the record are still shown.`,
    },
  }
}

const providerStatus = (p: { provider: string; model: string } | null | undefined, reason: string | null | undefined) => ({ available: !!p, provider: p?.provider ?? null, model: p?.model ?? null, reason: p ? null : (reason ?? 'Not configured.') })

export function aiStatus(p: AiProviders): AiStatus {
  return {
    llm: providerStatus(p.drafter ?? p.extractor ?? p.recommender, p.reasons.llm),
    stt: providerStatus(p.transcriber, p.reasons.stt),
    vision: providerStatus(p.describer, p.reasons.vision ?? p.reasons.llm),
    qa: providerStatus(p.qa, p.reasons.qa ?? p.reasons.llm),
    features: p.features ?? ALL_FEATURES,
    liveChunkSeconds: p.liveChunkSeconds ?? 20,
  }
}
