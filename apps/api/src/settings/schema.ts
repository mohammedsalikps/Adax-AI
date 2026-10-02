import { VitalKind } from '@adaxai/contracts'
import { z } from 'zod'

const mime = z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/, 'must be a MIME type')

/** config/adaxai.yaml. Strict: unknown keys are errors (catches typos). */
export const AppSettings = z
  .object({
    version: z.literal(1),
    ai: z
      .object({
        features: z
          .object({ noteDraft: z.boolean(), extraction: z.boolean(), recommendations: z.boolean(), imageAnalysis: z.boolean(), liveTranscription: z.boolean() })
          .strict(),
        llm: z
          .object({
            provider: z.literal('anthropic'),
            model: z.string().min(1),
            effort: z.enum(['low', 'medium', 'high']),
            maxOutputTokens: z.number().int().min(1000).max(64000),
            timeoutSeconds: z.number().int().min(10).max(600),
          })
          .strict(),
        vision: z.object({ provider: z.literal('anthropic'), model: z.string().min(1), effort: z.enum(['low', 'medium', 'high']) }).strict(),
        stt: z
          .object({ provider: z.string().min(1), baseUrl: z.url(), model: z.string().min(1), liveChunkSeconds: z.number().int().min(5).max(120) })
          .strict(),
        context: z.object({ priorEncounters: z.number().int().min(0).max(20), observationDays: z.number().int().min(1).max(365) }).strict(),
      })
      .strict(),
    uploads: z
      .object({
        audio: z.object({ maxMb: z.number().min(1).max(200), types: z.array(mime).min(1) }).strict(),
        images: z.object({ maxMb: z.number().min(1).max(100), types: z.array(z.enum(['image/jpeg', 'image/png', 'image/webp'])).min(1), maxPixels: z.number().int().min(1_000_000).max(200_000_000), previewMaxSide: z.number().int().min(256).max(8192) }).strict(),
      })
      .strict(),
    retention: z.object({ consultationAudioDays: z.number().int().min(0).max(3650) }).strict(),
    safety: z
      .object({
        allergyGroups: z.record(z.string().min(2), z.array(z.string().min(2)).min(1)),
        vitalTolerance: z.record(VitalKind, z.number().positive()),
      })
      .strict(),
  })
  .strict()
export type AppSettings = z.infer<typeof AppSettings>

const phrase = z.string().trim().min(2).max(80)

/** config/routing.yaml. */
export const RoutingRules = z
  .object({
    version: z.string().regex(/^[a-z0-9.-]{3,60}$/, 'lowercase letters, digits, dots and dashes'),
    departments: z
      .array(
        z
          .object({
            id: z.string().min(1),
            when: z.object({ ageBelow: z.number().int().min(1).max(130).optional(), ageAtLeast: z.number().int().min(0).max(130).optional(), complaintAny: z.array(phrase).min(1).optional() }).strict(),
            department: z.string().min(1).max(20),
            reason: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .refine((rules) => Object.keys(rules.at(-1)!.when).length === 0, 'the last department rule must have an empty `when` (the default)'),
    redFlags: z.array(z.object({ id: z.string().min(1), phrases: z.array(phrase).min(1), instruction: z.string().min(1).max(300) }).strict()),
    criticalVitalsInstruction: z.string().min(1).max(300),
    urgentWhenRedFlag: z.boolean(),
    requiredIntake: z.object({ reasonForVisit: z.boolean(), vitals: z.array(VitalKind), phone: z.boolean() }).strict(),
    clinician: z.enum(['least-busy', 'none']),
  })
  .strict()
export type RoutingRules = z.infer<typeof RoutingRules>
