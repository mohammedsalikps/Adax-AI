export interface Issue {
  path: string
  message: string
}

/** An error that is safe to show to the client (status, code and message). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly issues?: Issue[],
  ) {
    super(message)
  }
}

export const badRequest = (message: string, issues?: Issue[]) => new HttpError(400, 'bad_request', message, issues)
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'unauthorized', message)
export const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, 'forbidden', message)
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`)
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message)
