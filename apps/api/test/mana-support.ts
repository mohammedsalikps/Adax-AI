import type { ManaModelAnswer, ManaPlan, PlannedCall } from '@adaxai/contracts'
import type { z } from 'zod'
import type { ReasoningHealth, ReasoningModel, StructuredRequest, StructuredResult } from '../src/ai/llm/types.ts'
import { AiProviderError } from '../src/ai/providers.ts'

/** One fact as it was shown to the writer: "[S1] (P1) text". */
export interface ShownFact {
  ref: string
  patient: string | null
  text: string
}

export function factsIn(user: string): ShownFact[] {
  const out: ShownFact[] = []
  for (const line of user.split('\n')) {
    const m = /^\[(S\d{1,3})\] (?:\((P\d{1,2})\) )?(.*)$/.exec(line)
    if (m) out.push({ ref: m[1]!, patient: m[2] ?? null, text: m[3]!.trim() })
  }
  return out
}

export const questionIn = (user: string): string => /^QUESTION: (.*)$/m.exec(user)?.[1] ?? ''
const field = (user: string, name: string): string => new RegExp(`^${name}: (.*)$`, 'm').exec(user)?.[1] ?? ''

export const call = (tool: PlannedCall['tool'], rest: Partial<PlannedCall> = {}): PlannedCall => ({ tool, patient: null, topic: null, text: null, which: null, when: null, minutes: null, date: null, mine: null, status: null, ...rest })
export const toolsPlan = (...calls: PlannedCall[]): ManaPlan => ({ kind: 'tools', calls, clarification: null })
export const kindPlan = (kind: ManaPlan['kind'], clarification: string | null = null): ManaPlan => ({ kind, calls: [], clarification })

/** The names of the synthetic patients of the fixture (mana-fixture.ts), which a keyword planner can recognise in a question. */
const NAMES = ['Meena Iyer', 'Rahul Sharma', 'Rahul Verma', 'Rahul Mehta', 'Anita', 'Vikram', 'Priya', 'Suresh', 'Lakshmi', 'Nandini', 'Omkar', 'Geeta', 'Zara', 'Rahul', 'Meena']

/**
 * What a sensible planner writes for the questions of these tests: keywords stand in for a model. It is a test double, labelled as such: the product never
 * fakes a plan. A test that needs a different plan (a bad one, a steered one) replaces it.
 */
export function defaultPlan(user: string): ManaPlan {
  const q = questionIn(user)
  const lower = q.toLowerCase()
  const hasConsultation = field(user, 'CURRENT PATIENT').startsWith('yes')
  const focus = field(user, 'FOCUS')
  if (/^(hi|hello|thanks|thank you)\b/.test(lower)) return kindPlan('other')
  if (/\b(prescribe|sign this|delete|cancel my|book an|order a|add .* to the prescription|discharge)\b/.test(lower)) return kindPlan('write_request')
  if (/\b(usual dose|paediatric dose|guideline|what is the dose|side effects of)\b/.test(lower)) return kindPlan('general_knowledge')
  if (/\b(every patient|all patients|audit log|other clinic|other clinic’s|password)\b/.test(lower)) return kindPlan('out_of_scope')
  if (/\bwhich (patient|one)\??$/.test(lower) && !/\b(he|she)\b/.test(lower)) return kindPlan('clarify', 'Which patient do you mean?')
  const name = NAMES.find((n) => lower.includes(n.toLowerCase()))
  const alias = /\bP(\d{1,2})\b/.exec(q)?.[0]
  const patient = alias ? alias : name ? `name:${name}` : /\b(she|he|her|his|their|they)\b/.test(lower) && focus && focus !== 'none' ? focus : hasConsultation ? 'current' : null
  if (/\bwaiting|queue\b/.test(lower)) return toolsPlan(call('get_today_queue', { mine: /\bmy\b/.test(lower) ? true : false, status: /waiting/.test(lower) ? 'waiting' : null }))
  if (/\bappointments?\b/.test(lower)) return toolsPlan(call('get_appointments', { when: /tomorrow/.test(lower) ? 'tomorrow' : 'today', mine: /\bmy\b|\bi have\b/.test(lower) }))
  if (/seen today|my consultations/.test(lower)) return toolsPlan(call('get_my_consultations', { when: 'today' }))
  if (/checked in/.test(lower)) return toolsPlan(call('get_recent_visits', { when: 'minutes_ago', minutes: 120, mine: false }))
  if (/\bvisits?\b/.test(lower)) return toolsPlan(call('get_patient_visits', { patient }))
  if (/last consultation|previous consultation/.test(lower)) return toolsPlan(call('get_consultation', { patient, which: /previous/.test(lower) ? 'previous' : 'last' }))
  if (/\bfind\b|\bwho is\b/.test(lower) && name) return toolsPlan(call('find_patient', { text: name }))
  const topic = /allerg/.test(lower) ? 'allergies' : /medic|prescri/.test(lower) ? 'medicines' : /vital|blood pressure|temperature|pulse/.test(lower) ? 'vitals' : /diagnos/.test(lower) ? 'diagnoses' : /history/.test(lower) ? 'history' : /changed|change/.test(lower) ? 'changes' : /mention|chest pain/.test(lower) ? 'search' : 'briefing'
  return toolsPlan(call('get_patient_record', { patient, topic, text: topic === 'search' ? 'chest pain' : null }))
}

/** What a faithful writer produces: statements that copy the facts they cite. */
export function faithfulAnswer(facts: ShownFact[], max = 6): ManaModelAnswer {
  return { blocks: facts.slice(0, max).map((f) => ({ text: f.text, refs: [f.ref] })) }
}

/** An in-process stand-in for the local language model, for the tests of everything around it. A test double, labelled as such: the product never fakes model output. */
export class ManaStub implements ReasoningModel {
  readonly provider = 'stub-llm'
  readonly model = 'stub-model'
  /** A test sets this to false to be a model that does not run on this computer. */
  local = true
  ready = true
  reason: string | null = null
  /** Every request the model was sent, in order: what a test inspects to see what reached it. */
  calls: { kind: 'plan' | 'answer'; system: string; user: string }[] = []
  delayMs = 0
  failWith: AiProviderError | null = null
  /** What the nth plan says, from what the planner was shown; the default is `defaultPlan`. */
  plan: ((user: string, n: number) => unknown) | null = null
  /** What the nth answer says, from the facts it was shown; the default is a faithful one. */
  answer: ((facts: ShownFact[], user: string, n: number) => unknown) | null = null
  /** Runs while a request is being answered (a test changes the world under it, as a slow model lets real life do). */
  hook: ((kind: 'plan' | 'answer') => Promise<void>) | null = null
  aborted = 0

  get plans() {
    return this.calls.filter((c) => c.kind === 'plan')
  }
  get answers() {
    return this.calls.filter((c) => c.kind === 'answer')
  }

  async health(): Promise<ReasoningHealth> {
    return this.ready
      ? { state: 'ready', reason: null, model: { id: this.model, runtime: 'stub-runtime 1', weightsSha256: 'b'.repeat(64), local: this.local } }
      : { state: 'unavailable', reason: this.reason ?? 'Local AI unavailable.', model: null }
  }

  async generate<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
    const kind = req.prompt.kind === 'mana_plan' ? 'plan' : 'answer'
    this.calls.push({ kind, system: req.prompt.text, user: req.user })
    await this.hook?.(kind)
    if (this.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs)
        req.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            this.aborted++
            reject(new AiProviderError('cancelled', 'This question was stopped.', false))
          },
          { once: true },
        )
      })
    }
    if (this.failWith) throw this.failWith
    const n = this.calls.filter((c) => c.kind === kind).length
    const raw = kind === 'plan' ? (this.plan ? this.plan(req.user, n) : defaultPlan(req.user)) : this.answer ? this.answer(factsIn(req.user), req.user, n) : faithfulAnswer(factsIn(req.user))
    const parsed = req.schema.safeParse(raw)
    if (!parsed.success) throw new AiProviderError('invalid_output', 'The local model’s answer did not have the required form, so nothing was kept. You can try again.', true)
    return { output: parsed.data, model: this.model, runtime: 'stub-runtime 1', weightsSha256: 'b'.repeat(64), inputTokens: 100, outputTokens: 50, finishReason: 'stop', requestId: null }
  }
}
