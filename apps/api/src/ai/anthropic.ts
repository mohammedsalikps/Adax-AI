import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { AI_SECTIONS, type TranscriptSegment, VitalKind } from '@adaxai/contracts'
import { z } from 'zod'
import type { AppSettings } from '../settings/schema.ts'
import { HostedReasoner } from './llm/hosted.ts'
import { EXTRACTION_PROMPT, IMAGE_PROMPT, MANA_QA_PROMPT, NOTE_PROMPT, type PromptDef, RECOMMENDATION_PROMPT } from './prompts.ts'
import { AiProviderError, type CallMeta, type ExtractedFact, type FactExtractor, type ImageDescriber, type ImageDescription, type NoteDrafter, type NoteDraftResult, type RecommendationInput, type RecommendationOut, type Recommender, type RecordQuestionAnswerer, type RecordQuestionInput } from './providers.ts'

/** Kept for existing callers and tests. */
export const NOTE_PROMPT_VERSION = NOTE_PROMPT.id
export const NOTE_SYSTEM_PROMPT = NOTE_PROMPT.text

const DraftOutput = z.object({
  items: z.array(z.object({ section: z.enum(AI_SECTIONS), text: z.string(), sourceSegmentIds: z.array(z.string()) })),
})

const ExtractionOutput = z.object({
  facts: z.array(
    z.object({
      category: z.enum(['chief_complaint', 'symptom', 'past_medical_history', 'medication_history', 'allergy', 'family_history', 'social_history', 'examination_finding', 'vital_sign', 'clinician_assessment', 'plan', 'medication_mention', 'follow_up', 'red_flag']),
      text: z.string(),
      attribution: z.enum(['patient_reported', 'clinician_stated', 'other_speaker']),
      certainty: z.enum(['stated', 'uncertain']),
      uncertaintyReason: z.string().nullable(),
      negated: z.boolean(),
      details: z.object({ substance: z.string().nullable(), medication: z.string().nullable(), dose: z.string().nullable(), duration: z.string().nullable(), vitalKind: VitalKind.nullable(), value: z.number().nullable(), unit: z.string().nullable() }),
      sourceSegmentIds: z.array(z.string()),
    }),
  ),
})

const RecommendationOutput = z.object({
  insufficientData: z.boolean(),
  insufficientDataReason: z.string().nullable(),
  recommendations: z.array(
    z.object({
      kind: z.enum(['safety_check', 'clarification', 'missing_information', 'investigation', 'follow_up', 'referral_consideration', 'documentation']),
      urgency: z.enum(['routine', 'attention']),
      text: z.string(),
      rationale: z.string(),
      supportingRefs: z.array(z.string()),
      conflicts: z.array(z.object({ text: z.string(), refs: z.array(z.string()) })),
      missingInformation: z.array(z.string()),
    }),
  ),
})

const ImageOutput = z.object({
  quality: z.enum(['adequate', 'limited', 'inadequate']),
  qualityReason: z.string(),
  observations: z.array(z.object({ text: z.string(), location: z.string(), confidence: z.enum(['low', 'medium', 'high']) })),
  limitations: z.array(z.string()),
  summary: z.string(),
})

const Cited = z.object({ text: z.string(), refs: z.array(z.string()) })
const ManaOutput = z.object({ statements: z.array(Cited), conflicts: z.array(Cited), notFound: z.array(z.string()) })

export function formatTranscript(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${s.id}] ${s.speaker ? `${s.speaker}: ` : ''}${s.text}`).join('\n')
}

type Content = string | Anthropic.Beta.Messages.BetaContentBlockParam[]

/**
 * One structured-output call to Claude: schema-validated JSON, explicit
 * effort, server-side refusal fallback; errors mapped to safe
 * AiProviderError codes.
 */
class AnthropicStructured {
  constructor(
    private readonly client: Anthropic,
    readonly model: string,
    private readonly effort: 'low' | 'medium' | 'high',
    private readonly maxTokens: number,
  ) {}

  async call<T extends z.ZodType>(prompt: PromptDef, schema: T, content: Content, signal?: AbortSignal): Promise<CallMeta & { output: z.infer<T> }> {
    try {
      const res = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          // Re-run declined requests on Anthropic's recommended fallback model instead of failing.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: this.effort, format: betaZodOutputFormat(schema) },
          system: prompt.text,
          messages: [{ role: 'user', content }],
        },
        signal ? { signal } : undefined,
      )
      if (res.stop_reason === 'refusal') throw new AiProviderError('refusal', 'The AI service declined this request. Continue without AI assistance.')
      if (res.stop_reason === 'max_tokens') throw new AiProviderError('truncated', 'The AI response was cut off. Try again with less input.', true)
      if (!res.parsed_output) throw new AiProviderError('invalid_output', 'The AI response could not be read. Try again.', true)
      return {
        output: res.parsed_output as z.infer<T>,
        model: res.model,
        inputTokens: res.usage.input_tokens ?? null,
        outputTokens: res.usage.output_tokens ?? null,
        requestId: (res as { _request_id?: string | null })._request_id ?? null,
      }
    } catch (e) {
      throw toProviderError(e)
    }
  }
}

export class AnthropicNoteDrafter implements NoteDrafter {
  readonly provider = 'anthropic'
  readonly promptVersion = NOTE_PROMPT.id
  constructor(private readonly s: AnthropicStructured) {}
  get model() {
    return this.s.model
  }
  async draft(segments: TranscriptSegment[]): Promise<NoteDraftResult> {
    const { output, ...meta } = await this.s.call(NOTE_PROMPT, DraftOutput, `<transcript>\n${formatTranscript(segments)}\n</transcript>\n\nDraft the note items.`)
    return { ...meta, items: output.items }
  }
}

export class AnthropicFactExtractor implements FactExtractor {
  readonly provider = 'anthropic'
  readonly promptVersion = EXTRACTION_PROMPT.id
  constructor(private readonly s: AnthropicStructured) {}
  get model() {
    return this.s.model
  }
  async extract(segments: TranscriptSegment[]): Promise<CallMeta & { facts: ExtractedFact[] }> {
    const { output, ...meta } = await this.s.call(EXTRACTION_PROMPT, ExtractionOutput, `<transcript>\n${formatTranscript(segments)}\n</transcript>\n\nExtract the facts.`)
    return { ...meta, facts: output.facts }
  }
}

export class AnthropicRecommender implements Recommender {
  readonly provider = 'anthropic'
  readonly promptVersion = RECOMMENDATION_PROMPT.id
  constructor(private readonly s: AnthropicStructured) {}
  get model() {
    return this.s.model
  }
  async recommend(input: RecommendationInput) {
    const { output, ...meta } = await this.s.call(
      RECOMMENDATION_PROMPT,
      RecommendationOutput,
      `<patient>${input.patientLine}</patient>\n<record>\n${input.recordText}\n</record>\n<transcript>\n${input.transcriptText}\n</transcript>\n\nSuggest the points to consider.`,
    )
    return { ...meta, recommendations: output.recommendations as RecommendationOut[], insufficientData: output.insufficientData, insufficientDataReason: output.insufficientDataReason }
  }
}

export class AnthropicRecordQa implements RecordQuestionAnswerer {
  readonly provider = 'anthropic'
  readonly promptVersion = MANA_QA_PROMPT.id
  constructor(private readonly s: AnthropicStructured) {}
  get model() {
    return this.s.model
  }
  async answer(input: RecordQuestionInput) {
    const { output, ...meta } = await this.s.call(MANA_QA_PROMPT, ManaOutput, `<patient>${input.patientLine}</patient>\n<record>\n${input.recordText}\n</record>\n<question>${input.question}</question>\n\nAnswer the question from the record items.`)
    return { ...meta, statements: output.statements, conflicts: output.conflicts, notFound: output.notFound }
  }
}

const IMAGE_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export class AnthropicImageDescriber implements ImageDescriber {
  readonly provider = 'anthropic'
  readonly promptVersion = IMAGE_PROMPT.id
  constructor(private readonly s: AnthropicStructured) {}
  get model() {
    return this.s.model
  }
  async describe(image: Buffer, mimeType: string, context: { imageType: string; bodySite: string | null }): Promise<CallMeta & { result: ImageDescription }> {
    if (!IMAGE_MEDIA.has(mimeType)) throw new AiProviderError('unsupported_image', 'This image format cannot be sent to the AI service.')
    const { output, ...meta } = await this.s.call(IMAGE_PROMPT, ImageOutput, [
      { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg', data: image.toString('base64') } },
      { type: 'text', text: `Image type: ${context.imageType}. Body site: ${context.bodySite ?? 'not stated'}. Describe the image.` },
    ])
    return { ...meta, result: output }
  }
}

function toProviderError(e: unknown): AiProviderError {
  if (e instanceof AiProviderError) return e
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AiProviderError('auth_failed', 'The AI service rejected the configured credentials.')
  if (e instanceof Anthropic.RateLimitError) return new AiProviderError('rate_limited', 'The AI service is busy. Try again in a minute.', true)
  if (e instanceof Anthropic.APIConnectionError) return new AiProviderError('unreachable', 'The AI service could not be reached. Check the network and try again.', true)
  if (e instanceof Anthropic.BadRequestError) return new AiProviderError('bad_request', 'The AI service rejected the request.')
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0
    return new AiProviderError(`api_${status || 'error'}`, 'The AI service returned an error. Try again.', status >= 500 || status === 0)
  }
  return new AiProviderError('invalid_output', 'The AI response could not be read. Try again.', true)
}

function client(apiKey: string, timeoutSeconds: number, baseURL?: string) {
  return new Anthropic({ apiKey, ...(baseURL && { baseURL }), timeout: timeoutSeconds * 1000, maxRetries: 2 })
}

export function createAnthropicProviders(apiKey: string, llm: AppSettings['ai']['llm'], vision: AppSettings['ai']['vision'], baseURL?: string) {
  const c = client(apiKey, llm.timeoutSeconds, baseURL)
  const text = new AnthropicStructured(c, llm.model, llm.effort, llm.maxOutputTokens)
  const img = new AnthropicStructured(c, vision.model, vision.effort, Math.min(llm.maxOutputTokens, 8000))
  // The reasoning model when the server is set to `hosted` (ai.reasoning.provider). Built here, with the others, so that it exists only if egress is
  // allowed AND a key is set; the local model being down never makes it the answer.
  const reasoner = new HostedReasoner(text.model, async (req) => {
    const r = await text.call(req.prompt, req.schema, req.user, req.signal)
    return { output: r.output, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, requestId: r.requestId }
  })
  return { drafter: new AnthropicNoteDrafter(text), extractor: new AnthropicFactExtractor(text), recommender: new AnthropicRecommender(text), describer: new AnthropicImageDescriber(img), qa: new AnthropicRecordQa(text), reasoner }
}

/** Drafter only (kept for tests that exercise the SDK path against a local HTTP stub). */
export function createAnthropicDrafter(apiKey: string, model: string, baseURL?: string): AnthropicNoteDrafter {
  return new AnthropicNoteDrafter(new AnthropicStructured(client(apiKey, 120, baseURL), model, 'medium', 16000))
}
