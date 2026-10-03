import { APPLICATION_LABELS, APPLICATION_ROLES, type Application } from '@adaxai/contracts'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AuthHeader, AuthShell, BackToApplications } from '../components/auth/AuthShell.tsx'
import { ErrorBanner } from '../components/auth/ErrorBanner.tsx'
import { LoginForm } from '../components/auth/LoginForm.tsx'
import { SignedInNotice } from '../components/auth/SignedInNotice.tsx'
import { APP_STYLE } from '../components/auth/appStyle.tsx'
import { Alert, LoadingState } from '../components/ui/Feedback.tsx'
import { APPLICATION_ENTRIES, safeNext } from '../lib/applications.ts'
import { HOME_BY_ROLE, useMe } from '../lib/auth.tsx'
import { describeSignInError } from '../lib/signInErrors.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

/**
 * One application's sign-in page ("Doctor Portal", "Patient Portal", "Admin
 * Portal"): the same secure sign-in as ever, behind a front door of its own.
 * It sends the person to their own workspace after sign-in; the application
 * they chose never overrides the role the API says the account has.
 */
export function LoginPage({ application }: { application: Application }) {
  const entry = APPLICATION_ENTRIES[application]
  useDocumentTitle(`${entry.portal}: sign in`)
  const { data: me, isPending, isError, error, refetch, isFetching } = useMe()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { accent } = APP_STYLE[application]

  const header = <AuthHeader title={entry.portal} subtitle={entry.subtitle} application={application} />

  if (isPending) {
    return (
      <AuthShell>
        <BackToApplications application={application} />
        {header}
        <LoadingState label="Checking your session…" rows={2} />
      </AuthShell>
    )
  }
  if (me && APPLICATION_ROLES[application].includes(me.role)) return <Navigate to={me.mustChangePassword ? '/change-password' : (safeNext(params.get('next'), me.role) ?? HOME_BY_ROLE[me.role])} replace />

  return (
    <AuthShell>
      <BackToApplications application={application} />
      {header}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div aria-hidden="true" className={`h-1.5 ${accent}`} />
        <div className="space-y-4 p-6 sm:p-8">
          {me ? (
            <SignedInNotice me={me} wanted={APPLICATION_LABELS[application]} />
          ) : (
            <>
              {params.get('reason') === 'session_ended' && (
                <Alert tone="info" title="Your session ended">
                  For your security you were signed out. Sign in again to continue.
                </Alert>
              )}
              {application === 'patient' && params.get('notice') === 'portal_withdrawn' && (
                <Alert tone="info" title="Online access switched off">
                  You withdrew your consent to the patient portal, so you have been signed out and your account is switched off. Your care is not affected. Ask the clinic if you want access again.
                </Alert>
              )}
              {/* The session check itself failed (the service is down): say so, with a way to check again, above the form. */}
              {isError && <ErrorBanner view={describeSignInError(error, application)} onRetry={() => void refetch()} retrying={isFetching} />}
              <LoginForm application={application} onSignedIn={(user) => navigate(user.mustChangePassword ? '/change-password' : (safeNext(params.get('next'), user.role) ?? HOME_BY_ROLE[user.role]), { replace: true })} />
            </>
          )}
        </div>
      </div>
    </AuthShell>
  )
}
