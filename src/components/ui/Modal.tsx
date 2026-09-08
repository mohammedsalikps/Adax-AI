import { useId } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOverlay } from '@/hooks/useOverlay'
import { Button } from './Button'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  size?: ModalSize
  /** Buttons for the footer bar. Omit for a body-only dialog. */
  footer?: ReactNode
  /** Set false for destructive confirmations that need a deliberate choice. */
  closeOnOverlayClick?: boolean
  className?: string
  children: ReactNode
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  closeOnOverlayClick = true,
  className,
  children,
}: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const containerRef = useOverlay(open, onClose)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={closeOnOverlayClick ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-panel border border-line bg-surface',
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
            aria-label="Close dialog"
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
