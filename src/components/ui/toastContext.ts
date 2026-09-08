import { createContext, useContext } from 'react'

export type ToastStatus = 'info' | 'success' | 'warning' | 'error'

export interface ToastOptions {
  title: string
  description?: string
  status?: ToastStatus
  /** Auto-dismiss delay in ms. Pass 0 to keep the toast until dismissed. */
  durationMs?: number
}

export interface ToastContextValue {
  /** Raises a toast and returns its id. */
  showToast: (options: ToastOptions) => string
  dismissToast: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
