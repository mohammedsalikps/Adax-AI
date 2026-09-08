import { useId } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOverlay } from '@/hooks/useOverlay'
import { Button } from './Button'

export type DrawerSide = 'left' | 'right'
export type DrawerSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<DrawerSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
}

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  side?: DrawerSide
  size?: DrawerSize
  footer?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Edge-anchored overlay panel. Used for secondary detail — a past visit, a
 * patient summary — without navigating away from the current screen.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  side = 'right',
  size = 'md',
  footer,
  className,
  children,
}: DrawerProps) {
  const titleId = useId()
  const descriptionId = useId()
  const containerRef = useOverlay(open, onClose)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'absolute inset-y-0 flex w-full flex-col bg-surface',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          'border-line',
          SIZE_CLASSES[size],
          className,
        )}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-xs text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={X}
            onClick={onClose}
            aria-label="Close panel"
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-alt px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
