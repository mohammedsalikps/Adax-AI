import { ClipboardList, FileText, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  NOT_MENTIONED,
  type ConsultationAiDraft,
  type DraftSection,
} from '@/types/consultation'

interface SectionSpec {
  key: keyof Pick<
    ConsultationAiDraft,
    'chiefComplaint' | 'historyOfPresentIllness' | 'examination'
  >
  label: string
  icon: typeof FileText
  /** Tailwind classes for the section's tinted card. */
  tone: string
}

/**
 * The three sections the reference layout surfaces inline. The remaining
 * drafted sections stay in the review drawer, where they can be accepted or
 * rejected individually.
 */
const SECTIONS: SectionSpec[] = [
  {
    key: 'chiefComplaint',
    label: 'Chief Complaint',
    icon: FileText,
    tone: 'border-accent-soft bg-accent-soft/35',
  },
  {
    key: 'historyOfPresentIllness',
    label: 'History of Present Illness',
    icon: ClipboardList,
    tone: 'border-normal-soft bg-normal-soft/40',
  },
  {
    key: 'examination',
    label: 'Examination (Suggested)',
    icon: Stethoscope,
    tone: 'border-ai-soft bg-ai-soft/50',
  },
]

/**
 * Splits a drafted section into display lines. The extractor writes one
 * sentence per finding, so sentence boundaries are the natural bullets.
 */
function toBullets(section: DraftSection): string[] {
  if (!section.text || section.text === NOT_MENTIONED) return []
  return section.text
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export interface AiDraftSummaryProps {
  draft: ConsultationAiDraft
  className?: string
}

/**
 * Read-only inline preview of the current draft.
 *
 * It shows what was extracted so the doctor can judge it at a glance; nothing
 * here writes to the consultation. Applying content stays in the review
 * drawer, where each section is accepted or rejected explicitly.
 *
 * Sections the transcript does not cover keep saying "Not mentioned in
 * transcript." rather than being hidden — an absent finding is information.
 */
export function AiDraftSummary({ draft, className }: AiDraftSummaryProps) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {SECTIONS.map(({ key, label, icon: Icon, tone }) => {
        const section = draft[key]
        const bullets = toBullets(section)

        return (
          <section
            key={key}
            aria-label={label}
            className={cn('rounded-control border px-3 py-2.5', tone)}
          >
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
              <Icon size={13} className="shrink-0 text-ink-soft" aria-hidden />
              {label}
            </h3>

            {bullets.length > 0 ? (
              <ul className="mt-1.5 space-y-1 pl-4">
                {bullets.map((bullet, index) => (
                  <li
                    key={index}
                    className="list-disc text-[12px] leading-snug text-ink-soft marker:text-ink-muted"
                  >
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[12px] text-ink-muted italic">{NOT_MENTIONED}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
