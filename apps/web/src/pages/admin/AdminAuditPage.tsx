import type { AuditPage } from '@adaxai/contracts'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Filter } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { Alert, Badge, Spinner } from '../../components/ui/Feedback.tsx'
import { SelectField, TextField } from '../../components/ui/Form.tsx'
import { Card, PageHeader } from '../../components/ui/Layout.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

interface Filters {
  action: string
  outcome: string
  from: string
  to: string
  patientId: string
}
const EMPTY: Filters = { action: '', outcome: '', from: '', to: '', patientId: '' }

const outcomeTone = (o: string) => (o === 'success' ? 'ok' : o === 'denied' ? 'down' : 'warn') as 'ok' | 'down' | 'warn'

export function AdminAuditPage() {
  useDocumentTitle('Audit log')
  const [draft, setDraft] = useState<Filters>(EMPTY)
  const [applied, setApplied] = useState<Filters>(EMPTY)
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit', applied],
    queryFn: ({ pageParam }) => api<AuditPage>('/admin/audit-events', { query: { ...applied, limit: 50, before: pageParam ?? undefined } }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  })
  const events = q.data?.pages.flatMap((p) => p.events) ?? []

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins, changes and patient-record access. Viewing this log is itself audited." />
      <Card className="mb-4">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault()
            setApplied(draft)
          }}
        >
          <TextField label="Action starts with" placeholder="e.g. patient." value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} className="lg:col-span-2" />
          <SelectField label="Outcome" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </SelectField>
          <TextField label="From" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField label="To" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <div className="flex items-end gap-2">
            <Button type="submit" icon={<Filter aria-hidden="true" className="size-4" />}>
              Apply
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY)
                setApplied(EMPTY)
              }}
            >
              Clear
            </Button>
          </div>
        </form>
      </Card>
      <Card bodyClassName="">
        {q.isPending && <div className="px-5"><Spinner /></div>}
        {q.isError && <Alert tone="error" className="m-5">{errorMessage(q.error)}</Alert>}
        {q.data && (
          <Table
            caption="Audit events"
            rows={events}
            rowKey={(e) => String(e.id)}
            empty={<p className="px-5 py-8 text-center text-sm text-ink-muted">No events match these filters.</p>}
            columns={[
              { key: 'when', header: 'When', cell: (e) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(e.occurredAt)}</span> },
              { key: 'who', header: 'Actor', cell: (e) => <><p>{e.actorUsername ?? '—'}</p><p className="text-xs text-ink-muted">{e.actorRole ?? ''}</p></> },
              { key: 'action', header: 'Action', cell: (e) => <span className="font-mono text-xs">{e.action}</span> },
              { key: 'outcome', header: 'Outcome', cell: (e) => <Badge tone={outcomeTone(e.outcome)}>{e.outcome}</Badge> },
              { key: 'entity', header: 'Entity', cell: (e) => (e.entityType ? <span className="text-xs"><span className="text-ink-muted">{e.entityType}</span> <span className="font-mono">{e.entityId?.slice(0, 8)}</span></span> : '—') },
              { key: 'details', header: 'Details', cell: (e) => <code className="block max-w-xs truncate text-xs text-ink-muted" title={JSON.stringify(e.details)}>{Object.keys(e.details).length ? JSON.stringify(e.details) : ''}</code> },
              { key: 'ip', header: 'IP', cell: (e) => <span className="text-xs text-ink-muted">{e.ip ?? ''}</span> },
            ]}
          />
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              Load older events
            </Button>
          </div>
        )}
      </Card>
    </>
  )
}
