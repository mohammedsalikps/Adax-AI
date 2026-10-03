import { CircleAlert, Lock, ServerCrash, TriangleAlert, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SignInErrorView } from '../../lib/signInErrors.ts'
import { Button } from '../ui/Button.tsx'

const LOOK: Record<SignInErrorView['problem'], { Icon: typeof CircleAlert; cls: string }> = {
  invalid_credentials: { Icon: CircleAlert, cls: 'border-down/25 bg-down-soft text-down' },
  locked: { Icon: Lock, cls: 'border-pending/25 bg-pending-soft text-pending' },
  rate_limited: { Icon: TriangleAlert, cls: 'border-pending/25 bg-pending-soft text-pending' },
  wrong_application: { Icon: TriangleAlert, cls: 'border-pending/25 bg-pending-soft text-pending' },
  forbidden: { Icon: CircleAlert, cls: 'border-down/25 bg-down-soft text-down' },
  unavailable: { Icon: ServerCrash, cls: 'border-pending/25 bg-pending-soft text-pending' },
  network: { Icon: WifiOff, cls: 'border-pending/25 bg-pending-soft text-pending' },
  server: { Icon: ServerCrash, cls: 'border-down/25 bg-down-soft text-down' },
  unexpected: { Icon: CircleAlert, cls: 'border-down/25 bg-down-soft text-down' },
}

/**
 * Says what went wrong at sign-in: a title, a sentence that helps, and, when
 * the problem is the service rather than the person's entries, a way to try
 * again. It is announced at once (role alert) and never shows a code, a
 * stack, or whether a username exists.
 */
export function ErrorBanner({ view, onRetry, retrying, children }: { view: SignInErrorView; onRetry?: () => void; retrying?: boolean; children?: ReactNode }) {
  const { Icon, cls } = LOOK[view.problem]
  return (
    <div role="alert" data-problem={view.problem} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{view.title}</p>
        <p className="text-ink">{view.message}</p>
        {children}
        {view.retry && onRetry && (
          <Button size="sm" variant="secondary" className="mt-2" loading={retrying} onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}
