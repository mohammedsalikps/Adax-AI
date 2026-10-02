import { CreatePatientRequest, type DuplicateCandidate, type PatientDetail } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '../../components/ui/Button.tsx'
import { Alert } from '../../components/ui/Feedback.tsx'
import { SelectField, TextField } from '../../components/ui/Form.tsx'
import { Card, PageHeader } from '../../components/ui/Layout.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
import { ApiError, api, errorMessage } from '../../lib/api.ts'
import { patientKey, usePortalBase } from '../../lib/clinical.ts'
import { fmtDate } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'
import { useForm } from '../../lib/useForm.ts'

const EMPTY = {
  givenName: '',
  familyName: '',
  dateOfBirth: '',
  dateOfBirthEstimated: false,
  sex: '' as unknown as 'female',
  phone: '',
  email: '',
  addressLine: '',
  city: '',
  state: '',
  postalCode: '',
  abhaNumber: '',
  bloodGroup: null,
  preferredLanguage: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
}

export function RegisterPatientPage() {
  useDocumentTitle('Register patient')
  const base = usePortalBase()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const form = useForm(CreatePatientRequest, EMPTY)
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null)
  const [ageYears, setAgeYears] = useState('')
  const create = useMutation({
    mutationFn: (body: CreatePatientRequest) => api<PatientDetail>('/patients', { method: 'POST', body }),
    onSuccess: (p) => {
      qc.setQueryData(patientKey(p.id), p)
      toast('success', `Registered ${p.fullName} — MRN ${p.mrn}`)
      navigate(`${base}/patients/${p.id}?checkin=1`)
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.code === 'possible_duplicate') return
      form.applyServerErrors(e)
    },
  })

  const submit = async (confirmNotDuplicate = false) => {
    const body = form.validate()
    if (!body) return
    try {
      await create.mutateAsync({ ...body, confirmNotDuplicate })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'possible_duplicate') {
        setDuplicates((e.body as { candidates?: DuplicateCandidate[] }).candidates ?? [])
      }
    }
  }

  const v = form.values
  const set = form.set
  const err = form.errors

  /** Estimated DOB from an age, for patients who do not know their birth date. */
  const applyAge = () => {
    const n = Number(ageYears)
    if (!Number.isInteger(n) || n < 0 || n > 120) return
    const d = new Date()
    set('dateOfBirth', `${d.getFullYear() - n}-01-01`)
    set('dateOfBirthEstimated', true)
  }

  return (
    <>
      <PageHeader title="Register patient" description="Fields marked * are required. Use synthetic details only in this build." />
      <form
        noValidate
        className="max-w-4xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          setDuplicates(null)
          void submit(false)
        }}
      >
        {create.isError && !(create.error instanceof ApiError && create.error.code === 'possible_duplicate') && !Object.keys(err).length && <Alert tone="error">{errorMessage(create.error)}</Alert>}
        {Object.keys(err).length > 0 && <Alert tone="error">Please correct the highlighted fields.</Alert>}

        <Card title="Identity">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Given name" required value={v.givenName} onChange={(e) => set('givenName', e.target.value)} error={err.givenName} autoComplete="off" />
            <TextField label="Family name" value={v.familyName ?? ''} onChange={(e) => set('familyName', e.target.value)} error={err.familyName} autoComplete="off" hint="Leave empty if the patient uses a single name." />
            <div className="space-y-2">
              <TextField label="Date of birth" type="date" required value={v.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => (set('dateOfBirth', e.target.value), set('dateOfBirthEstimated', false))} error={err.dateOfBirth} />
              <div className="flex items-end gap-2">
                <TextField label="Or age in years" inputMode="numeric" value={ageYears} onChange={(e) => setAgeYears(e.target.value)} className="w-32" />
                <Button variant="secondary" size="sm" onClick={applyAge} disabled={!ageYears}>
                  Estimate DOB
                </Button>
              </div>
              {v.dateOfBirthEstimated && <p className="text-xs text-pending">Date of birth is estimated from age.</p>}
            </div>
            <SelectField label="Sex" required value={v.sex} onChange={(e) => set('sex', e.target.value as 'female')} error={err.sex}>
              <option value="">Choose…</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </SelectField>
          </div>
        </Card>

        <Card title="Contact">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Mobile number" required type="tel" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} error={err.phone} hint="10 digits, or international with +" />
            <TextField label="Email" type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} error={err.email} />
            <TextField label="Address" value={v.addressLine ?? ''} onChange={(e) => set('addressLine', e.target.value)} error={err.addressLine} className="sm:col-span-2" />
            <TextField label="City / town" value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} error={err.city} />
            <TextField label="State" value={v.state ?? ''} onChange={(e) => set('state', e.target.value)} error={err.state} />
            <TextField label="PIN code" inputMode="numeric" value={v.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} error={err.postalCode} />
          </div>
        </Card>

        <Card title="Other details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="ABHA number" inputMode="numeric" value={v.abhaNumber ?? ''} onChange={(e) => set('abhaNumber', e.target.value)} error={err.abhaNumber} hint="Optional. Stored as entered; not verified with ABDM." />
            <SelectField label="Blood group" value={v.bloodGroup ?? ''} onChange={(e) => set('bloodGroup', (e.target.value || null) as 'A+' | null)}>
              <option value="">Not known</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </SelectField>
            <TextField label="Preferred language" value={v.preferredLanguage ?? ''} onChange={(e) => set('preferredLanguage', e.target.value)} error={err.preferredLanguage} />
            <div />
            <TextField label="Emergency contact name" value={v.emergencyContactName ?? ''} onChange={(e) => set('emergencyContactName', e.target.value)} error={err.emergencyContactName} />
            <TextField label="Emergency contact phone" type="tel" value={v.emergencyContactPhone ?? ''} onChange={(e) => set('emergencyContactPhone', e.target.value)} error={err.emergencyContactPhone} />
          </div>
        </Card>

        {duplicates && (
          <section aria-labelledby="dup-heading" className="rounded-xl border border-pending/40 bg-pending-soft p-5">
            <h2 id="dup-heading" className="font-semibold text-pending">
              This patient may already be registered
            </h2>
            <p className="mt-1 text-sm">Check these records before creating a new one. Duplicate records split a patient’s history.</p>
            <ul className="mt-3 space-y-2">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                  <span>
                    <strong>{d.fullName}</strong> · {d.mrn} · DOB {fmtDate(d.dateOfBirth)} · {d.phone}
                  </span>
                  <Link to={`${base}/patients/${d.id}`} className="font-medium text-brand-strong hover:underline">
                    Open this record
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" loading={create.isPending} onClick={() => void submit(true)}>
                Different person — register anyway
              </Button>
              <span className="text-xs text-ink-muted">The override is recorded in the audit log.</span>
            </div>
          </section>
        )}

        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending}>
            Register patient
          </Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  )
}
