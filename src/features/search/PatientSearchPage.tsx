import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  Search,
  Stethoscope,
  TriangleAlert,
  UserPlus,
  UserSearch,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingState,
  Panel,
  Table,
  type TableColumn,
} from '@/components/ui'
import { PatientChip, SectionHeader, StatusBadge } from '@/components/clinical'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { calculateAge, formatDate } from '@/lib/format'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { mockDb } from '@/mock/db'
import type { Patient, Sex } from '@/types/patient'
import type { AppointmentStatus } from '@/types/appointment'

const SEX_LABEL: Record<Sex, string> = { male: 'Male', female: 'Female', other: 'Other' }

export function PatientSearchPage() {
  useDocumentTitle('Find Patient')

  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 300)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useAsyncData(
    () => mockDb.searchPatients(debouncedQuery),
    `search:${debouncedQuery}`,
  )

  // Today's schedule, so each result can show its live clinic status.
  const queue = useAsyncData(() => mockDb.listQueue(), 'search-queue')

  const statusByPatient = useMemo(() => {
    const map = new Map<string, AppointmentStatus>()
    for (const entry of queue.data ?? []) {
      map.set(entry.patient.id, entry.appointment.status)
    }
    return map
  }, [queue.data])

  const hasQuery = debouncedQuery.length > 0
  const patients = results.data ?? []
  const searching = hasQuery && results.loading

  function clearSearch() {
    setQuery('')
    inputRef.current?.focus()
  }

  const columns: TableColumn<Patient>[] = [
    {
      key: 'patient',
      header: 'Patient',
      width: '230px',
      render: (patient) => (
        <PatientChip
          patientId={patient.id}
          fullName={patient.fullName}
          photoUrl={patient.photoUrl}
          size="sm"
        />
      ),
    },
    {
      key: 'demographics',
      header: 'Age / Sex',
      width: '110px',
      cellClassName: 'tnum whitespace-nowrap',
      render: (patient) =>
        `${calculateAge(patient.dateOfBirth)}y · ${SEX_LABEL[patient.sex]}`,
    },
    {
      key: 'condition',
      header: 'Main condition',
      render: (patient) => <ConditionSummary patient={patient} />,
    },
    {
      key: 'lastVisit',
      header: 'Last visit',
      width: '120px',
      cellClassName: 'tnum whitespace-nowrap',
      render: (patient) =>
        patient.lastVisitOn ? (
          formatDate(patient.lastVisitOn)
        ) : (
          <span className="text-ink-muted">No visits</span>
        ),
    },
    {
      key: 'allergies',
      header: 'Allergies',
      align: 'center',
      width: '110px',
      render: (patient) => <AllergyIndicator patient={patient} />,
    },
    {
      key: 'status',
      header: 'Today',
      align: 'center',
      width: '150px',
      render: (patient) => <TodayStatus status={statusByPatient.get(patient.id)} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '220px',
      render: (patient) => (
        <div
          className="flex items-center justify-end gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            icon={FileText}
            onClick={() => navigate(`/patients/${patient.id}`)}
          >
            Profile
          </Button>
          <Button
            size="sm"
            icon={Stethoscope}
            onClick={() => navigate(`/consultation/${patient.id}`)}
          >
            Consult
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <SectionHeader
        title="Find Patient"
        description="Search the clinic directory by name, patient ID, phone number or ABHA number."
        icon={UserSearch}
        size="lg"
        actions={
          <Button
            variant="secondary"
            icon={UserPlus}
            onClick={() => navigate('/patients/new')}
          >
            Register
          </Button>
        }
      />

      <div className="flex items-end gap-2">
        <Input
          ref={inputRef}
          label="Search"
          size="lg"
          icon={Search}
          autoFocus
          value={query}
          placeholder="Ramesh, PT-2026-00142, 9845012345 or ABHA number"
          hint="Matches name, patient ID, 10-digit phone or 14-digit ABHA number."
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault()
              clearSearch()
            }
          }}
        />
        <Button
          variant="secondary"
          size="lg"
          icon={X}
          onClick={clearSearch}
          disabled={!query}
          className="mb-[22px]"
        >
          Clear
        </Button>
      </div>

      <Panel
        title="Results"
        icon={UserSearch}
        flush
        actions={
          hasQuery && !results.loading && !results.error ? (
            <Badge>
              {patients.length} {patients.length === 1 ? 'match' : 'matches'}
            </Badge>
          ) : null
        }
      >
        {results.error ? (
          <EmptyState
            icon={TriangleAlert}
            title="Search failed"
            description={results.error}
            action={
              <Button size="sm" variant="secondary" onClick={results.reload}>
                Try again
              </Button>
            }
          />
        ) : !hasQuery ? (
          <EmptyState
            icon={Search}
            title="Search for a patient"
            description="Enter a name, clinic patient ID, phone number or ABHA number to begin."
          />
        ) : searching ? (
          <LoadingState variant="skeleton" rows={3} label="Searching the directory" />
        ) : patients.length === 0 ? (
          <EmptyState
            icon={UserSearch}
            title="No patient found"
            description={`Nothing in the directory matches "${debouncedQuery}".`}
            action={
              <Button size="sm" icon={UserPlus} onClick={() => navigate('/patients/new')}>
                Register this patient
              </Button>
            }
          />
        ) : (
          <>
            {/* Table for pointer-sized screens */}
            <div className="hidden md:block">
              <Table
                columns={columns}
                rows={patients}
                getRowId={(patient) => patient.id}
                onRowClick={(patient) => navigate(`/patients/${patient.id}`)}
                caption="Patient search results"
              />
            </div>

            {/* Stacked cards below the table breakpoint */}
            <ul className="divide-y divide-line md:hidden">
              {patients.map((patient) => (
                <li key={patient.id} className="p-3.5">
                  <PatientResultCard
                    patient={patient}
                    status={statusByPatient.get(patient.id)}
                    onOpenProfile={() => navigate(`/patients/${patient.id}`)}
                    onStartConsultation={() => navigate(`/consultation/${patient.id}`)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  )
}

function ConditionSummary({ patient }: { patient: Patient }) {
  const [primary, ...rest] = patient.chronicConditions

  if (!primary) {
    return <span className="text-ink-muted">None recorded</span>
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="truncate text-ink">{primary}</span>
      {rest.length > 0 && (
        <span title={rest.join(', ')}>
          <Badge>+{rest.length}</Badge>
        </span>
      )}
    </span>
  )
}

function AllergyIndicator({ patient }: { patient: Patient }) {
  if (patient.allergies.length === 0) {
    return <Badge variant="normal">None</Badge>
  }

  const hasSevere = patient.allergies.some((allergy) => allergy.severity === 'severe')

  return (
    <span
      title={patient.allergies
        .map((allergy) => `${allergy.substance} (${allergy.severity})`)
        .join(', ')}
    >
      <Badge variant={hasSevere ? 'critical' : 'caution'} icon={TriangleAlert}>
        {patient.allergies.length}
      </Badge>
    </span>
  )
}

function TodayStatus({ status }: { status?: AppointmentStatus }) {
  if (!status) {
    return <span className="text-[11px] text-ink-muted">Not scheduled</span>
  }
  return <StatusBadge status={status} />
}

function PatientResultCard({
  patient,
  status,
  onOpenProfile,
  onStartConsultation,
}: {
  patient: Patient
  status?: AppointmentStatus
  onOpenProfile: () => void
  onStartConsultation: () => void
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <PatientChip
          patientId={patient.id}
          fullName={patient.fullName}
          photoUrl={patient.photoUrl}
          age={calculateAge(patient.dateOfBirth)}
          sex={patient.sex}
        />
        <TodayStatus status={status} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-soft">
        <ConditionSummary patient={patient} />
        <span className="tnum text-ink-muted">
          {patient.lastVisitOn ? `Last visit ${formatDate(patient.lastVisitOn)}` : 'No visits'}
        </span>
        <AllergyIndicator patient={patient} />
      </div>

      {/* Grid rather than flex: two full-width buttons in a flex row each
          demand 100% of the container and overflow it. */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" icon={FileText} onClick={onOpenProfile}>
          Profile
        </Button>
        <Button size="sm" icon={Stethoscope} onClick={onStartConsultation}>
          Consult
        </Button>
      </div>
    </div>
  )
}
