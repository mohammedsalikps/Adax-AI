import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface RegistrationStepperProps {
  steps: readonly { title: string; hint: string }[]
  /** Zero-based index of the step being edited. */
  currentStep: number
  /** Allows returning to a completed step. */
  onStepSelect?: (step: number) => void
  className?: string
}

/** Horizontal progress indicator for the registration flow. */
export function RegistrationStepper({
  steps,
  currentStep,
  onStepSelect,
  className,
}: RegistrationStepperProps) {
  return (
    <ol className={cn('flex items-stretch gap-1 overflow-x-auto', className)}>
      {steps.map((step, index) => {
        const isComplete = index < currentStep
        const isCurrent = index === currentStep
        const canSelect = Boolean(onStepSelect) && isComplete

        const content = (
          <>
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                isCurrent && 'bg-accent text-ink-inverse',
                isComplete && 'bg-accent-soft text-accent-ink',
                !isCurrent && !isComplete && 'bg-surface-sunken text-ink-muted',
              )}
            >
              {isComplete ? <Check size={11} aria-hidden /> : index + 1}
            </span>
            <span className="min-w-0 text-left">
              <span
                className={cn(
                  'block truncate text-[12px] font-semibold',
                  isCurrent ? 'text-ink' : 'text-ink-soft',
                )}
              >
                {step.title}
              </span>
              <span className="hidden truncate text-[11px] text-ink-muted lg:block">
                {step.hint}
              </span>
            </span>
          </>
        )

        return (
          <li key={step.title} className="min-w-0 flex-1">
            {canSelect ? (
              <button
                type="button"
                onClick={() => onStepSelect?.(index)}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control border px-2.5 py-2 transition-colors',
                  'border-line bg-surface hover:border-line-strong hover:bg-surface-alt',
                )}
              >
                {content}
              </button>
            ) : (
              <div
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control border px-2.5 py-2',
                  isCurrent
                    ? 'border-accent/40 bg-accent-soft/40'
                    : 'border-line bg-surface',
                )}
              >
                {content}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
