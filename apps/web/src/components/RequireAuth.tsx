import { applicationOf, type Role } from '@adaxai/contracts'
import { Fragment, type ReactNode, useEffect, useRef } from 'react'
import { Navigate, useLocation } from 'react-router'
import { NoAccessPage } from '../pages/NoAccessPage.tsx'
import { applicationForRoles, APPLICATION_ENTRIES } from '../lib/applications.ts'
import { HOME_BY_ROLE, useMe } from '../lib/auth.tsx'
import { recentSessionExit } from '../lib/sessionEnd.ts'
import { AuthShell } from './auth/AuthShell.tsx'
import { ErrorBanner } from './auth/ErrorBanner.tsx'
import { LoadingState } from './ui/Feedback.tsx'

/**
 * Client-side routing guard. This is navigation convenience and explanation
 * only: every API route enforces authentication, role, facility and consent on
 * the server, whatever this component shows. Signed out: the sign-in page of
 * the application the page belongs to. Signed in as the wrong role: a plain
 * "no access" page (not a silent redirect, which would hide the refusal).
 */
export function RequireAuth({ roles, children, allowPasswordChange }: { roles?: Role[]; children: ReactNode; allowPasswordChange?: boolean }) {
  const { data: me, isPending, isError, refetch, isFetching } = useMe()
  const location = useLocation()
  // When a different person takes over while the page is open, the page is rebuilt (below) and keyboard focus, lost with the old one,
  // goes to the new page's main region, as after any navigation.
  const personId = me?.id
  const shownFor = useRef(personId)
  useEffect(() => {
    if (shownFor.current && personId && shownFor.current !== personId) document.getElementById('main')?.focus()
    shownFor.current = personId
  }, [personId])
  if (isPending) {
    return (
      <AuthShell>
        <LoadingState label="Checking your session…" rows={2} />
      </AuthShell>
    )
  }
  // A failed check (the service is down) only blocks when nobody is known yet; a person already shown keeps their page.
  if (isError && me === undefined) {
    return (
      <AuthShell>
        <ErrorBanner view={{ problem: 'unavailable', title: 'Cannot reach the service', message: 'The service is not responding. Please try again in a moment.', retry: true }} onRetry={() => void refetch()} retrying={isFetching} />
      </AuthShell>
    )
  }
  if (!me) {
    // The sign-in page of the application this page belongs to (clinical pages: the Doctor App), or the selector for pages of none.
    const exit = recentSessionExit()
    // They signed out themselves: back to the front door, not to a sign-in page that wants to bring them back here.
    if (exit?.kind === 'signed_out') return <Navigate to="/login" replace />
    if (exit?.kind === 'portal_withdrawn') return <Navigate to="/login/patient?notice=portal_withdrawn" replace />
    const ended = exit?.kind === 'ended' ? exit.application : null
    const app = ended ?? applicationForRoles(roles)
    const next = `next=${encodeURIComponent(location.pathname + location.search)}`
    const reason = ended ? '&reason=session_ended' : ''
    return <Navigate to={app ? `${APPLICATION_ENTRIES[app].path}?${next}${reason}` : `/login?${next}`} replace />
  }
  if (me.mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />
  if (roles && !roles.includes(me.role)) return <NoAccessPage me={me} application={applicationForRoles(roles) ?? applicationOf(me.role)} roles={roles} />
  // Keyed by the person: if another person becomes the signed-in one while the page is open (a sign-in in another tab), the whole page
  // is rebuilt, so nothing the last one typed, opened or had queued (an autosave, say) carries over to the new one.
  return <Fragment key={me.id}>{children}</Fragment>
}

/** `/` sends signed-in users to their workspace and everyone else to the application selector. */
export function RoleRedirect() {
  const { data: me, isPending } = useMe()
  if (isPending) {
    return (
      <AuthShell>
        <LoadingState label="Checking your session…" rows={2} />
      </AuthShell>
    )
  }
  return <Navigate to={me ? HOME_BY_ROLE[me.role] : '/login'} replace />
}
