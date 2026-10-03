import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FactCategory } from '@adaxai/contracts'
import { z } from 'zod'

/**
 * The synthetic consultation set (data/eval/consultations-v1): scripted fictional dialogues with hand-labelled important points.
 * See its README for provenance and limits. One author, one pass of labels: these numbers describe how the rules do on these scripts,
 * not how they would do in a clinic.
 */
export const Gold = z.object({
  category: FactCategory,
  /** 0-based index into `turns`. */
  turn: z.number().int().min(0),
  /** A lower-case phrase that occurs literally in that turn. */
  key: z.string().min(1),
  negated: z.boolean().default(false),
  uncertain: z.boolean().default(false),
})
export type Gold = z.infer<typeof Gold>

export const Consultation = z.object({
  id: z.string(),
  split: z.enum(['dev', 'test']),
  synthetic: z.literal(true),
  language: z.string(),
  audio: z.boolean(),
  supported: z.boolean().default(true),
  scenario: z.string(),
  turns: z.array(z.object({ speaker: z.enum(['Doctor', 'Patient']), text: z.string().min(1) })).min(2),
  gold: z.array(Gold),
  notes: z.string().default(''),
})
export type Consultation = z.infer<typeof Consultation>

export const DATASET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'data', 'eval', 'consultations-v1')

export function loadDataset(dir = DATASET_DIR): Consultation[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^[chx]\d+\.json$/.test(f))
    .sort()
    .map((f) => Consultation.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))))
}
