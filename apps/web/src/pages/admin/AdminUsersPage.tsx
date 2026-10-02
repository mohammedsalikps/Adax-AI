import { CreateUserRequest, type Department, ROLE_LABELS, UpdateUserRequest, type UserSummary } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { Alert, Badge, Spinner } from '../../components/ui/Feedback.tsx'
import { CheckboxField, SelectField, TextField } from '../../components/ui/Form.tsx'
import { Card, PageHeader } from '../../components/ui/Layout.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { fmtDateTime, generateTemporaryPassword } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'
import { useForm } from '../../lib/useForm.ts'

const USERS = ['admin', 'users'] as const
export const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: () => api<{ departments: Department[] }>('/departments'), select: (d) => d.departments })

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const depts = useDepartments()
  const initial = { username: '', fullName: '', role: 'doctor' as const, departmentId: null, registrationNumber: '', temporaryPassword: generateTemporaryPassword() }
  const form = useForm(CreateUserRequest, initial)
  const create = useMutation({
    mutationFn: (body: CreateUserRequest) => api<UserSummary>('/admin/users', { method: 'POST', body }),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: USERS })
      toast('success', `Created ${u.username}. Share the temporary password securely; they must change it at first sign-in.`)
      form.reset({ ...initial, temporaryPassword: generateTemporaryPassword() })
      onClose()
    },
    onError: (e) => form.applyServerErrors(e),
  })
  const v = form.values
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add staff user"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="create-user" type="submit" loading={create.isPending}>
            Create user
          </Button>
        </>
      }
    >
      <form
        id="create-user"
        noValidate
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          const body = form.validate()
          if (body) create.mutate(body)
        }}
      >
        {create.isError && !Object.keys(form.errors).length && <Alert tone="error" className="sm:col-span-2">{errorMessage(create.error)}</Alert>}
        <TextField label="Full name" value={v.fullName} onChange={(e) => form.set('fullName', e.target.value)} error={form.errors.fullName} required className="sm:col-span-2" />
        <TextField label="Username" autoCapitalize="none" spellCheck={false} value={v.username} onChange={(e) => form.set('username', e.target.value)} error={form.errors.username} required />
        <SelectField label="Role" value={v.role} onChange={(e) => form.set('role', e.target.value as typeof v.role)} error={form.errors.role} required>
          <option value="doctor">Doctor</option>
          <option value="nurse">Nurse</option>
          <option value="admin">Admin</option>
        </SelectField>
        <SelectField label="Department" value={v.departmentId ?? ''} onChange={(e) => form.set('departmentId', e.target.value || null)} error={form.errors.departmentId}>
          <option value="">None</option>
          {depts.data?.filter((d) => d.isActive).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        {v.role === 'doctor' && (
          <TextField label="Registration number" hint="Medical council registration (not verified by the system)." value={v.registrationNumber ?? ''} onChange={(e) => form.set('registrationNumber', e.target.value)} error={form.errors.registrationNumber} />
        )}
        <TextField
          label="Temporary password"
          value={v.temporaryPassword}
          onChange={(e) => form.set('temporaryPassword', e.target.value)}
          error={form.errors.temporaryPassword}
          hint="Generated for you. The user must change it at first sign-in."
          autoComplete="off"
          spellCheck={false}
          required
          className="sm:col-span-2"
        />
      </form>
    </Dialog>
  )
}

function EditUserDialog({ user, onClose }: { user: UserSummary | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const depts = useDepartments()
  const [values, setValues] = useState(() => user && { fullName: user.fullName, role: user.role as 'admin' | 'doctor' | 'nurse', departmentId: user.departmentId, registrationNumber: user.registrationNumber ?? '', isActive: user.isActive })
  const update = useMutation({
    mutationFn: (body: UpdateUserRequest) => api<UserSummary>(`/admin/users/${user!.id}`, { method: 'PATCH', body }),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: USERS })
      toast('success', `Saved ${u.username}`)
      onClose()
    },
  })
  if (!user || !values) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${user.username}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={() => update.mutate(values)}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {update.isError && <Alert tone="error" className="sm:col-span-2">{errorMessage(update.error)}</Alert>}
        <TextField label="Full name" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} className="sm:col-span-2" />
        <SelectField label="Role" value={values.role} onChange={(e) => setValues({ ...values, role: e.target.value as typeof values.role })}>
          <option value="doctor">Doctor</option>
          <option value="nurse">Nurse</option>
          <option value="admin">Admin</option>
        </SelectField>
        <SelectField label="Department" value={values.departmentId ?? ''} onChange={(e) => setValues({ ...values, departmentId: e.target.value || null })}>
          <option value="">None</option>
          {depts.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        {values.role === 'doctor' && <TextField label="Registration number" value={values.registrationNumber} onChange={(e) => setValues({ ...values, registrationNumber: e.target.value })} className="sm:col-span-2" />}
        <div className="sm:col-span-2">
          <CheckboxField label="Account active" hint="Deactivating signs the user out everywhere immediately." checked={values.isActive} onChange={(e) => setValues({ ...values, isActive: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: UserSummary | null; onClose: () => void }) {
  const toast = useToast()
  const [password] = useState(generateTemporaryPassword)
  const reset = useMutation({
    mutationFn: () => api(`/admin/users/${user!.id}/reset-password`, { method: 'POST', body: { temporaryPassword: password } }),
    onSuccess: () => toast('success', `Password reset for ${user!.username}`),
  })
  if (!user) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reset password for ${user.username}`}
      footer={
        reset.isSuccess ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
              Reset password
            </Button>
          </>
        )
      }
    >
      {reset.isError && <Alert tone="error">{errorMessage(reset.error)}</Alert>}
      {reset.isSuccess ? (
        <div className="space-y-2 text-sm">
          <p>Give this temporary password to {user.fullName} through a secure channel. It will not be shown again.</p>
          <p className="rounded-md border border-line bg-canvas px-3 py-2 font-mono text-base select-all" data-testid="temporary-password">
            {password}
          </p>
        </div>
      ) : (
        <p className="text-sm">The user is signed out everywhere and must choose a new password at next sign-in. Any lockout is cleared.</p>
      )}
    </Dialog>
  )
}

export function AdminUsersPage() {
  useDocumentTitle('Users')
  const q = useQuery({ queryKey: USERS, queryFn: () => api<{ users: UserSummary[] }>('/admin/users'), select: (d) => d.users })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<UserSummary | null>(null)
  const [resetting, setResetting] = useState<UserSummary | null>(null)
  return (
    <>
      <PageHeader title="Users" description="Staff accounts. Patient portal accounts are created by activation." actions={<Button icon={<UserPlus aria-hidden="true" className="size-4" />} onClick={() => setCreating(true)}>Add user</Button>} />
      <Card bodyClassName="">
        {q.isPending && <div className="px-5"><Spinner /></div>}
        {q.isError && <Alert tone="error" className="m-5">{errorMessage(q.error)}</Alert>}
        {q.data && (
          <Table
            caption="Staff users"
            rows={q.data}
            rowKey={(u) => u.id}
            columns={[
              { key: 'name', header: 'Name', cell: (u) => <><p className="font-medium">{u.fullName}</p><p className="text-xs text-ink-muted">{u.username}</p></> },
              { key: 'role', header: 'Role', cell: (u) => ROLE_LABELS[u.role] },
              { key: 'dept', header: 'Department', cell: (u) => u.departmentName ?? '—' },
              {
                key: 'status',
                header: 'Status',
                cell: (u) => (
                  <div className="flex flex-wrap gap-1">
                    {u.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                    {u.mustChangePassword && <Badge tone="warn">Temporary password</Badge>}
                    {u.lockedUntil && <Badge tone="down">Locked</Badge>}
                  </div>
                ),
              },
              { key: 'last', header: 'Last sign-in', cell: (u) => <span className="whitespace-nowrap">{fmtDateTime(u.lastLoginAt)}</span> },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                className: 'text-right',
                cell: (u) => (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={() => setEditing(u)} aria-label={`Edit ${u.username}`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" icon={<KeyRound aria-hidden="true" className="size-4" />} onClick={() => setResetting(u)} aria-label={`Reset password for ${u.username}`}>
                      Reset
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      {editing && <EditUserDialog key={editing.id} user={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordDialog key={resetting.id} user={resetting} onClose={() => setResetting(null)} />}
    </>
  )
}
