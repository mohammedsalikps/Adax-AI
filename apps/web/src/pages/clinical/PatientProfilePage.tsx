import {
  type ActivationCodeResponse,
  AllergyInput,
  CONSENT_LABELS,
  type ConsentType,
  type Observation,
  type PatientDetail,
  type RecordConsentRequest,
  SEX_LABELS,
  VITALS,
  type Visit,
} from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, KeyRound, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CheckInDialog } from '../../components/clinical/CheckInDialog.tsx'
import { PatientBanner } from '../../components/clinical/PatientBanner.tsx'
import { FlagLabel, fmtValue } from '../../components/clinical/Vitals.tsx'
import { VisitStatusBadge } from '../../components/clinical/VisitStatusBadge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { Alert, Badge, EmptyState, Spinner } from '../../components/ui/Feedback.tsx'
import { CheckboxField, SelectField, TextField } from '../../components/ui/Form.tsx'
import { Card, DescriptionList } from '../../components/ui/Layout.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { patientKey, usePatient, usePatientMutation, usePatientObservations, usePortalBase } from '../../lib/clinical.ts'
import { fmtDate, fmtDateTime } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'
import { useForm } from '../../lib/useForm.ts'

function AllergiesCard({ p }: { p: PatientDetail }) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const form = useForm(AllergyInput, { substance: '', reaction: '', severity: 'unknown' })
  const add = usePatientMutation<AllergyInput>(p.id, '/allergies')
  const nka = usePatientMutation<{ noKnownAllergies: boolean }>(p.id, '/no-known-allergies', 'PUT')
  const qc = useQueryClient()
  const deactivate = useMutation({
    mutationFn: (id: string) => api<PatientDetail>(`/patients/${p.id}/allergies/${id}/deactivate`, { method: 'POST' }),
    onSuccess: (d) => qc.setQueryData(patientKey(p.id), d),
  })
  const active = p.allergies.filter((a) => a.status === 'active')
  return (
    <Card title="Allergies" actions={<Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setAdding(true)}>Add allergy</Button>}>
      {nka.isError && <Alert tone="error" className="mb-3">{errorMessage(nka.error)}</Alert>}
      {active.length ? (
        <ul className="space-y-2">
          {active.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <strong className="text-down">{a.substance}</strong>
                {a.reaction && ` — ${a.reaction}`} <Badge tone={a.severity === 'severe' ? 'down' : 'neutral'}>{a.severity}</Badge>
              </span>
              <Button size="sm" variant="ghost" loading={deactivate.isPending && deactivate.variables === a.id} onClick={() => deactivate.mutate(a.id)}>
                Mark inactive
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3 text-sm">
          <p>{p.noKnownAllergies ? 'No known allergies (confirmed).' : 'Allergies have not been recorded yet.'}</p>
          <CheckboxField
            label="No known allergies"
            hint="Confirm only after asking the patient."
            checked={p.noKnownAllergies}
            disabled={nka.isPending}
            onChange={(e) => nka.mutate({ noKnownAllergies: e.target.checked }, { onSuccess: () => toast('success', 'Allergy status updated') })}
          />
        </div>
      )}
      {adding && (
        <Dialog
          open
          onClose={() => setAdding(false)}
          title="Add allergy"
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" form="allergy-form" loading={add.isPending}>
                Add allergy
              </Button>
            </>
          }
        >
          <form
            id="allergy-form"
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              const body = form.validate()
              if (body)
                add.mutate(body, {
                  onSuccess: () => {
                    toast('success', `Allergy to ${body.substance} recorded`)
                    form.reset()
                    setAdding(false)
                  },
                  onError: (er) => form.applyServerErrors(er),
                })
            }}
          >
            <TextField label="Substance" required value={form.values.substance} onChange={(e) => form.set('substance', e.target.value)} error={form.errors.substance} />
            <TextField label="Reaction" value={form.values.reaction ?? ''} onChange={(e) => form.set('reaction', e.target.value)} error={form.errors.reaction} />
            <SelectField label="Severity" value={form.values.severity} onChange={(e) => form.set('severity', e.target.value as 'mild')}>
              <option value="unknown">Unknown</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </SelectField>
          </form>
        </Dialog>
      )}
    </Card>
  )
}

function ConsentsCard({ p }: { p: PatientDetail }) {
  const toast = useToast()
  const [recording, setRecording] = useState<ConsentType | null>(null)
  const [method, setMethod] = useState<'verbal' | 'written'>('verbal')
  const grant = usePatientMutation<RecordConsentRequest>(p.id, '/consents')
  const qc = useQueryClient()
  const withdraw = useMutation({
    mutationFn: (id: string) => api<PatientDetail>(`/patients/${p.id}/consents/${id}/withdraw`, { method: 'POST' }),
    onSuccess: (d) => (qc.setQueryData(patientKey(p.id), d), toast('success', 'Consent withdrawn')),
  })
  const types = Object.keys(CONSENT_LABELS) as ConsentType[]
  return (
    <Card title="Consents">
      <ul className="divide-y divide-line">
        {types.map((t) => {
          const current = p.consents.find((c) => c.type === t && c.status === 'granted' && c.scope === 'ongoing')
          return (
            <li key={t} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 max-w-md">
                <p className="text-sm font-medium">{CONSENT_LABELS[t].title}</p>
                <p className="text-xs text-ink-muted">{CONSENT_LABELS[t].description}</p>
                {current && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {current.method} · {fmtDateTime(current.recordedAt)} · {current.recordedByName ?? 'patient'}
                  </p>
                )}
              </div>
              {current ? (
                <div className="flex items-center gap-2">
                  <Badge tone="ok">Granted</Badge>
                  <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === current.id} onClick={() => withdraw.mutate(current.id)}>
                    Withdraw
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setRecording(t)}>
                  Record consent
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {recording && (
        <Dialog
          open
          onClose={() => setRecording(null)}
          title={`Record consent: ${CONSENT_LABELS[recording].title}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRecording(null)}>
                Cancel
              </Button>
              <Button loading={grant.isPending} onClick={() => grant.mutate({ type: recording, method }, { onSuccess: () => (toast('success', 'Consent recorded'), setRecording(null)) })}>
                Patient agrees
              </Button>
            </>
          }
        >
          {grant.isError && <Alert tone="error" className="mb-3">{errorMessage(grant.error)}</Alert>}
          <p className="text-sm">Explain to the patient, in their language:</p>
          <blockquote className="my-3 border-l-4 border-brand pl-3 text-sm">{CONSENT_LABELS[recording].description}</blockquote>
          <p className="mb-3 text-sm">The patient can withdraw at any time. Record consent only if they agree.</p>
          <SelectField label="How was consent given?" value={method} onChange={(e) => setMethod(e.target.value as 'verbal')}>
            <option value="verbal">Verbal</option>
            <option value="written">Written (signed form)</option>
          </SelectField>
        </Dialog>
      )}
    </Card>
  )
}

function PortalCard({ p }: { p: PatientDetail }) {
  const qc = useQueryClient()
  const [code, setCode] = useState<ActivationCodeResponse | null>(null)
  const issue = useMutation({
    mutationFn: () => api<ActivationCodeResponse>(`/patients/${p.id}/portal-activation`, { method: 'POST' }),
    onSuccess: (r) => (setCode(r), void qc.invalidateQueries({ queryKey: patientKey(p.id) })),
  })
  const consented = p.consents.some((c) => c.type === 'portal_access' && c.status === 'granted')
  return (
    <Card title="Patient portal">
      {p.portalAccount.active ? (
        <p className="text-sm">
          <Badge tone="ok">Active</Badge> The patient signs in with MRN <span className="font-mono">{p.mrn}</span>.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <p>{p.portalAccount.activationPending ? 'An activation code has been issued and not used yet.' : 'No portal account yet.'}</p>
          {!consented && <Alert tone="info">Record the patient’s consent to portal access first.</Alert>}
          {issue.isError && <Alert tone="error">{errorMessage(issue.error)}</Alert>}
          <Button size="sm" variant="secondary" icon={<KeyRound aria-hidden="true" className="size-4" />} disabled={!consented} loading={issue.isPending} onClick={() => issue.mutate()}>
            {p.portalAccount.activationPending ? 'Issue a new code' : 'Issue activation code'}
          </Button>
        </div>
      )}
      {code && (
        <Dialog open onClose={() => setCode(null)} title="Activation code" footer={<Button onClick={() => setCode(null)}>Done</Button>}>
          <p className="text-sm">Give the patient their MRN and this code. It works once and expires {fmtDateTime(code.expiresAt)}. It will not be shown again.</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-line bg-canvas p-3">
            <dt className="text-sm text-ink-muted">MRN</dt>
            <dd className="font-mono text-lg">{code.mrn}</dd>
            <dt className="text-sm text-ink-muted">Code</dt>
            <dd className="font-mono text-lg select-all" data-testid="activation-code">
              {code.activationCode}
            </dd>
          </dl>
          <p className="mt-3 text-sm">The patient activates at the sign-in page → “Activate your account”.</p>
        </Dialog>
      )}
    </Card>
  )
}

function VitalsHistory({ patientId }: { patientId: string }) {
  const [includeErrors, setIncludeErrors] = useState(false)
  const q = usePatientObservations(patientId, includeErrors)
  const qc = useQueryClient()
  const toast = useToast()
  const [marking, setMarking] = useState<Observation | null>(null)
  const [reason, setReason] = useState('')
  const mark = useMutation({
    mutationFn: () => api(`/observations/${marking!.id}/entered-in-error`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patient', patientId] })
      void qc.invalidateQueries({ queryKey: ['visits'] })
      toast('success', 'Marked as entered in error')
      setMarking(null)
      setReason('')
    },
  })
  return (
    <Card
      title="Vitals history"
      bodyClassName=""
      actions={
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand" checked={includeErrors} onChange={(e) => setIncludeErrors(e.target.checked)} />
          Show entries marked in error
        </label>
      }
    >
      {q.isPending && <div className="px-5"><Spinner /></div>}
      {q.data && (
        <Table
          caption="Vitals history"
          rows={q.data}
          rowKey={(o) => o.id}
          empty={<p className="px-5 py-6 text-sm text-ink-muted">No vitals recorded yet.</p>}
          columns={[
            { key: 'when', header: 'Measured', cell: (o) => <span className="whitespace-nowrap">{fmtDateTime(o.measuredAt)}</span> },
            { key: 'kind', header: 'Measurement', cell: (o) => VITALS[o.kind].label },
            {
              key: 'value',
              header: 'Value',
              cell: (o) => (
                <span className={`tabular-nums ${o.enteredInError ? 'text-ink-muted line-through' : ''}`}>
                  {fmtValue(o)} {o.unit} <FlagLabel flag={o.flag} />
                </span>
              ),
            },
            { key: 'source', header: 'Source', cell: (o) => (o.source === 'manual' ? `Manual · ${o.recordedByName ?? ''}` : `Device (${o.deviceLabel ?? 'unverified'})`) },
            {
              key: 'a',
              header: <span className="sr-only">Actions</span>,
              cell: (o) =>
                o.enteredInError ? (
                  <Badge>Entered in error</Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setMarking(o)}>
                    Mark in error
                  </Button>
                ),
            },
          ]}
        />
      )}
      <p className="border-t border-line px-5 py-2 text-xs text-ink-muted">Flags compare with adult reference ranges (not applied under 18). They are a display aid, not a diagnosis.</p>
      {marking && (
        <Dialog
          open
          onClose={() => setMarking(null)}
          title="Mark as entered in error"
          footer={
            <>
              <Button variant="secondary" onClick={() => setMarking(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={reason.trim().length < 3} loading={mark.isPending} onClick={() => mark.mutate()}>
                Mark in error
              </Button>
            </>
          }
        >
          {mark.isError && <Alert tone="error" className="mb-3">{errorMessage(mark.error)}</Alert>}
          <p className="mb-3 text-sm">
            {VITALS[marking.kind].label} {fmtValue(marking)} {marking.unit} ({fmtDateTime(marking.measuredAt)}) stays on record, struck through, with your reason. Record the correct value separately.
          </p>
          <TextField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </Dialog>
      )}
    </Card>
  )
}

function VisitsCard({ patientId, extra }: { patientId: string; extra?: (v: Visit) => ReactNode }) {
  const q = useQuery({ queryKey: ['patient', patientId, 'visits'], queryFn: () => api<{ visits: Visit[] }>(`/patients/${patientId}/visits`), select: (d) => d.visits })
  return (
    <Card title="Visits" bodyClassName="">
      {q.isPending && <div className="px-5"><Spinner /></div>}
      {q.data && (
        <Table
          caption="Visits"
          rows={q.data}
          rowKey={(v) => v.id}
          empty={<p className="px-5 py-6 text-sm text-ink-muted">No visits yet.</p>}
          columns={[
            { key: 'date', header: 'Date', cell: (v) => <span className="whitespace-nowrap">{fmtDate(v.visitDate)}</span> },
            { key: 'token', header: 'Token', cell: (v) => v.tokenNumber },
            { key: 'dept', header: 'Department', cell: (v) => v.departmentName },
            { key: 'reason', header: 'Reason', cell: (v) => v.chiefComplaint ?? '—' },
            { key: 'status', header: 'Status', cell: (v) => <VisitStatusBadge status={v.status} /> },
            { key: 'x', header: <span className="sr-only">Record</span>, cell: (v) => extra?.(v) ?? null },
          ]}
        />
      )}
    </Card>
  )
}

export function PatientProfilePage({ visitAction, timeline, extra }: { visitAction?: (v: Visit) => ReactNode; timeline?: (patientId: string) => ReactNode; extra?: (p: PatientDetail) => ReactNode }) {
  const { patientId } = useParams()
  const base = usePortalBase()
  const [params, setParams] = useSearchParams()
  const q = usePatient(patientId)
  const [checkingIn, setCheckingIn] = useState(params.get('checkin') === '1')
  useDocumentTitle(q.data ? q.data.fullName : 'Patient')
  if (q.isPending) return <Spinner />
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>
  const p = q.data
  const active = p.allergies.filter((a) => a.status === 'active').map((a) => a.substance)
  const closeCheckIn = () => {
    setCheckingIn(false)
    if (params.has('checkin')) setParams({}, { replace: true })
  }
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link to={`${base}/patients`} className="text-brand-strong underline underline-offset-2">
          Patients
        </Link>{' '}
        / <span className="text-ink-muted">{p.mrn}</span>
      </nav>
      <PatientBanner
        patient={{ ...p, activeAllergies: active }}
        actions={
          <Button icon={<CalendarPlus aria-hidden="true" className="size-4" />} onClick={() => setCheckingIn(true)}>
            Check in to OPD
          </Button>
        }
      />
      <h1 className="sr-only">{p.fullName}</h1>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details">
          <DescriptionList
            items={[
              ['Date of birth', `${fmtDate(p.dateOfBirth)}${p.dateOfBirthEstimated ? ' (estimated)' : ''}`],
              ['Sex', SEX_LABELS[p.sex]],
              ['Phone', p.phone],
              ['Email', p.email],
              ['Address', [p.addressLine, p.city, p.state, p.postalCode].filter(Boolean).join(', ') || null],
              ['ABHA number', p.abhaNumber ? `${p.abhaNumber} (not verified)` : null],
              ['Blood group', p.bloodGroup],
              ['Preferred language', p.preferredLanguage],
              ['Emergency contact', [p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(' · ') || null],
              ['Registered', fmtDateTime(p.createdAt)],
            ]}
          />
        </Card>
        <AllergiesCard p={p} />
        {timeline && <div className="xl:col-span-2">{timeline(p.id)}</div>}
        <div className="xl:col-span-2">
          <VitalsHistory patientId={p.id} />
        </div>
        <div className="xl:col-span-2">
          <VisitsCard patientId={p.id} extra={visitAction} />
        </div>
        {extra && <div className="xl:col-span-2">{extra(p)}</div>}
        <ConsentsCard p={p} />
        <PortalCard p={p} />
      </div>
      {checkingIn && <CheckInDialog patientId={p.id} patientName={p.fullName} onClose={closeCheckIn} />}
    </>
  )
}

export const EmptyPatient = () => <EmptyState title="Select a patient" />
