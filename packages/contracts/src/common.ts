import { z } from 'zod'

export const Uuid = z.uuid()

/** Trimmed, non-empty text with an upper bound (protects against oversized input). */
export const Text = (max: number) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`)
export const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
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
export const IsoDate = z.iso.date()
