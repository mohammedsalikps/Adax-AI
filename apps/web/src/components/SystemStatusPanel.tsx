import { Database, RefreshCw, Server, Thermometer } from 'lucide-react'
import type { ReactNode } from 'react'
import { type SystemStatusState, useSystemStatus } from '../lib/useSystemStatus.ts'
import { type BadgeState, StatusBadge } from './StatusBadge.tsx'

interface Row {
  id: 'api' | 'database' | 'thermal'
  name: string
  icon: ReactNode
  state: BadgeState
  detail: string
}

const ms = (v?: number) => (v === undefined ? '' : `${v} ms`)
const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ')

function rows(s: SystemStatusState): Row[] {
  const icon = (I: typeof Server) => <I aria-hidden="true" className="size-5 text-ink-muted" />
  if (s.kind === 'loading') {
    return [
      { id: 'api', name: 'API', icon: icon(Server), state: 'checking', detail: '' },
      { id: 'database', name: 'Database', icon: icon(Database), state: 'checking', detail: '' },
      { id: 'thermal', name: 'Thermal service', icon: icon(Thermometer), state: 'checking', detail: '' },
    ]
  }
  if (s.kind === 'api-unreachable') {
    return [
      { id: 'api', name: 'API', icon: icon(Server), state: 'down', detail: `Not reachable (${s.error})` },
      { id: 'database', name: 'Database', icon: icon(Database), state: 'unknown', detail: 'Reported by the API' },
      { id: 'thermal', name: 'Thermal service', icon: icon(Thermometer), state: 'unknown', detail: 'Reported by the API' },
    ]
  }
  const { api, database: db, thermal } = s.data
  return [
    { id: 'api', name: 'API', icon: icon(Server), state: 'up', detail: `v${api.version}` },
    {
      id: 'database',
      name: 'Database',
      icon: icon(Database),
      state: db.status,
      detail:
        db.status === 'up'
          ? join(db.serverVersion && `PostgreSQL ${db.serverVersion}`, db.encoding, db.migrationsApplied !== undefined && `${db.migrationsApplied} migrations`, ms(db.latencyMs))
          : `Not reachable (${db.error ?? 'error'})`,
    },
    {
      id: 'thermal',
      name: 'Thermal service',
      icon: icon(Thermometer),
      state: thermal.status,
      detail: thermal.status === 'up' ? join(thermal.version && `v${thermal.version}`, ms(thermal.latencyMs)) : `Not reachable (${thermal.error ?? 'error'})`,
    },
  ]
}

export function SystemStatusPanel() {
  const { state, refreshing, refresh } = useSystemStatus()
  const list = rows(state)
  const allUp = list.every((r) => r.state === 'up')
  const summary = state.kind === 'loading' ? 'Checking services…' : allUp ? 'All services operational' : 'One or more services unavailable'

  return (
    <section aria-labelledby="status-heading" className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="status-heading" className="text-base font-semibold">
            System status
          </h2>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {summary}
            {state.kind !== 'loading' && ` · checked ${state.receivedAt.toLocaleTimeString()}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-canvas disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <ul className="divide-y divide-line">
        {list.map((r) => (
          <li key={r.id} data-testid={`status-${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
            {r.icon}
            <span className="min-w-36 font-medium">{r.name}</span>
            <StatusBadge state={r.state} />
            {r.detail && <span className="text-sm text-ink-muted tabular-nums">{r.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
