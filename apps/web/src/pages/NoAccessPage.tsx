import { APPLICATION_LABELS, type Application, applicationOf, type Me, ROLE_LABELS, type Role } from '@adaxai/contracts'
import { LogOut, ShieldAlert } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { AuthShell } from '../components/auth/AuthShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { HOME_BY_ROLE, useLogout } from '../lib/auth.tsx'
import { signOutProblem } from '../lib/signInErrors.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

/**
 * A signed-in person opened a page their account is not meant for (by following
 * a link, or by typing the address). The page says so plainly and offers their
 * own workspace and sign-out; it does not quietly send them somewhere else. The
 * API refuses the data in any case: this is the explanation, not the protection.
 * When the page belongs to another application the title says which; when it
 * belongs to the other workspace of the same application (a doctor at a nurse's
 * page) it says whose page it is.
 */
export function NoAccessPage({ me, application, roles }: { me: Me; application: Application; roles: readonly Role[] }) {
  useDocumentTitle('No access')
  const logout = useLogout()
  const navigate = useNavigate()
  const own = applicationOf(me.role)
  const sameApplication = own === application
  const whose = roles.map((r) => `${ROLE_LABELS[r].toLowerCase()}s`).join(' and ')
  return (
    <AuthShell>
      <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8" data-testid="no-access">
        <span aria-hidden="true" className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-pending-soft text-pending">
          <ShieldAlert className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{sameApplication ? `This page is for ${whose}` : `This account cannot access the ${APPLICATION_LABELS[application]}`}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {sameApplication
            ? `You are signed in as ${me.fullName} (${ROLE_LABELS[me.role]}). This page belongs to the ${whose}' workspace of the ${APPLICATION_LABELS[application]}, which your account does not use.`
            : `You are signed in as ${me.fullName} (${ROLE_LABELS[me.role]}), which belongs to the ${APPLICATION_LABELS[own]}. Nothing in the ${APPLICATION_LABELS[application]} is available to this account.`}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link to={HOME_BY_ROLE[me.role]} className="inline-flex min-h-control items-center justify-center rounded-md border border-brand bg-brand px-4 text-sm font-medium text-white shadow-card hover:border-brand-strong hover:bg-brand-strong">
            Go to my workspace
          </Link>
          <Button variant="secondary" icon={<LogOut aria-hidden="true" className="size-4" />} loading={logout.isPending} onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })}>
            Sign out
          </Button>
        </div>
        {logout.isError && (
          <p role="alert" className="mt-3 text-sm font-medium text-down">
            {signOutProblem(logout.error)}
          </p>
        )}
      </div>
    </AuthShell>
  )
}
