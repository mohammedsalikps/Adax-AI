import type { Application } from '@adaxai/contracts'
import { ApiError, isServiceUnavailable } from './api.ts'
import { APPLICATION_ENTRIES } from './applications.ts'

export type SignInProblem =
  | 'invalid_credentials'
  | 'locked'
  | 'rate_limited'
  | 'wrong_application'
  | 'forbidden'
  | 'unavailable'
  | 'network'
  | 'server'
  | 'unexpected'

/** What to say when signing out did not reach the server: the person is still signed in. */
export function signOutProblem(e: unknown): string {
  return isServiceUnavailable(e) ? 'Signing out did not reach the server, so you are still signed in. Please try again.' : 'Signing out did not work, so you are still signed in. Please try again.'
}

export interface SignInErrorView {
  problem: SignInProblem
  title: string
  message: string
  /** Trying again straight away can help (the problem is the service, not the person's entries). */
  retry: boolean
}

/**
 * What a failed sign-in says, in words that help and reveal nothing extra.
 * A wrong username, a wrong password, a switched-off account and a withdrawn
 * portal consent all come back from the API as the same 401, on purpose (so
 * the answer cannot be used to find out which usernames exist); this keeps it
 * that way and only adds a generic pointer to an administrator.
 */
export function describeSignInError(e: unknown, application: Application): SignInErrorView {
  const entry = APPLICATION_ENTRIES[application]
  if (e instanceof ApiError) {
    if (e.code === 'network_error' || e.status === 0) return { problem: 'network', title: 'Cannot reach the sign-in service', message: 'Check your connection, then try again.', retry: true }
    if (isServiceUnavailable(e)) return { problem: 'unavailable', title: 'Sign-in is temporarily unavailable', message: 'The sign-in service is not responding. Please try again in a moment.', retry: true }
    if (e.status === 401) {
      const who = application === 'patient' ? 'MRN' : 'username'
      return { problem: 'invalid_credentials', title: 'Could not sign in', message: `Invalid ${who} or password. Check your details and try again. If your account was switched off, contact an administrator.`, retry: false }
    }
    if (e.status === 423) return { problem: 'locked', title: 'This account is temporarily locked', message: e.message, retry: false }
    if (e.status === 429) return { problem: 'rate_limited', title: 'Too many attempts', message: e.message, retry: false }
    if (e.code === 'wrong_application') return { problem: 'wrong_application', title: `This account cannot use the ${entry.label}`, message: 'It belongs to a different application. Choose the application for your role and sign in there.', retry: false }
    if (e.status === 403) return { problem: 'forbidden', title: 'Access not permitted', message: 'This account is not permitted to sign in here.', retry: false }
    if (e.status >= 500) return { problem: 'server', title: 'Something went wrong on our side', message: 'Please try again. If it keeps happening, contact an administrator.', retry: true }
  }
  return { problem: 'unexpected', title: 'Could not sign in', message: 'Something unexpected happened. Please try again.', retry: true }
}
