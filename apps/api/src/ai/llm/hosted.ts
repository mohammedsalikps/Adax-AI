import type { z } from 'zod'
import type { ReasoningHealth, ReasoningModel, StructuredRequest, StructuredResult } from './types.ts'

/**
 * The structured call the hosted provider's client makes (anthropic.ts: one call, schema-validated JSON, errors mapped to safe messages). It is
 * given here as a function type so that this module does not depend on the SDK, and so that the only place a hosted client is built stays
 * `providersFromConfig` (behind the egress policy).
 */
export type HostedCall = <T extends z.ZodType>(req: StructuredRequest<T>) => Promise<{ output: z.infer<T>; model: string; inputTokens: number | null; outputTokens: number | null; requestId: string | null }>

/**
 * A hosted model as a reasoning model. It exists only if hosted AI egress is allowed on purpose AND a key is set, and it is used only when the
 * server is configured for it (`ai.reasoning.provider: hosted`): a local model that is down is never replaced by it.
 */
export class HostedReasoner implements ReasoningModel {
  readonly provider = 'anthropic'
  readonly local = false

  constructor(
    readonly model: string,
    private readonly call: HostedCall,
  ) {}

  async health(_opts: { fresh?: boolean } = {}): Promise<ReasoningHealth> {
    // The hosted service has no cheap health check, and a probe would itself be a request that leaves this computer: it is "ready" while it exists.
    return { state: 'ready', reason: null, model: { id: this.model, runtime: null, weightsSha256: null, local: false } }
  }

  async generate<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
    const r = await this.call(req)
    return { output: r.output, model: r.model, runtime: null, weightsSha256: null, inputTokens: r.inputTokens, outputTokens: r.outputTokens, finishReason: null, requestId: r.requestId }
  }
}
