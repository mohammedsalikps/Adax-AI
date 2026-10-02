import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'

/**
 * Modal dialog on the native <dialog> element: focus is trapped and restored
 * by the browser, Escape closes it, and the page behind is inert.
 */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-hidden ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40`}
    >
      {open && (
        // Header and footer stay fixed; only the body scrolls (min-h-0 lets it shrink).
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded-md p-2 text-ink-muted hover:bg-canvas" aria-label="Close dialog">
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
