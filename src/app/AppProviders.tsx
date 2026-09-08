import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/ui/Toast'
import { DemoResetNotice } from '@/features/demo/DemoResetNotice'

/**
 * Composition point for global context providers.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DemoResetNotice />
      {children}
    </ToastProvider>
  )
}
