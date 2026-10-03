import { type Application, LoginRequest, type Me } from '@adaxai/contracts'
import { Link } from 'react-router'
import { APPLICATION_ENTRIES } from '../../lib/applications.ts'
import { useLogin } from '../../lib/auth.tsx'
import { describeSignInError } from '../../lib/signInErrors.ts'
import { useForm } from '../../lib/useForm.ts'
import { Button } from '../ui/Button.tsx'
import { TextField } from '../ui/Form.tsx'
import { ErrorBanner } from './ErrorBanner.tsx'
import { PasswordField } from './PasswordField.tsx'

/**
 * The sign-in form of one application. It sends the application's name with
 * the username and password, so the API refuses an account of another role
 * before any session exists (and the login mutation ends a session that ever
 * came back for the wrong role before it is shown). The security decisions
 * (credentials, lockout, rate limit, roles, consent) are all the API's.
 */
export function LoginForm({ application, onSignedIn }: { application: Application; onSignedIn: (me: Me) => void }) {
  const entry = APPLICATION_ENTRIES[application]
  const login = useLogin()
  const form = useForm(LoginRequest, { username: '', password: '' })

  const attempt = (body: LoginRequest) =>
    login.mutate(
      { ...body, application },
      {
        onSuccess: onSignedIn,
        onError: (err) => form.applyServerErrors(err),
      },
    )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const body = form.validate()
    if (!body) return
    attempt(body)
  }

  const fieldIssues = Object.keys(form.errors).length > 0
  const view = login.isError && !fieldIssues ? describeSignInError(login.error, application) : null
  const retry = () => {
    const body = form.validate()
    if (body) attempt(body)
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={login.isPending} className="space-y-4" data-testid={`login-form-${application}`}>
      {view && (
        <ErrorBanner view={view} onRetry={retry} retrying={login.isPending}>
          {view.problem === 'wrong_application' && (
            <Link to="/login" className="inline-block font-medium text-brand-strong underline underline-offset-2">
              Choose another application
            </Link>
          )}
        </ErrorBanner>
      )}
      <TextField
        label={entry.usernameLabel}
        hint={entry.usernameHint}
        autoComplete="username"
        autoCapitalize={application === 'patient' ? 'characters' : 'none'}
        spellCheck={false}
        value={form.values.username}
        onChange={(e) => form.set('username', e.target.value)}
        error={form.errors.username}
        required
      />
      <PasswordField label="Password" autoComplete="current-password" value={form.values.password} onChange={(e) => form.set('password', e.target.value)} error={form.errors.password} required />
      <Button type="submit" loading={login.isPending} className="w-full">
        Sign in
      </Button>
      <p className="border-t border-line pt-4 text-center text-sm text-ink-muted">{entry.forgotten}</p>
      {application === 'patient' && (
        <p className="text-center text-sm text-ink-muted">
          First time here, with an activation code?{' '}
          <Link to="/activate" className="font-medium text-brand-strong underline underline-offset-2">
            Activate your account
          </Link>
        </p>
      )}
    </form>
  )
}
