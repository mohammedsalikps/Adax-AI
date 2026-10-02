import { ChangePasswordRequest, type Me } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { PublicLayout } from '../components/PublicLayout.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Alert } from '../components/ui/Feedback.tsx'
import { TextField } from '../components/ui/Form.tsx'
import { useToast } from '../components/ui/Toast.tsx'
import { api, errorMessage } from '../lib/api.ts'
import { HOME_BY_ROLE, ME_KEY, useLogout, useMe } from '../lib/auth.tsx'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { useForm } from '../lib/useForm.ts'

export function ChangePasswordPage() {
  useDocumentTitle('Change password')
  const { data: me } = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const logout = useLogout()
  const form = useForm(ChangePasswordRequest, { currentPassword: '', newPassword: '' })
  const change = useMutation({
    mutationFn: (body: ChangePasswordRequest) => api<Me>('/auth/change-password', { method: 'POST', body }),
    onSuccess: (updated) => {
      qc.setQueryData(ME_KEY, updated)
      toast('success', 'Password changed. Other sessions were signed out.')
      navigate(HOME_BY_ROLE[updated.role], { replace: true })
    },
    onError: (e) => form.applyServerErrors(e),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const body = form.validate()
    if (body) change.mutate(body)
  }

  return (
    <PublicLayout title="Change password" subtitle={me?.mustChangePassword ? 'Your account has a temporary password. Choose a new one to continue.' : undefined}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {change.isError && Object.keys(form.errors).length === 0 && <Alert tone="error">{errorMessage(change.error)}</Alert>}
        <TextField label="Current password" type="password" autoComplete="current-password" value={form.values.currentPassword} onChange={(e) => form.set('currentPassword', e.target.value)} error={form.errors.currentPassword} required />
        <TextField label="New password" type="password" autoComplete="new-password" hint="At least 10 characters. A passphrase is easiest to remember." value={form.values.newPassword} onChange={(e) => form.set('newPassword', e.target.value)} error={form.errors.newPassword} required />
        <Button type="submit" loading={change.isPending} className="w-full">
          Change password
        </Button>
        <div className="flex justify-between text-sm">
          {!me?.mustChangePassword && me && (
            <button type="button" className="font-medium text-brand-strong hover:underline" onClick={() => navigate(HOME_BY_ROLE[me.role])}>
              Back
            </button>
          )}
          <button type="button" className="ml-auto font-medium text-ink-muted hover:underline" onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}>
            Sign out
          </button>
        </div>
      </form>
    </PublicLayout>
  )
}
