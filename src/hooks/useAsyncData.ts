import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  loading: boolean
  error: string | undefined
}

interface Settled<T> {
  requestKey: string
  data?: T
  error?: string
}

/**
 * Runs an async loader and tracks loading and error state.
 *
 * `key` identifies the request — change it to refetch. Results are tagged
 * with the request that produced them, so a superseded response is ignored
 * and "loading" is derived rather than set from inside the effect.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  key: string,
): AsyncState<T> & { reload: () => void } {
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const requestKey = `${key}#${nonce}`

  // Kept in a ref so an inline loader does not retrigger the effect. Written
  // after commit rather than during render; the ref starts at the first
  // loader, and this effect is declared first so it updates before the fetch.
  const loaderRef = useRef(loader)
  useEffect(() => {
    loaderRef.current = loader
  })

  useEffect(() => {
    let cancelled = false

    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setSettled({ requestKey, data })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const error = cause instanceof Error ? cause.message : 'Unable to load data.'
        setSettled({ requestKey, error })
      })

    return () => {
      cancelled = true
    }
  }, [requestKey])

  const reload = useCallback(() => {
    setNonce((current) => current + 1)
  }, [])

  const current = settled?.requestKey === requestKey ? settled : null

  return {
    data: current?.data,
    error: current?.error,
    loading: current === null,
    reload,
  }
}
