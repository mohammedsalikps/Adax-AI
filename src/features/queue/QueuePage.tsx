import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  CalendarCheck,
  ClipboardList,
  FileText,
  Stethoscope,
  TriangleAlert,
  UserPlus,
} from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  Table,
  Tabs,
  useToast,
  type TableColumn,
} from '@/components/ui'
import { PatientChip, SectionHeader, StatusBadge } from '@/components/clinical'
import { useAsyncData } from '@/hooks/useAsyncData'
import { calculateAge, formatLongDate, formatTime } from '@/lib/format'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { mockDb, type QueueEntry } from '@/mock/db'
import type { AppointmentStatus } from '@/types/appointment'

type QueueFilter = 'all' | AppointmentStatus

export function QueuePage() {
  useDocumentTitle("Today's Clinic")

  const navigate = useNavigate()
  const { showToast } = useToast()
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [startingId, setStartingId] = useState<string | null>(null)

  const { data, loading, error, reload } = useAsyncData(
    () => mockDb.listQueue(),
    'queue',
  )

  const entries = useMemo(() => data ?? [], [data])

  const counts = useMemo(
    () => ({
      all: entries.length,
      waiting: entries.filter((e) => e.appointment.status === 'waiting').length,
      'in-consultation': entries.filter(
        (e) => e.appointment.status === 'in-consultation',
      ).length,
      completed: entries.filter((e) => e.appointment.status === 'completed').length,
    }),
    [entries],
  )

  const visibleEntries = useMemo(
    () =>
      filter === 'all'
        ? entries
        : entries.filter((entry) => entry.appointment.status === filter),
    [entries, filter],
  )

  async function startConsultation(entry: QueueEntry) {
    setStartingId(entry.appointment.id)
    await mockDb.updateAppointmentStatus(entry.appointment.id, 'in-consultation')
    setStartingId(null)
    showToast({
      title: `Consultation started — ${entry.patient.fullName}`,
      description: `${entry.patient.id} · marked in consultation.`,
      status: 'info',
    })
    navigate(`/consultation/${entry.patient.id}`)
  }

  const columns: TableColumn<QueueEntry>[] = [
    {
      key: 'slot',
      header: 'Slot',
      width: '104px',
      cellClassName: 'tnum whitespace-nowrap',
      render: ({ appointment }) => (
        <span className="font-medium text-ink">{formatTime(appointment.slotAt)}</span>
      ),
    },
    {
      key: 'patient',
      header: 'Patient',
      width: '220px',
      render: ({ patient }) => (
        <PatientChip
          patientId={patient.id}
          fullName={patient.fullName}
          photoUrl={patient.photoUrl}
          age={calculateAge(patient.dateOfBirth)}
          sex={patient.sex}
          size="sm"
        />
      ),
    },
    {
      key: 'complaint',
      header: 'Chief complaint',
      render: ({ appointment, patient }) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{appointment.chiefComplaint}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={appointment.visitType === 'first-visit' ? 'accent' : 'neutral'}>
              {appointment.visitType === 'first-visit' ? 'First visit' : 'Follow-up'}
            </Badge>
            {patient.allergies.length > 0 && (
              <Badge variant="critical" icon={TriangleAlert}>
                {patient.allergies.length}
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'vitals',
      header: 'Vitals',
      align: 'center',
      width: '110px',
      render: ({ appointment }) =>
        appointment.vitalsRecorded ? (
          <Badge variant="normal">Recorded</Badge>
        ) : (
          <Badge variant="caution">Pending</Badge>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      width: '150px',
      render: ({ appointment }) => <StatusBadge status={appointment.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '210px',
      render: (entry) => (
        <div
          className="flex items-center justify-end gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            icon={FileText}
            onClick={() => navigate(`/patients/${entry.patient.id}`)}
          >
            Chart
          </Button>
          {entry.appointment.status === 'completed' ? (
            <Button size="sm" variant="secondary" disabled>
              Completed
            </Button>
          ) : (
            <Button
              size="sm"
              icon={Stethoscope}
              loading={startingId === entry.appointment.id}
              onClick={() => void startConsultation(entry)}
            >
              {entry.appointment.status === 'in-consultation' ? 'Resume' : 'Start'}
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <SectionHeader
        title="Today's Clinic"
        description={formatLongDate(new Date())}
        icon={CalendarCheck}
        size="lg"
        actions={
          <Button icon={UserPlus} onClick={() => navigate('/patients/new')}>
            Register patient
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Scheduled" value={counts.all} />
        <SummaryTile label="Waiting" value={counts.waiting} tone="caution" />
        <SummaryTile label="In consultation" value={counts['in-consultation']} tone="accent" />
        <SummaryTile label="Completed" value={counts.completed} tone="normal" />
      </div>

      <Panel
        title="Appointment queue"
        icon={Activity}
        flush
        actions={
          <Tabs
            ariaLabel="Filter appointments by status"
            variant="segmented"
            size="sm"
            value={filter}
            onValueChange={(value) => setFilter(value as QueueFilter)}
            items={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'waiting', label: 'Waiting', count: counts.waiting },
              {
                value: 'in-consultation',
                label: 'In consultation',
                count: counts['in-consultation'],
              },
              { value: 'completed', label: 'Done', count: counts.completed },
            ]}
          />
        }
      >
        {error ? (
          <EmptyState
            icon={TriangleAlert}
            title="Could not load the schedule"
            description={error}
            action={
              <Button size="sm" variant="secondary" onClick={reload}>
                Try again
              </Button>
            }
          />
        ) : (
          <Table
            columns={columns}
            rows={visibleEntries}
            loading={loading}
            getRowId={(entry) => entry.appointment.id}
            onRowClick={(entry) => navigate(`/patients/${entry.patient.id}`)}
            caption="Today's appointment queue"
            emptyState={
              <EmptyState
                icon={ClipboardList}
                size="sm"
                title={
                  filter === 'all'
                    ? 'No appointments today'
                    : 'Nothing in this category'
                }
                description={
                  filter === 'all'
                    ? 'The clinic schedule is clear.'
                    : 'Switch to another filter to see the rest of the queue.'
                }
              />
            }
          />
        )}
      </Panel>
    </div>
  )
}

const TONE_CLASSES = {
  neutral: 'text-ink',
  accent: 'text-accent-ink',
  normal: 'text-normal',
  caution: 'text-caution',
} as const

function SummaryTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: keyof typeof TONE_CLASSES
}) {
  return (
    <div className="rounded-panel border border-line bg-surface px-3.5 py-3">
      <p className="text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
        {label}
      </p>
      <p className={`tnum mt-0.5 text-2xl font-semibold ${TONE_CLASSES[tone]}`}>
        {value}
      </p>
    </div>
  )
}
