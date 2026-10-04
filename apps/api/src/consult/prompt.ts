import { z } from 'zod'
import { neutralise } from '../ai/llm/neutralise.ts'
import { CONSULT_DRAFT_PROMPT } from '../ai/prompts.ts'
import type { SourceItem } from './inputs.ts'

/**
 * The consultation-draft prompt, its answer schema and the way the sources are shown to the model. The prompt text is registered and hashed with
 * every run (ai_prompt_versions): changing a word means a new id. The schema is the contract the local runtime is constrained to; the checks in
 * validate.ts do not trust it for anything beyond its shape.
 */

export const CONSULT_PROMPT_ID = CONSULT_DRAFT_PROMPT.id
export const CONSULT_SCHEMA_VERSION = CONSULT_DRAFT_PROMPT.schemaVersion

export const CONSULT_PROMPT = CONSULT_DRAFT_PROMPT

const Refs = z.array(z.string().max(12)).max(8)

/** A statement about the record: what the record says, what it lacks, or where it is unclear. */
export const FactStatement = z.object({
  // A little longer than what is shown (validate.ts cuts at a sentence or a word), so the runtime never cuts a word in half.
  text: z.string().min(1).max(600),
  refs: Refs,
  basis: z.enum(['stated', 'inferred', 'not_found']),
  uncertainty: z.string().max(300).nullable(),
})
/** A thing for the doctor to weigh: never an order, never a dose. */
export const SuggestionStatement = z.object({
  text: z.string().min(1).max(600),
  refs: Refs,
  rationale: z.string().min(1).max(400),
  uncertainty: z.string().max(300).nullable(),
})

/** Property order is generation order: the details first, the summary last, so the summary is written from what was already listed and cited. */
export const ConsultOutput = z.object({
  insufficient_information: z.boolean(),
  presenting_problem: z.array(FactStatement).max(2),
  symptoms: z.array(FactStatement).max(8),
  observations: z.array(FactStatement).max(8),
  relevant_history: z.array(FactStatement).max(8),
  allergies: z.array(FactStatement).max(5),
  medications: z.array(FactStatement).max(8),
  potential_considerations: z.array(SuggestionStatement).max(5),
  potential_investigations: z.array(SuggestionStatement).max(5),
  potential_medication_considerations: z.array(SuggestionStatement).max(4),
  missing_information: z.array(FactStatement).max(8),
  uncertainties: z.array(FactStatement).max(5),
  summary: FactStatement.nullable(),
})
export type ConsultOutput = z.infer<typeof ConsultOutput>
export type FactStatement = z.infer<typeof FactStatement>
export type SuggestionStatement = z.infer<typeof SuggestionStatement>

/** One source as the model sees it: one line, brackets turned into parentheses so a source cannot forge another source's id. */
export function sourceLine(i: Pick<SourceItem, 'ref' | 'date' | 'field' | 'status' | 'provenance' | 'text'>): string {
  const clean = neutralise
  return `[${i.ref}] ${i.date ? i.date.slice(0, 10) : 'undated'} | ${clean(i.field)} | ${clean(i.status)} | ${clean(i.provenance)}: ${clean(i.text)}`
}

export interface PromptInputs {
  patientLine: string
  today: string
  items: SourceItem[]
}

/** The user message: who, when, the sources, the task. The task comes after the sources so that nothing in a source is the last word. */
export function renderUserMessage(p: PromptInputs): string {
  return `PATIENT: ${p.patientLine}\nTODAY: ${p.today}\n\nSOURCES\n${p.items.map(sourceLine).join('\n')}\n\nWrite the draft for the doctor, from the SOURCES only.`
}
