export interface Issue {
  path: string
  message: string
}

/** What a refused lookup was about, for the audit log (never shown to the client). */
export interface DenialAudit {
  entityType: string
  entityId: string
  reason?: string
}

/** An error that is safe to show to the client (status, code and message). */
export class HttpError extends Error {
  /** Set on refusals that must be audited (e.g. a patient outside the caller's facility answers 404). */
  auditDenial?: DenialAudit

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly issues?: Issue[],
  ) {
    super(message)
  }
}

/** 404 for a resource the caller may not see; the refusal is recorded in the audit log. */
export function deniedNotFound(what: string, denial: DenialAudit): HttpError {
  const e = notFound(what)
  e.auditDenial = denial
  return e
}

export const badRequest = (message: string, issues?: Issue[]) => new HttpError(400, 'bad_request', message, issues)
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'unauthorized', message)
export const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, 'forbidden', message)
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`)
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message)
