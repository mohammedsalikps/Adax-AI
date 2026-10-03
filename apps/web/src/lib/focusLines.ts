import { useSyncExternalStore } from 'react'

/**
 * Which transcript lines are being pointed at (from an important point, a suggestion or a recommendation that cites them). One small store,
 * so the transcript card and the panels that cite its lines need not know about each other.
 */
let current: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

export function focusLines(ids: string[]) {
  current = new Set(ids)
  for (const l of listeners) l()
}

/** The lines being pointed at right now. */
export const focusedLines = (): ReadonlySet<string> => current

export function useFocusedLines(): ReadonlySet<string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
