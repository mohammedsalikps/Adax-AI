import { ApiErrorBody } from '@adaxai/contracts'

export interface FieldIssue {
  path: string
  message: string
}

/** A failed API call. `code` is the API's machine-readable error, `issues` per-field validation messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: FieldIssue[] = [],
  ) {
    super(message)
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  signal?: AbortSignal
}

/**
 * Calls the API under /api. Sends the CSRF header on state-changing requests
 * and the session cookie automatically (same origin). Throws ApiError on failure.
 */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { accept: 'application/json' }
  if (method !== 'GET') headers['x-adaxai-csrf'] = '1'
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const qs = opts.query
    ? new URLSearchParams(Object.entries(opts.query).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== null && e[1] !== '').map(([k, v]) => [k, String(v)])).toString()
    : ''
  let res: Response
  try {
    res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and try again.')
  }
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const parsed = ApiErrorBody.safeParse(data)
    if (parsed.success) throw new ApiError(res.status, parsed.data.error, parsed.data.message ?? `Request failed (${res.status})`, parsed.data.issues)
    throw new ApiError(res.status, 'http_error', `Request failed (${res.status})`)
  }
  return data as T
}

/** Maps API validation issues to a { field: message } object for forms. */
export function issuesToErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {}
  return Object.fromEntries(e.issues.map((i) => [i.path, i.message]))
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Something went wrong. Please try again.'
}
