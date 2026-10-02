import { AUDIT_CHAIN_LIMITS, type AuditChainReport, AuditChainQuery, type AuditPage } from '@adaxai/contracts'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { Copy, Filter, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { Alert, Badge, Spinner } from '../../components/ui/Feedback.tsx'
import { SelectField, TextField } from '../../components/ui/Form.tsx'
import { Card, DescriptionList, PageHeader } from '../../components/ui/Layout.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
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

const CHAIN_STATUS: Record<AuditChainReport['status'], { label: string; tone: 'ok' | 'down' | 'warn' | 'neutral' }> = {
  valid: { label: 'Chain intact', tone: 'ok' },
  invalid: { label: 'Chain broken', tone: 'down' },
  unsupported_version: { label: 'Unsupported chain version', tone: 'warn' },
  unverifiable: { label: 'Cannot be checked', tone: 'neutral' },
}

/**
 * Recomputes every link of the audit log's hash chain on request, shows the
 * real result, and the current head to record outside the system; a head
 * recorded earlier can be compared to detect removal of the newest events.
 */
function AuditIntegrityCard() {
  const toast = useToast()
  const [anchor, setAnchor] = useState({ seq: '', hash: '' })
  const [anchorErrors, setAnchorErrors] = useState<{ seq?: string; hash?: string }>({})
  const check = useMutation({
    mutationFn: (a?: { anchorSeq: number; anchorHash: string }) => api<AuditChainReport>('/admin/audit-integrity', { query: a ? { anchorSeq: a.anchorSeq, anchorHash: a.anchorHash } : {} }),
  })
  const r = check.data
  const compare = () => {
    // A copied head ("seq:hash") can be pasted into the hash field as it is.
    const pasted = /^\s*(\d+):([0-9a-fA-F]{64})\s*$/.exec(anchor.hash)
    const seq = pasted ? pasted[1]! : anchor.seq.trim()
    const hash = (pasted ? pasted[2]! : anchor.hash.trim()).toLowerCase()
    if (pasted) setAnchor({ seq, hash })
    const parsed = AuditChainQuery.safeParse({ anchorSeq: seq || undefined, anchorHash: hash || undefined })
    const errors: { seq?: string; hash?: string } = {}
    // Field issues go to their field; the "give both" rule is covered by the checks below, on the empty field.
    if (!parsed.success) for (const i of parsed.error.issues) if (i.path[0] === 'anchorSeq' || i.path[0] === 'anchorHash') errors[i.path[0] === 'anchorSeq' ? 'seq' : 'hash'] ??= i.message
    if (!seq) errors.seq ??= 'Give the event number'
    if (!hash) errors.hash ??= 'Give the hash'
    setAnchorErrors(errors)
    if (!parsed.success || parsed.data.anchorSeq === undefined || !parsed.data.anchorHash || errors.seq || errors.hash) return
    check.mutate({ anchorSeq: parsed.data.anchorSeq, anchorHash: parsed.data.anchorHash })
  }
  return (
    <Card
      title="Audit log integrity"
      className="mb-4"
      actions={
        <Button size="sm" variant="secondary" icon={<ShieldCheck aria-hidden="true" className="size-4" />} loading={check.isPending} onClick={() => check.mutate(undefined)}>
          {r ? 'Check again' : 'Check the chain'}
        </Button>
      }
    >
      {!r && !check.isError && <p className="text-sm text-ink-muted">Each new event is linked to the one before it by a SHA-256 hash. The check recomputes every link from the stored events.</p>}
      {check.isError && <Alert tone="error">{errorMessage(check.error)}</Alert>}
      <p role="status" className="sr-only">
        {r ? `Audit log check: ${CHAIN_STATUS[r.status].label}.${r.anchor ? ` Recorded head ${r.anchor.result === 'match' ? 'matches' : r.anchor.result === 'missing' ? 'is no longer in the log' : 'does not match'}.` : ''}` : ''}
      </p>
      {r && (
        <div className="space-y-4 text-sm" data-testid="audit-chain-result">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={CHAIN_STATUS[r.status].tone}>{CHAIN_STATUS[r.status].label}</Badge>
            <span className="text-xs text-ink-muted">Checked {fmtDateTime(r.checkedAt)}</span>
          </p>
          <DescriptionList
            items={[
              ['Events in the log', r.events.total],
              ['Linked in the chain', r.events.chained],
              ['From before the chain', r.chainStart ? `${r.events.beforeChain} (${r.chainStart.legacyDigestMatches ? 'unchanged since the chain began' : 'changed since the chain began'})` : r.events.beforeChain],
              ['Chain began', r.chainStart ? fmtDateTime(r.chainStart.occurredAt) : 'No start record (a new or reset log)'],
            ]}
          />
          {r.anchor && (
            <p>
              Recorded head {r.anchor.seq}: <strong>{r.anchor.result === 'match' ? 'matches' : r.anchor.result === 'missing' ? 'no longer in the log' : 'does not match'}</strong>
            </p>
          )}
          {r.problemCount > 0 && (
            <Alert tone="error" title={`${r.problemCount} problem${r.problemCount === 1 ? '' : 's'} found`}>
              <ul className="list-disc pl-4">
                {r.problems.map((p, i) => (
                  <li key={i}>{p.detail}</li>
                ))}
              </ul>
              {r.problemCount > r.problems.length && <p>Only the first {r.problems.length} are listed.</p>}
            </Alert>
          )}
          {r.head && (
            <div>
              <p className="font-medium">Current head (event {r.head.seq})</p>
              <p className="font-mono text-xs break-all">{r.head.hash}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy aria-hidden="true" className="size-4" />}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(`${r.head!.seq}:${r.head!.hash}`)
                      .then(() => toast('success', 'Head copied'))
                      .catch(() => toast('error', 'Could not copy; select the text instead'))
                  }
                >
                  Copy head
                </Button>
                <span className="text-xs text-ink-muted">Keep it outside this system (for example in the facility’s paper log) to compare later.</span>
              </div>
            </div>
          )}
          <p className="text-xs text-ink-muted">{AUDIT_CHAIN_LIMITS}</p>
        </div>
      )}
      <form
        className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          compare()
        }}
      >
        <TextField label="Recorded event number" inputMode="numeric" value={anchor.seq} onChange={(e) => setAnchor({ ...anchor, seq: e.target.value })} error={anchorErrors.seq} />
        <TextField label="Recorded hash" hint="Or paste the copied head (event:hash)." spellCheck={false} autoComplete="off" value={anchor.hash} onChange={(e) => setAnchor({ ...anchor, hash: e.target.value })} error={anchorErrors.hash} className="min-w-0" />
        <Button type="submit" variant="secondary" loading={check.isPending}>
          Compare
        </Button>
      </form>
    </Card>
  )
}

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
      <AuditIntegrityCard />
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
