import { ActivatePatientAccountRequest, type Me } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PublicLayout } from '../components/PublicLayout.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Alert } from '../components/ui/Feedback.tsx'
import { CheckboxField, TextField } from '../components/ui/Form.tsx'
import { api, errorMessage } from '../lib/api.ts'
import { replaceSession } from '../lib/session.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { useForm } from '../lib/useForm.ts'

export function ActivatePage() {
  useDocumentTitle('Activate patient account')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const form = useForm(ActivatePatientAccountRequest, { mrn: '', activationCode: '', password: '' })
  const [agreed, setAgreed] = useState(false)
  const activate = useMutation({
    mutationFn: (body: ActivatePatientAccountRequest) => api<Me>('/auth/activate', { method: 'POST', body }),
    onSuccess: (me) => {
      replaceSession(qc, me)
      navigate('/patient', { replace: true })
    },
    onError: (e) => form.applyServerErrors(e),
  })
  return (
    <PublicLayout title="Activate your account" subtitle="Use the MRN and activation code the clinic gave you." application="patient">
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const body = form.validate()
          if (body && agreed) activate.mutate(body)
        }}
      >
        {activate.isError && !Object.keys(form.errors).length && <Alert tone="error">{errorMessage(activate.error)}</Alert>}
        <TextField label="MRN" autoCapitalize="characters" autoComplete="username" spellCheck={false} value={form.values.mrn} onChange={(e) => form.set('mrn', e.target.value)} error={form.errors.mrn} hint="Printed on your registration slip, e.g. ADX-001234" required />
        <TextField label="Activation code" autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} value={form.values.activationCode} onChange={(e) => form.set('activationCode', e.target.value)} error={form.errors.activationCode} required />
        <TextField label="Choose a password" type="password" autoComplete="new-password" value={form.values.password} onChange={(e) => form.set('password', e.target.value)} error={form.errors.password} hint="At least 10 characters." required />
        <CheckboxField
          label="I understand this portal shows my own records from the clinic"
          hint="Only records approved by your doctor appear here. You can ask the clinic to close your account at any time."
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <Button type="submit" className="w-full" disabled={!agreed} loading={activate.isPending}>
          Activate and sign in
        </Button>
      </form>
      <p className="mt-4 border-t border-line pt-4 text-center text-sm text-ink-muted">
        Already activated?{' '}
        <Link to="/login/patient" className="font-medium text-brand-strong underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </PublicLayout>
  )
}
