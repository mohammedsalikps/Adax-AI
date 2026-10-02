import { CreateVisitRequest, type Visit } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, errorMessage } from '../../lib/api.ts'
import { useMe } from '../../lib/auth.tsx'
import { usePortalBase } from '../../lib/clinical.ts'
import { useForm } from '../../lib/useForm.ts'
import { useDepartments } from '../../pages/admin/AdminUsersPage.tsx'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert } from '../ui/Feedback.tsx'
import { SelectField, TextAreaField } from '../ui/Form.tsx'
import { useToast } from '../ui/Toast.tsx'

interface Staff {
  id: string
  fullName: string
  role: string
  departmentId: string | null
}
export const useDoctors = () => useQuery({ queryKey: ['staff', 'doctor'], queryFn: () => api<{ staff: Staff[] }>('/staff', { query: { role: 'doctor' } }), select: (d) => d.staff })

/** Adds a patient to today's OPD queue and issues a token. */
export function CheckInDialog({ patientId, patientName, onClose }: { patientId: string; patientName: string; onClose: () => void }) {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const base = usePortalBase()
  const depts = useDepartments()
  const doctors = useDoctors()
  const form = useForm(CreateVisitRequest, { patientId, departmentId: me?.departmentId ?? '', assignedDoctorId: null, priority: 'normal', chiefComplaint: '' })
  const create = useMutation({
    mutationFn: (body: CreateVisitRequest) => api<Visit>('/visits', { method: 'POST', body }),
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: ['visits'] })
      void qc.invalidateQueries({ queryKey: ['patient', patientId] })
      toast('success', `${patientName} checked in — token ${v.tokenNumber}`)
      onClose()
      navigate(base)
    },
    onError: (e) => form.applyServerErrors(e),
  })
  const v = form.values
  const deptDoctors = (doctors.data ?? []).filter((d) => !v.departmentId || d.departmentId === v.departmentId)

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Check in ${patientName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="checkin-form" loading={create.isPending}>
            Check in and issue token
          </Button>
        </>
      }
    >
      <form
        id="checkin-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const body = form.validate()
          if (body) create.mutate(body)
        }}
      >
        {create.isError && !Object.keys(form.errors).length && <Alert tone="error">{errorMessage(create.error)}</Alert>}
        <SelectField label="Department" required value={v.departmentId} onChange={(e) => form.set('departmentId', e.target.value)} error={form.errors.departmentId}>
          <option value="">Choose…</option>
          {depts.data?.filter((d) => d.isActive).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Doctor" hint="Optional. Unassigned visits appear to every doctor in the department." value={v.assignedDoctorId ?? ''} onChange={(e) => form.set('assignedDoctorId', e.target.value || null)} error={form.errors.assignedDoctorId}>
          <option value="">Any doctor in the department</option>
          {deptDoctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </SelectField>
        <SelectField label="Priority" value={v.priority} onChange={(e) => form.set('priority', e.target.value as 'normal' | 'urgent')}>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent (seen first)</option>
        </SelectField>
        <TextAreaField label="Reason for visit" rows={2} value={v.chiefComplaint ?? ''} onChange={(e) => form.set('chiefComplaint', e.target.value)} error={form.errors.chiefComplaint} hint="In the patient’s words, e.g. “fever for 3 days”." />
      </form>
    </Dialog>
  )
}
