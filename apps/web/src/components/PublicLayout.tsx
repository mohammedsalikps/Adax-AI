import type { Application } from '@adaxai/contracts'
import type { ReactNode } from 'react'
import { AuthHeader, AuthShell, BackToApplications } from './auth/AuthShell.tsx'

/** The frame of activation and the password change: the same shell, header and card as the sign-in pages. */
export function PublicLayout({ title, subtitle, application, children }: { title: string; subtitle?: ReactNode; application?: Application; children: ReactNode }) {
  return (
    <AuthShell>
      <BackToApplications {...(application && { application })} />
      <AuthHeader title={title} subtitle={subtitle} {...(application && { application })} />
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">{children}</div>
    </AuthShell>
  )
}
