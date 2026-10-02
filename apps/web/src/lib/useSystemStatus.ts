import { SystemStatusResponse } from '@adaxai/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

export type SystemStatusState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: SystemStatusResponse; receivedAt: Date }
  | { kind: 'api-unreachable'; error: string; receivedAt: Date }

const POLL_MS = 10_000

/** Polls GET /api/system/status. The response is validated against the shared contract. */
export function useSystemStatus() {
  const [state, setState] = useState<SystemStatusState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inFlight.current?.abort()
    const ctrl = new AbortController()
    inFlight.current = ctrl
    setRefreshing(true)
    try {
      const res = await fetch('/api/system/status', { signal: ctrl.signal, headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = SystemStatusResponse.safeParse(await res.json())
      if (!parsed.success) throw new Error('Unexpected response format')
      setState({ kind: 'ok', data: parsed.data, receivedAt: new Date() })
    } catch (e) {
      if (ctrl.signal.aborted) return
      setState({ kind: 'api-unreachable', error: (e as Error).message, receivedAt: new Date() })
    } finally {
      if (inFlight.current === ctrl) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), POLL_MS)
    return () => {
      clearInterval(id)
      inFlight.current?.abort()
    }
  }, [load])

  return { state, refreshing, refresh: load }
}
