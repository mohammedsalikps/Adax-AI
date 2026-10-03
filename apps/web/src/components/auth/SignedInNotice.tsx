import { APPLICATION_LABELS, applicationOf, type Me, ROLE_LABELS } from '@adaxai/contracts'
import { LogOut } from 'lucide-react'
import { Link } from 'react-router'
import { HOME_BY_ROLE, useLogout } from '../../lib/auth.tsx'
import { signOutProblem } from '../../lib/signInErrors.ts'
import { Button } from '../ui/Button.tsx'

/**
 * Shown when someone who is already signed in opens a sign-in page that is not
 * their application's. Nothing is hidden or switched silently: it says who is
 * signed in, offers their own workspace, and signing out is one press, after
 * which the person can sign in as someone else. A session is never carried
 * from one application's sign-in to another's.
 */
export function SignedInNotice({ me, wanted }: { me: Me; wanted?: string }) {
  const logout = useLogout()
  return (
    <div className="rounded-xl border border-notice/20 bg-notice-soft p-4 text-sm text-notice" data-testid="signed-in-notice">
      <p role="status" className="font-semibold">
        You are signed in as {me.fullName} ({ROLE_LABELS[me.role]}) in the {APPLICATION_LABELS[applicationOf(me.role)]}.
      </p>
      <p className="mt-1 text-ink">{wanted ? `To open the ${wanted}, sign out first.` : 'To use another application, sign out first.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to={HOME_BY_ROLE[me.role]} className="inline-flex min-h-control-sm items-center rounded-md border border-line-strong bg-surface px-3 text-sm font-medium text-ink shadow-card hover:bg-canvas">
          Open my workspace
        </Link>
        <Button size="sm" variant="secondary" icon={<LogOut aria-hidden="true" className="size-4" />} loading={logout.isPending} onClick={() => logout.mutate()}>
          Sign out
        </Button>
      </div>
      {logout.isError && (
        <p role="alert" className="mt-3 font-medium text-down">
          {signOutProblem(logout.error)}
        </p>
      )}
    </div>
  )
}
