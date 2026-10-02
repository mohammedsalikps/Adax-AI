import type { Role } from '@adaxai/contracts'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { HOME_BY_ROLE, useMe } from '../lib/auth.tsx'
import { Alert, Spinner } from './ui/Feedback.tsx'

/**
 * Client-side routing guard. This is navigation convenience only: every API
 * route enforces authentication and permissions on the server.
 */
export function RequireAuth({ roles, children, allowPasswordChange }: { roles?: Role[]; children: ReactNode; allowPasswordChange?: boolean }) {
  const { data: me, isPending, isError } = useMe()
  const location = useLocation()
  if (isPending) return <Spinner label="Checking your session…" />
  if (isError) return <Alert tone="error" title="Cannot reach the server" className="m-6">Check that the API is running, then reload the page.</Alert>
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (me.mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />
  if (roles && !roles.includes(me.role)) return <Navigate to={HOME_BY_ROLE[me.role]} replace />
  return <>{children}</>
}

/** `/` sends signed-in users to their portal and everyone else to sign-in. */
export function RoleRedirect() {
  const { data: me, isPending } = useMe()
  if (isPending) return <Spinner label="Checking your session…" />
  return <Navigate to={me ? HOME_BY_ROLE[me.role] : '/login'} replace />
}
