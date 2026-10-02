import { type Department, DepartmentInput } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { Alert, Badge, Spinner } from '../../components/ui/Feedback.tsx'
import { CheckboxField, TextField } from '../../components/ui/Form.tsx'
import { Card, PageHeader } from '../../components/ui/Layout.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'
import { useForm } from '../../lib/useForm.ts'
import { useDepartments } from './AdminUsersPage.tsx'

function DepartmentDialog({ dept, onClose }: { dept: Department | 'new'; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const isNew = dept === 'new'
  const form = useForm(DepartmentInput, isNew ? { code: '', name: '', isActive: true } : { code: dept.code, name: dept.name, isActive: dept.isActive })
  const save = useMutation({
    mutationFn: (body: DepartmentInput) => (isNew ? api<Department>('/admin/departments', { method: 'POST', body }) : api<Department>(`/admin/departments/${dept.id}`, { method: 'PATCH', body })),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['departments'] })
      toast('success', `Saved ${d.name}`)
      onClose()
    },
    onError: (e) => form.applyServerErrors(e),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add department' : `Edit ${dept.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="dept-form" type="submit" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="dept-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const body = form.validate()
          if (body) save.mutate(body)
        }}
      >
        {save.isError && !Object.keys(form.errors).length && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <TextField label="Code" hint="Short code, e.g. GEN" value={form.values.code} onChange={(e) => form.set('code', e.target.value)} error={form.errors.code} required />
        <TextField label="Name" value={form.values.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} required />
        <CheckboxField label="Active" hint="Inactive departments cannot receive new OPD visits." checked={form.values.isActive ?? true} onChange={(e) => form.set('isActive', e.target.checked)} />
      </form>
    </Dialog>
  )
}

export function AdminDepartmentsPage() {
  useDocumentTitle('Departments')
  const q = useDepartments()
  const [editing, setEditing] = useState<Department | 'new' | null>(null)
  return (
    <>
      <PageHeader title="Departments" actions={<Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>Add department</Button>} />
      <Card bodyClassName="">
        {q.isPending && <div className="px-5"><Spinner /></div>}
        {q.isError && <Alert tone="error" className="m-5">{errorMessage(q.error)}</Alert>}
        {q.data && (
          <Table
            caption="Departments"
            rows={q.data}
            rowKey={(d) => d.id}
            columns={[
              { key: 'code', header: 'Code', cell: (d) => <span className="font-mono">{d.code}</span> },
              { key: 'name', header: 'Name', cell: (d) => d.name },
              { key: 'status', header: 'Status', cell: (d) => (d.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>) },
              {
                key: 'a',
                header: <span className="sr-only">Actions</span>,
                className: 'text-right',
                cell: (d) => (
                  <Button size="sm" variant="ghost" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
      {editing && <DepartmentDialog key={editing === 'new' ? 'new' : editing.id} dept={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
