import { useQuery } from '@tanstack/react-query'
import { SystemStatusPanel } from '../../components/SystemStatusPanel.tsx'
import { Alert, Spinner } from '../../components/ui/Feedback.tsx'
import { PageHeader } from '../../components/ui/Layout.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

interface Overview {
  users: Partial<Record<'admin' | 'doctor' | 'nurse' | 'patient', { active: number; total: number }>>
  activeSessions: number
  activeDepartments: number
  failedLogins24h: number
  queueToday?: { total: number; waiting: number; withDoctor: number; completed: number }
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

export function AdminOverviewPage() {
  useDocumentTitle('Admin overview')
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<Overview>('/admin/overview'), refetchInterval: 30_000 })
  const u = q.data?.users
  return (
    <>
      <PageHeader title="Operational overview" description="Counts only. Clinical records are not shown to administrators." />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Doctors (active)" value={u?.doctor?.active ?? 0} />
          <Stat label="Nurses (active)" value={u?.nurse?.active ?? 0} />
          <Stat label="Patient portal accounts" value={u?.patient?.active ?? 0} />
          <Stat label="Departments" value={q.data.activeDepartments} />
          <Stat label="Active sessions" value={q.data.activeSessions} />
          <Stat label="Failed sign-ins (24 h)" value={q.data.failedLogins24h} />
          {q.data.queueToday && (
            <>
              <Stat label="OPD visits today" value={q.data.queueToday.total} hint={`${q.data.queueToday.waiting} waiting`} />
              <Stat label="Completed today" value={q.data.queueToday.completed} />
            </>
          )}
        </div>
      )}
      <SystemStatusPanel />
    </>
  )
}
