/**
 * Numbered heading for a consultation workspace section. The numbers read
 * top to bottom down the main column so the screen reads as one connected
 * workflow rather than a stack of unrelated cards.
 */
export function StepTitle({ step, children }: { step: number; children: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="tnum flex size-[18px] shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[10px] font-bold text-ink-muted"
      >
        {step}
      </span>
      <span className="truncate">{children}</span>
    </span>
  )
}
