import { useState } from 'react'
import { ChevronDown, ScanLine } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { MODALITY_LABEL, type StudyReport } from '@/types/record'

export interface StudyReportListProps {
  reports: StudyReport[]
  className?: string
}

/**
 * Imaging and diagnostic studies, most recent first, expanding to the
 * reporting clinician's findings and impression.
 *
 * Only the written report is held. No images or traces are stored anywhere in
 * this application, so none are shown — a placeholder film or ECG strip would
 * suggest the record contains something it does not.
 */
export function StudyReportList({ reports, className }: StudyReportListProps) {
  if (reports.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={ScanLine}
        title="No imaging or diagnostic reports"
        description="Nothing has been recorded on this chart."
      />
    )
  }

  return (
    <ul className={cn('space-y-2', className)}>
      {reports.map((report) => (
        <StudyReportRow key={report.id} report={report} />
      ))}
    </ul>
  )
}

function StudyReportRow({ report }: { report: StudyReport }) {
  const [open, setOpen] = useState(false)

  return (
    <li className="rounded-control border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-alt"
      >
        <ScanLine size={14} className="shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {report.studyName}
          </span>
          <span className="tnum block truncate text-[11px] text-ink-muted">
            {MODALITY_LABEL[report.modality]} · {formatDate(report.performedOn)} ·{' '}
            {report.facility}
          </span>
        </span>

        {report.abnormal ? (
          <Badge variant="caution">Reported abnormal</Badge>
        ) : (
          <Badge variant="normal">Normal</Badge>
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
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          <div>
            <h4 className="text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
              Findings
            </h4>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">
              {report.findings}
            </p>
          </div>
          <div>
            <h4 className="text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
              Impression
            </h4>
            <p className="mt-0.5 text-[12px] leading-snug font-medium text-ink">
              {report.impression}
            </p>
          </div>
          <p className="text-[10px] text-ink-muted">
            Report text only — no image is stored in this demonstration.
          </p>
        </div>
      )}
    </li>
  )
}
