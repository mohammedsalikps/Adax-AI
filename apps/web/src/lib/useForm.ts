import { useCallback, useState } from 'react'
import type { z } from 'zod'
import { issuesToErrors } from './api.ts'

/**
 * Minimal form state with Zod validation. Client-side validation mirrors the
 * API's (same schemas from @adaxai/contracts); the API validates again.
 */
export function useForm<S extends z.ZodType>(schema: S, initial: z.input<S>) {
  const [values, setValues] = useState<z.input<S>>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const set = useCallback(<K extends keyof z.input<S>>(key: K, value: z.input<S>[K]) => {
    setValues((v) => ({ ...(v as Record<string, unknown>), [key]: value }) as z.input<S>)
    setErrors((e) => {
      if (!e[key as string]) return e
      const { [key as string]: _drop, ...rest } = e
      return rest
    })
  }, [])

  /** Returns parsed output, or null after setting field errors. */
  const validate = useCallback((): z.output<S> | null => {
    const r = schema.safeParse(values)
    if (r.success) {
      setErrors({})
      return r.data
    }
    const next: Record<string, string> = {}
    for (const i of r.error.issues) {
      const k = i.path.join('.') || '_form'
      next[k] ??= i.message
    }
    setErrors(next)
    return null
  }, [schema, values])

  const applyServerErrors = useCallback((e: unknown) => setErrors(issuesToErrors(e)), [])
  const reset = useCallback((v: z.input<S> = initial) => {
    setValues(v)
    setErrors({})
  }, [initial])

  return { values, set, errors, setErrors, validate, applyServerErrors, reset }
}
