import type { Application } from '@adaxai/contracts'

/**
 * Remembers, in memory only, how the last session ended while the person was
 * using the app, so that the routing guard can send them to the right place
 * with the right words:
 * - the session was ended under them (expired, signed out elsewhere, account
 *   switched off): their application's sign-in page, with a notice;
 * - they signed out themselves: the application selector, with no notice.
 * Nothing about the person is kept, only which of the two it was and which
 * application they were in; it is forgotten after a few seconds, when anyone
 * signs in, and by a reload. Reading it does not consume it (a component may
 * render more than once); it simply goes stale.
 */
type Exit = { kind: 'ended'; application: Application } | { kind: 'signed_out' } | { kind: 'portal_withdrawn' }

let last: { exit: Exit; at: number } | null = null
const FRESH_MS = 5_000

export const markSessionEnded = (application: Application) => {
  last = { exit: { kind: 'ended', application }, at: Date.now() }
}

export const markSignedOut = () => {
  last = { exit: { kind: 'signed_out' }, at: Date.now() }
}

/** The patient withdrew portal access and was signed out by the server. */
export const markPortalWithdrawn = () => {
  last = { exit: { kind: 'portal_withdrawn' }, at: Date.now() }
}

/** How the session just ended (nothing if it was a while ago, or never). */
export function recentSessionExit(): Exit | null {
  return last && Date.now() - last.at < FRESH_MS ? last.exit : null
}

export const clearSessionExit = () => {
  last = null
}
