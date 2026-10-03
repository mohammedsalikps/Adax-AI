import { ApiErrorBody } from '@adaxai/contracts'

export interface FieldIssue {
  path: string
  message: string
}

const GATEWAY_STATUSES = [502, 503, 504]
const UNAVAILABLE_MESSAGE = 'The service is temporarily unavailable. Please try again in a moment.'

/** A failed API call. `code` is the API's machine-readable error, `issues` per-field validation messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: FieldIssue[] = [],
    /** The full error response body (some errors carry extra data, e.g. duplicate candidates). */
    readonly body: unknown = null,
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
    if (parsed.success) throw new ApiError(res.status, parsed.data.error, parsed.data.message ?? `Request failed (${res.status})`, parsed.data.issues, data)
    // No usable body: a proxy or gateway answered instead of the API (the API is not running, or is restarting).
    if (GATEWAY_STATUSES.includes(res.status)) throw new ApiError(res.status, 'service_unavailable', UNAVAILABLE_MESSAGE, [], data)
    throw new ApiError(res.status, 'http_error', res.status >= 500 ? 'The server reported a problem. Please try again.' : `Request failed (${res.status})`, [], data)
  }
  return data as T
}

/** Maps API validation issues to a { field: message } object for forms. */
export function issuesToErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {}
  return Object.fromEntries(e.issues.map((i) => [i.path, i.message]))
}

/** The server could not be reached or is not running (a network failure, a gateway answering for it, or the dev proxy saying so). */
export function isServiceUnavailable(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || GATEWAY_STATUSES.includes(e.status) || e.code === 'api_unavailable' || e.code === 'service_unavailable' || e.code === 'network_error')
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Something went wrong. Please try again.'
}
