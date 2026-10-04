import type { ReasoningStatus } from '@adaxai/contracts'
import type { ReasoningModel } from './types.ts'

/** What the screens say when there is no local model to ask. Never a placeholder draft. */
export const LOCAL_AI_UNAVAILABLE = 'Local AI unavailable.'

export interface ReasoningSetup {
  /** What the server is set to use: a local model, a hosted one (only behind the egress policy), or none. */
  mode: 'local' | 'hosted' | 'none'
  model: ReasoningModel | null
  /** Why there is no model (switched off, egress off, no key, a bad address), shown instead of any placeholder output. */
  reason: string | null
}

/** The model's state as its server says it just now (a short, cached health check), never a guess from configuration alone. */
export async function reasoningStatus(s: ReasoningSetup, opts: { fresh?: boolean } = {}): Promise<ReasoningStatus> {
  if (!s.model) return { available: false, mode: s.mode, provider: null, model: null, state: 'not_configured', local: s.mode !== 'hosted', runtime: null, weightsSha256: null, reason: s.reason ?? LOCAL_AI_UNAVAILABLE }
  const h = await s.model.health(opts)
  return {
    available: h.state === 'ready',
    mode: s.mode,
    provider: s.model.provider,
    model: h.model?.id ?? s.model.model,
    state: h.state,
    local: s.model.local,
    runtime: h.model?.runtime ?? null,
    weightsSha256: h.model?.weightsSha256 ?? null,
    reason: h.state === 'ready' ? null : (h.reason ?? LOCAL_AI_UNAVAILABLE),
  }
}
