import { LoginRequest } from '@adaxai/contracts'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Link } from 'react-router'
import { PublicLayout } from '../components/PublicLayout.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Alert, Spinner } from '../components/ui/Feedback.tsx'
import { TextField } from '../components/ui/Form.tsx'
import { errorMessage } from '../lib/api.ts'
import { HOME_BY_ROLE, useLogin, useMe } from '../lib/auth.tsx'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { useForm } from '../lib/useForm.ts'

/** Only same-app paths are accepted as a post-login destination (no open redirect). */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export function LoginPage() {
  useDocumentTitle('Sign in')
  const { data: me, isPending } = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const form = useForm(LoginRequest, { username: '', password: '' })

  if (isPending) return <Spinner />
  if (me) return <Navigate to={HOME_BY_ROLE[me.role]} replace />

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const body = form.validate()
    if (!body) return
    login.mutate(body, {
      onSuccess: (user) => navigate(user.mustChangePassword ? '/change-password' : (safeNext(params.get('next')) ?? HOME_BY_ROLE[user.role]), { replace: true }),
      onError: (err) => form.applyServerErrors(err),
    })
  }

  return (
    <PublicLayout title="Sign in to ADAXAI" subtitle="Staff and patients use the same sign-in.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {login.isError && <Alert tone="error">{errorMessage(login.error)}</Alert>}
        <TextField
          label="Username"
          hint="Patients: use your MRN."
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={form.values.username}
          onChange={(e) => form.set('username', e.target.value)}
          error={form.errors.username}
          required
        />
        <TextField label="Password" type="password" autoComplete="current-password" value={form.values.password} onChange={(e) => form.set('password', e.target.value)} error={form.errors.password} required />
        <Button type="submit" loading={login.isPending} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-4 border-t border-line pt-4 text-center text-sm text-ink-muted">
        Patient with an activation code?{' '}
        <Link to="/activate" className="font-medium text-brand-strong underline underline-offset-2">
          Activate your account
        </Link>
      </p>
    </PublicLayout>
  )
}
