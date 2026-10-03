import type { QueryClient } from '@tanstack/react-query'
import { ME_KEY } from './session.ts'

/**
 * Re-checks who is signed in when the window is looked at again in the ways
 * TanStack's own focus handling misses. Its default is the browser's
 * `visibilitychange` (a tab brought forward), which still applies to every
 * query. Switching between two windows that are both visible fires only
 * `focus`, and a page restored from the back/forward cache fires only
 * `pageshow` (with `persisted`). Those two check the session and nothing else:
 * refetching every page's data on every window focus (a closed file chooser,
 * a print dialog) would multiply requests and audited reads for no gain. If the
 * person changed, the page is rebuilt and fetches its own data.
 */
export function watchSessionOnFocus(qc: QueryClient): () => void {
  if (typeof window === 'undefined') return () => undefined
  const check = () => void qc.refetchQueries({ queryKey: ME_KEY }, { cancelRefetch: false })
  const restored = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) check()
  }
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', restored)
  return () => {
    window.removeEventListener('focus', check)
    window.removeEventListener('pageshow', restored)
  }
}
