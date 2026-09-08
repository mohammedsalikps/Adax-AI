import { useState } from 'react'
import { ChevronDown, FlaskConical } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import type { LabAnalyte, LabReport, LabResultFlag } from '@/types/record'

const FLAG_BADGE: Record<LabResultFlag, 'normal' | 'caution' | 'critical'> = {
  normal: 'normal',
  low: 'caution',
  high: 'critical',
}

const FLAG_WORD: Record<LabResultFlag, string> = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
}

export interface LabReportListProps {
  reports: LabReport[]
  className?: string
}

/**
 * Laboratory panels, most recent first. Each panel expands to its individual
 * results.
 *
 * Every result shows the reference range the laboratory judged it against,
 * alongside the flag the laboratory reported. Nothing here re-derives whether
 * a value is abnormal — a result and the range it was read against belong
 * together on a chart.
 */
export function LabReportList({ reports, className }: LabReportListProps) {
  if (reports.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={FlaskConical}
        title="No laboratory reports"
        description="Nothing has been recorded on this chart."
      />
    )
  }

  return (
    <ul className={cn('space-y-2', className)}>
      {reports.map((report) => (
        <LabReportRow key={report.id} report={report} />
      ))}
    </ul>
  )
}

function LabReportRow({ report }: { report: LabReport }) {
  const [open, setOpen] = useState(false)
  const abnormal = report.analytes.filter((analyte) => analyte.flag !== 'normal')

  return (
    <li className="rounded-control border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-alt"
      >
        <FlaskConical size={14} className="shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {report.panelName}
          </span>
          <span className="tnum block truncate text-[11px] text-ink-muted">
            Reported {formatDate(report.reportedOn)} · {report.laboratory}
          </span>
        </span>

        {abnormal.length > 0 ? (
          <Badge variant="critical">
            {abnormal.length} outside range
          </Badge>
        ) : (
          <Badge variant="normal">All in range</Badge>
        )}

        <ChevronDown
          size={15}
          aria-hidden
          className={cn(
            'shrink-0 text-ink-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2.5">
          <ul className="space-y-1.5">
            {report.analytes.map((analyte) => (
              <AnalyteRow key={analyte.id} analyte={analyte} />
            ))}
          </ul>

          {report.impression && (
            <p className="mt-2.5 border-t border-line pt-2 text-[12px] text-ink-soft">
              <span className="font-semibold">Laboratory comment: </span>
              {report.impression}
            </p>
          )}

          <p className="tnum mt-1.5 text-[10px] text-ink-muted">
            Sample collected {formatDate(report.collectedOn)}
          </p>
        </div>
      )}
    </li>
  )
}

function AnalyteRow({ analyte }: { analyte: LabAnalyte }) {
  const isNormal = analyte.flag === 'normal'

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="min-w-0 flex-1 text-[12px] text-ink-soft">{analyte.name}</span>

      <span
        className={cn(
          'tnum text-[13px] font-semibold',
          isNormal ? 'text-ink' : analyte.flag === 'high' ? 'text-critical' : 'text-caution',
        )}
      >
        {analyte.value}
        {analyte.unit && (
          <span className="ml-0.5 text-[10px] font-medium text-ink-muted">
            {analyte.unit}
          </span>
        )}
      </span>

      {/* The flag is a word as well as a colour. */}
      <Badge variant={FLAG_BADGE[analyte.flag]}>{FLAG_WORD[analyte.flag]}</Badge>

      <span className="tnum w-full text-[10px] text-ink-muted">
        Reference {analyte.referenceRange}
      </span>
    </li>
  )
}
