import { fmtDate } from '../../lib/format.ts'
import { sinceLabel, usePatientHistory } from '../../lib/history.ts'
import { Badge, ErrorState, LoadingState } from '../ui/Feedback.tsx'

/**
 * A summary of the record, composed from its entries by fixed rules: it is not
 * AI-generated, and it says what it is based on. (An AI summary of the
 * consultation is a separate, drafted-and-reviewed feature.)
 */
export function RecordSummary({ patientId, testId = 'record-summary' }: { patientId: string; testId?: string }) {
  const q = usePatientHistory(patientId)
  const h = q.data
  if (q.isPending) return <LoadingState rows={2} label="Loading the record summary…" />
  if (!h) return <ErrorState title="The record summary could not be loaded" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
  const open = h.conditions.filter((c) => c.status !== 'resolved')
  const current = h.medications.filter((m) => m.status === 'current')
  const last = h.consultations[0]
  // The newest result of each test (the list is newest first): an old abnormal value is not today's picture of a test that has since been normal.
  const seen = new Set<string>()
  const latest = h.investigations.filter((r) => {
    const key = r.testName.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const abnormalAll = latest.filter((r) => r.flag === 'high' || r.flag === 'low' || r.flag === 'abnormal')
  const uncomparedAll = latest.filter((r) => r.flag === 'unknown')
  const abnormal = abnormalAll.slice(0, 3)
  const uncompared = uncomparedAll.slice(0, 3)
  const describe = (r: (typeof latest)[number]) => `${r.testName} ${r.valueText}${r.unit ? ` ${r.unit}` : ''} (${fmtDate(r.collectedOn)})`
  return (
    <section aria-label="Record summary" className="rounded-xl border border-line bg-canvas p-4 text-sm" data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Summary of the record</h3>
        <Badge>From the record, not AI-generated</Badge>
      </div>
      <ul className="space-y-1.5">
        <li>
          <span className="font-medium">Known conditions:</span> {open.length ? open.map((c) => `${c.name} (${sinceLabel(c.sinceYear, c.sinceMonth).replace('Since', 'since')})`).join('; ') : 'none recorded'}
        </li>
        <li>
          <span className="font-medium">Allergies:</span> {h.allergies.length ? h.allergies.map((a) => `${a.substance}${a.severity !== 'unknown' ? ` (${a.severity})` : ''}`).join('; ') : h.noKnownAllergies ? 'none known' : 'not recorded'}
        </li>
        <li>
          <span className="font-medium">Current medicines:</span> {current.length ? current.map((m) => [m.drugName, m.strength].filter(Boolean).join(' ')).join('; ') : 'none recorded'}
        </li>
        {abnormal.length > 0 && (
          <li>
            <span className="font-medium">Results outside range:</span> {abnormal.map(describe).join('; ')}
            {abnormalAll.length > abnormal.length ? ` (+${abnormalAll.length - abnormal.length} more)` : ''}
          </li>
        )}
        {uncompared.length > 0 && (
          <li>
            <span className="font-medium">Results not compared with a range:</span> {uncompared.map(describe).join('; ')}
            {uncomparedAll.length > uncompared.length ? ` (+${uncomparedAll.length - uncompared.length} more)` : ''}
          </li>
        )}
        <li>
          <span className="font-medium">Last consultation:</span> {last ? `${fmtDate(last.date)}${last.doctorName ? `, ${last.doctorName.replace(/\s*\(synthetic\)$/i, '')}` : ''}: ${last.chiefComplaint || 'no reason recorded'}` : 'none signed yet'}
          {h.consultations.length + h.more.consultations > 1 ? ` (${h.consultations.length + h.more.consultations} signed in all)` : ''}
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-muted">
        Based on entries typed in by staff and signed consultations as of {new Date(h.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Doctors add and correct entries; nothing is deleted.
      </p>
    </section>
  )
}
