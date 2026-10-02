import type { z } from 'zod'
import { HttpError } from './errors.ts'

/**
 * Validates untrusted input (body, query, params) against a Zod schema.
 * Failures become a 400 with per-field issues; the input itself is never echoed.
 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {})
  if (result.success) return result.data
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  throw new HttpError(400, 'validation_error', 'Some fields are invalid', issues)
}
