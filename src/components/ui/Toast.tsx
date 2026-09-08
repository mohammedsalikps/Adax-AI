import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ToastContext, type ToastOptions, type ToastStatus } from './toastContext'

const STATUS_ICON: Record<ToastStatus, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
}

const STATUS_ICON_CLASSES: Record<ToastStatus, string> = {
  info: 'text-accent',
  success: 'text-normal',
  warning: 'text-caution',
  error: 'text-critical',
}

const STATUS_ACCENT_CLASSES: Record<ToastStatus, string> = {
  info: 'bg-accent',
  success: 'bg-normal',
  warning: 'bg-caution',
  error: 'bg-critical',
}

export interface ToastProps {
  title: string
  description?: string
  status?: ToastStatus
  onDismiss?: () => void
  className?: string
}

/** Presentational toast. Render directly, or raise one with useToast(). */
export function Toast({
  title,
  description,
  status = 'info',
  onDismiss,
  className,
}: ToastProps) {
  const Icon = STATUS_ICON[status]

  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto relative flex w-80 max-w-full items-start gap-2.5 overflow-hidden rounded-panel border border-line bg-surface py-3 pr-2.5 pl-3.5',
        'shadow-[0_2px_8px_rgba(15,23,42,0.08)]',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-1', STATUS_ACCENT_CLASSES[status])}
      />
      <Icon
        size={16}
        aria-hidden
        className={cn('mt-px shrink-0', STATUS_ICON_CLASSES[status])}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="shrink-0 rounded-control p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-soft"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}

interface ToastRecord extends ToastOptions {
  id: string
}

/** Owns the toast queue and renders it into a fixed portal container. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((options: ToastOptions) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { ...options, id }])
    return id
  }, [])

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-4 bottom-4 z-60 flex flex-col gap-2">
          {toasts.map((toast) => (
            <AutoDismissToast key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function AutoDismissToast({
  toast,
  onDismiss,
}: {
  toast: ToastRecord
  onDismiss: (id: string) => void
}) {
  const { id, durationMs = 4000 } = toast

  useEffect(() => {
    if (durationMs <= 0) return
    const timer = window.setTimeout(() => onDismiss(id), durationMs)
    return () => window.clearTimeout(timer)
  }, [id, durationMs, onDismiss])

  return (
    <Toast
      title={toast.title}
      description={toast.description}
      status={toast.status}
      onDismiss={() => onDismiss(id)}
    />
  )
}
