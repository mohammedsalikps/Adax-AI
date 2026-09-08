import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface AiNoticeProps {
  children: React.ReactNode
  className?: string
}

/**
 * Safety label for machine-generated content.
 *
 * Deliberately not a Badge. Badge is whitespace-nowrap, which is right for a
 * short status chip and wrong for a sentence: inside a narrow panel the text
 * ran past the edge and was clipped by the panel's overflow, silently
 * truncating a safety label on a phone. This wraps instead.
 */
export function AiNotice({ children, className }: AiNoticeProps) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 rounded-control border border-ai/25 bg-ai-soft/60 px-2 py-1.5 text-[11px] leading-snug font-medium text-ai-ink',
        className,
      )}
    >
      <Sparkles size={12} className="mt-px shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  )
}
