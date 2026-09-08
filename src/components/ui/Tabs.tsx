import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface TabItem {
  value: string
  label: string
  icon?: LucideIcon
  /** Optional trailing count, e.g. number of allergies. */
  count?: number
  disabled?: boolean
}

export type TabsVariant = 'underline' | 'segmented'

export interface TabsProps {
  items: TabItem[]
  /** Controlled selection. Omit to let the component manage its own state. */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  variant?: TabsVariant
  size?: 'sm' | 'md'
  ariaLabel: string
  className?: string
}

/** Tab list with roving focus and arrow-key navigation. */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = 'underline',
  size = 'md',
  ariaLabel,
  className,
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? items[0]?.value ?? '',
  )
  const selected = value ?? internalValue
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function select(next: string) {
    if (value === undefined) setInternalValue(next)
    onValueChange?.(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const enabled = items.filter((item) => !item.disabled)
    const currentIndex = enabled.findIndex((item) => item.value === selected)
    if (currentIndex === -1) return

    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % enabled.length
    if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + enabled.length) % enabled.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = enabled.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextValue = enabled[nextIndex].value
    select(nextValue)
    tabRefs.current[nextValue]?.focus()
  }

  const isSegmented = variant === 'segmented'

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center',
        // Either variant scrolls within itself rather than widening the page:
        // labels are whitespace-nowrap and will not shrink to fit.
        'overflow-x-auto',
        isSegmented
          ? 'gap-1 rounded-control border border-line bg-surface-sunken p-1'
          : 'gap-1 border-b border-line',
        className,
      )}
    >
      {items.map((item) => {
        const isSelected = item.value === selected
        const Icon = item.icon

        return (
          <button
            key={item.value}
            ref={(node) => {
              tabRefs.current[item.value] = node
            }}
            type="button"
            role="tab"
            aria-selected={isSelected}
            disabled={item.disabled}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => select(item.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              'inline-flex items-center gap-1.5 font-semibold whitespace-nowrap transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3 text-[13px]',
              isSegmented
                ? cn(
                    'flex-1 justify-center rounded-[5px]',
                    isSelected
                      ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                      : 'text-ink-muted hover:text-ink-soft',
                  )
                : cn(
                    '-mb-px shrink-0 border-b-2',
                    isSelected
                      ? 'border-accent text-accent-ink'
                      : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink-soft',
                  ),
            )}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'tnum rounded-full px-1.5 py-px text-[10px] font-semibold',
                  isSelected
                    ? 'bg-accent-soft text-accent-ink'
                    : 'bg-surface-sunken text-ink-muted',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
