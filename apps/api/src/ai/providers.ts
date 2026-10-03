import type { AiSection, AiStatus, SpeechStatus, TranscriptSegment, VitalKind } from '@adaxai/contracts'
import type { Config } from '../config.ts'
import type { AppSettings } from '../settings/schema.ts'
import { createAnthropicProviders } from './anthropic.ts'
import { RuleFactExtractor } from './extract/rules.ts'
import { LocalSpeechTranscriber, speechUrlProblem } from './stt.ts'

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
  /** True when it runs in this process (rules) and nothing leaves the machine. */
  readonly local?: boolean
  /** Languages it is built for; text in another language is not attempted. */
  readonly languages?: string[]
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

/** One transcribed line as the speech model gave it, on the timeline of the audio it was given. */
export interface SpeechSegment {
  startMs: number
  endMs: number
  text: string
  /** Mean token probability the model gave its own words; null when the model reported none. A model score, not a calibrated chance of being right. */
  confidence: number | null
  avgLogprob: number | null
  noSpeechProb: number | null
}
export interface SpeechModel {
  id: string
  runtime: string
  computeType: string | null
  /** SHA-256 of the weights file, so a transcript can be tied to the exact model. */
  weightsSha256: string | null
  local: true
}
export interface SpeechResult {
  segments: SpeechSegment[]
  /** The language the model detected (or was told), a code such as "en". */
  language: string | null
  languageProbability: number | null
  languageSource: 'detected' | 'hint'
  /** Length of the audio as the service decoded it. */
  durationMs: number
  model: SpeechModel
  /** The service has no diariser: who spoke is never inferred. */
  speakers: 'not_identified'
}
export interface SpeechHealth {
  state: 'ready' | 'loading' | 'unavailable'
  reason: string | null
  model: { id: string; runtime: string | null; weightsSha256: string | null } | null
}
/** Speech-to-text that runs on this machine. There is no hosted implementation and none may be added behind this interface by default. */
export interface Transcriber {
  readonly provider: string
  readonly model: string
  readonly local: true
  transcribe(audio: Buffer, mimeType: string, filename: string, opts?: { language?: string | null }): Promise<SpeechResult>
  health(): Promise<SpeechHealth>
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
  let transcriber: Transcriber | null = null
  let sttReason: string | null = null
  if (stt.provider === 'local') {
    const problem = speechUrlProblem(stt.url, config.ai.speech.allowNonLoopback)
    if (problem) sttReason = `Local transcription is unavailable: ${problem}`
    else transcriber = new LocalSpeechTranscriber({ url: stt.url, allowNonLoopback: config.ai.speech.allowNonLoopback })
  } else {
    sttReason = 'Local transcription is not configured. Set SPEECH_PROVIDER=local, install the speech model (npm run speech:setup, npm run speech:model) and start the service (npm run speech:dev). Audio is never sent to a hosted service.'
  }
  const f = settings.ai.features
  const extractor: FactExtractor | null = !f.extraction ? null : settings.ai.extraction.provider === 'llm' ? (llm?.extractor ?? null) : new RuleFactExtractor()
  const off = (name: string) => `${name} is switched off in config/adaxai.yaml.`
  const noKey = 'ANTHROPIC_API_KEY is not set on this server'
  return {
    drafter: f.noteDraft ? (llm?.drafter ?? null) : null,
    extractor,
    recommender: f.recommendations ? (llm?.recommender ?? null) : null,
    describer: f.imageAnalysis ? (llm?.describer ?? null) : null,
    qa: f.patientQa ? (llm?.qa ?? null) : null,
    transcriber,
    features: f,
    liveChunkSeconds: settings.ai.stt.liveChunkSeconds,
    reasons: {
      llm: llm ? null : `AI drafting, extraction and recommendations are not configured: ${noKey}.`,
      stt: sttReason,
      vision: !f.imageAnalysis ? off('AI image analysis') : llm ? null : `AI image analysis is not configured: ${noKey}. Photographs are still stored for clinician review.`,
      qa: !f.patientQa ? off('Mana AI summaries') : llm ? null : `Mana AI summaries are not configured: ${noKey}. Answers read directly from the record are still shown.`,
    },
  }
}

const providerStatus = (p: { provider: string; model: string } | null | undefined, reason: string | null | undefined) => ({ available: !!p, provider: p?.provider ?? null, model: p?.model ?? null, reason: p ? null : (reason ?? 'Not configured.') })

/** What the local speech service says about itself just now (a short, cached health check), never a guess from configuration alone. */
async function speechStatus(p: AiProviders): Promise<SpeechStatus> {
  const t = p.transcriber
  if (!t) return { available: false, provider: null, model: null, reason: p.reasons.stt ?? 'Local transcription is not configured.', state: 'not_configured', local: true, runtime: null, weightsSha256: null }
  const h = await t.health()
  return {
    available: h.state === 'ready',
    provider: t.provider,
    model: h.model?.id ?? t.model,
    reason: h.state === 'ready' ? null : (h.reason ?? 'The local speech service is not ready.'),
    state: h.state,
    local: true,
    runtime: h.model?.runtime ?? null,
    weightsSha256: h.model?.weightsSha256 ?? null,
  }
}

export async function aiStatus(p: AiProviders): Promise<AiStatus> {
  const x = p.extractor
  return {
    llm: providerStatus(p.drafter ?? p.recommender, p.reasons.llm),
    stt: await speechStatus(p),
    extraction: x
      ? { available: true, provider: x.provider, version: x.promptVersion, local: x.local ?? false, languages: x.languages ?? [], reason: null }
      : { available: false, provider: 'none', version: '', local: true, languages: [], reason: p.reasons.llm ?? 'Extraction is switched off in config/adaxai.yaml.' },
    vision: providerStatus(p.describer, p.reasons.vision ?? p.reasons.llm),
    qa: providerStatus(p.qa, p.reasons.qa ?? p.reasons.llm),
    features: p.features ?? ALL_FEATURES,
    liveChunkSeconds: p.liveChunkSeconds ?? 20,
  }
}
