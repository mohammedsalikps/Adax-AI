import { z } from 'zod'

export const Uuid = z.uuid()

/** PostgreSQL cannot store a NUL character in text: it is refused here, with a message, instead of failing in the database. */
export const noNul = (v: string) => !v.includes('\u0000')
export const NUL_MESSAGE = 'Contains a character that cannot be stored'

/** Trimmed, non-empty text with an upper bound (protects against oversized input). */
export const Text = (max: number) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`).refine(noNul, NUL_MESSAGE)
export const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine(noNul, NUL_MESSAGE)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()

/** Error body returned by the API for every non-2xx response. */
export const ApiErrorBody = z.object({
  error: z.string(),
  message: z.string().optional(),
  requestId: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBody>

export const IsoDateTime = z.iso.datetime({ offset: true })
/** Calendar date, YYYY-MM-DD. */
/** A real calendar date from 1900 on (the format check alone accepts year 0000, which the database refuses). */
export const IsoDate = z.iso.date().refine((d) => d >= '1900-01-01', 'Enter a date from 1900 onwards')

/**
 * Where a record comes from: `synthetic` (made up for development and demonstration) or `clinical` (a real deployment).
 * Never presented as the other.
 */
export const RecordOrigin = z.enum(['synthetic', 'clinical'])
export type RecordOrigin = z.infer<typeof RecordOrigin>
