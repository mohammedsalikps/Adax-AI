import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  CalendarCheck,
  ClipboardList,
  FileText,
  FlaskConical,
  IdCard,
  MapPin,
  Phone,
  Pencil,
  Pill,
  ScanLine,
  SearchX,
  ShieldAlert,
  Stethoscope,
  TriangleAlert,
  UserSearch,
  Users,
} from 'lucide-react'
import {
  Badge,
  Button,
  Divider,
  Drawer,
  EmptyState,
  LoadingState,
  Panel,
  Table,
  type TableColumn,
} from '@/components/ui'
import {
  AllergyChip,
  ClinicalDataRow,
  PatientIdentityCard,
  LabReportList,
  SectionHeader,
  StudyReportList,
  VitalsTileGrid,
} from '@/components/clinical'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import {
  calculateAge,
  formatAbha,
  formatDate,
  formatDateTime,
  formatPhone,
} from '@/lib/format'
import { formatVitalValue } from '@/lib/vitals'
import { mockDb } from '@/mock/db'
import type { PastVisit } from '@/types/consultation'
import type { Patient, Sex } from '@/types/patient'
import type { CurrentMedication } from '@/types/prescription'
import type { VitalStatus, VitalsSnapshot } from '@/types/vitals'
import { EditPatientDrawer } from './EditPatientDrawer'

const SEX_LABEL: Record<Sex, string> = { male: 'Male', female: 'Female', other: 'Other' }

const STATUS_TEXT: Record<VitalStatus, string> = {
  normal: 'text-ink',
  caution: 'text-caution',
  critical: 'text-critical',
}

export function PatientProfilePage() {
  const { patientId = '' } = useParams<{ patientId: string }>()
  const navigate = useNavigate()

  const [editing, setEditing] = useState(false)
  const [savedPatient, setSavedPatient] = useState<Patient | null>(null)
  const [selectedVisit, setSelectedVisit] = useState<PastVisit | null>(null)

  const patientQuery = useAsyncData(
    () => mockDb.getPatient(patientId),
    `patient:${patientId}`,
  )
  const visitsQuery = useAsyncData(
    () => mockDb.listVisits(patientId),
    `visits:${patientId}`,
  )
  const medicationsQuery = useAsyncData(
    () => mockDb.listMedications(patientId),
    `medications:${patientId}`,
  )
  const vitalsQuery = useAsyncData(
    () => mockDb.listVitalsHistory(patientId),
    `vitals:${patientId}`,
  )
  const labsQuery = useAsyncData(
    () => mockDb.listLabReports(patientId),
    `labs:${patientId}`,
  )
  const studiesQuery = useAsyncData(
    () => mockDb.listStudyReports(patientId),
    `studies:${patientId}`,
  )
  const familyQuery = useAsyncData(
    () => mockDb.listFamilyHistory(patientId),
    `family:${patientId}`,
  )

  // A just-saved record wins over the loaded one, so the profile updates
  // immediately after editing without a second round trip.
  const patient =
    savedPatient?.id === patientId ? savedPatient : patientQuery.data

  useDocumentTitle(patient ? `${patient.fullName} · Patient Profile` : 'Patient Profile')

  if (patientQuery.loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <LoadingState label="Loading patient chart" />
      </div>
    )
  }

  if (patientQuery.error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Panel title="Chart unavailable" icon={TriangleAlert} tone="critical">
          <EmptyState
            icon={TriangleAlert}
            title="Could not load this chart"
            description={patientQuery.error}
            action={
              <Button size="sm" variant="secondary" onClick={patientQuery.reload}>
                Try again
              </Button>
            }
          />
        </Panel>
      </div>
    )
  }

  if (!patient) {
    return <PatientNotFound patientId={patientId} />
  }

  const age = calculateAge(patient.dateOfBirth)
  const latestVitals = vitalsQuery.data?.[0]

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={CalendarCheck}
          onClick={() => navigate('/')}
        >
          Today's Clinic
        </Button>
        <span aria-hidden className="text-ink-muted">
          /
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={UserSearch}
          onClick={() => navigate('/patients/search')}
        >
          Patient Search
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PatientIdentityCard
          patientId={patient.id}
          fullName={patient.fullName}
          age={age}
          sex={patient.sex}
          photoUrl={patient.photoUrl}
          bloodGroup={patient.bloodGroup}
          allergyCount={patient.allergies.length}
          onOpenProfile={() => setEditing(true)}
          className="lg:col-span-2"
        />

        <div className="flex flex-col justify-center gap-2 rounded-panel border border-line bg-surface p-3">
          <Button
            icon={Stethoscope}
            fullWidth
            onClick={() => navigate(`/consultation/${patient.id}`)}
          >
            Start consultation
          </Button>
          <Button variant="secondary" icon={Pencil} fullWidth onClick={() => setEditing(true)}>
            Edit patient
          </Button>
        </div>
      </div>

      {patient.allergies.length > 0 ? (
        <Panel title="Known allergies" icon={ShieldAlert} tone="critical" dense>
          <div className="flex flex-wrap gap-2">
            {patient.allergies.map((allergy) => (
              <AllergyChip
                key={allergy.id}
                substance={allergy.substance}
                severity={allergy.severity}
                reaction={allergy.reaction}
              />
            ))}
          </div>
        </Panel>
      ) : (
        <Panel title="Known allergies" icon={ShieldAlert} dense>
          <p className="text-xs text-ink-muted">No known allergies recorded.</p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ main column */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Panel
            title="Vitals"
            description={
              latestVitals
                ? `Last recorded ${formatDateTime(latestVitals.recordedAt)}`
                : undefined
            }
            icon={Activity}
          >
            {vitalsQuery.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Loading vitals" />
            ) : !latestVitals ? (
              <EmptyState
                size="sm"
                icon={Activity}
                title="No vitals recorded"
                description="Vitals appear here once reception records them."
              />
            ) : (
              <>
                <VitalsTileGrid snapshot={latestVitals} />
                {(vitalsQuery.data?.length ?? 0) > 1 && (
                  <>
                    <Divider label="Earlier recordings" className="my-4" />
                    <VitalsHistoryTable snapshots={vitalsQuery.data ?? []} />
                  </>
                )}
              </>
            )}
          </Panel>

          <Panel title="Current medications" icon={Pill} flush>
            {medicationsQuery.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Loading medications" />
            ) : (
              <MedicationsTable medications={medicationsQuery.data ?? []} />
            )}
          </Panel>

          <Panel
            title="Visit history"
            description="Select a visit to read the full summary"
            icon={ClipboardList}
            flush
          >
            {visitsQuery.loading ? (
              <LoadingState variant="skeleton" rows={3} label="Loading visit history" />
            ) : (
              <VisitsTable
                visits={visitsQuery.data ?? []}
                onSelect={(visit) => setSelectedVisit(visit)}
              />
            )}
          </Panel>
        </div>

        {/* ------------------------------------------------ side column */}
        <div className="min-w-0 space-y-4">
          <Panel title="Demographics" icon={IdCard} dense>
            <ClinicalDataRow label="Patient ID" value={patient.id} numeric emphasis dense />
            <ClinicalDataRow
              label="Date of birth"
              value={formatDate(patient.dateOfBirth)}
              hint={`${age} years old`}
              numeric
              dense
            />
            <ClinicalDataRow label="Gender" value={SEX_LABEL[patient.sex]} dense />
            <ClinicalDataRow
              label="Blood group"
              value={patient.bloodGroup ?? 'Not known'}
              dense
            />
            <ClinicalDataRow
              label="ABHA number"
              value={patient.abhaNumber ? formatAbha(patient.abhaNumber) : 'Not linked'}
              numeric
              dense
            />
            <ClinicalDataRow
              label="Registered"
              value={formatDate(patient.registeredOn)}
              numeric
              dense
            />
            <ClinicalDataRow
              label="Allergies"
              value={patient.allergies.length || 'None'}
              status={patient.allergies.length ? 'critical' : undefined}
              numeric
              dense
            />
            {(patient.heightCm || patient.weightKg) && (
              <ClinicalDataRow
                label="Height / weight"
                value={`${patient.heightCm ?? '—'} cm · ${patient.weightKg ?? '—'} kg`}
                numeric
                dense
              />
            )}
          </Panel>

          <Panel title="Contact" icon={Phone} dense>
            <ClinicalDataRow
              label="Mobile"
              value={formatPhone(patient.contact.phone)}
              numeric
              dense
            />
            <ClinicalDataRow
              label="Email"
              value={patient.contact.email ?? 'Not given'}
              dense
            />
            <ClinicalDataRow
              label="Address"
              icon={MapPin}
              layout="stacked"
              value={`${patient.contact.addressLine}, ${patient.contact.city}, ${patient.contact.state} ${patient.contact.pincode}`}
              dense
            />
          </Panel>

          <Panel title="Emergency contact" icon={Phone} dense>
            {patient.emergencyContact ? (
              <>
                <ClinicalDataRow
                  label="Name"
                  value={patient.emergencyContact.name}
                  emphasis
                  dense
                />
                <ClinicalDataRow
                  label="Relationship"
                  value={patient.emergencyContact.relationship}
                  dense
                />
                <ClinicalDataRow
                  label="Phone"
                  value={formatPhone(patient.emergencyContact.phone)}
                  numeric
                  dense
                />
              </>
            ) : (
              <p className="text-xs text-ink-muted">No emergency contact recorded.</p>
            )}
          </Panel>

          <Panel title="Existing conditions" icon={FileText} dense>
            {patient.chronicConditions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.chronicConditions.map((condition) => (
                  <Badge key={condition} size="md">
                    {condition}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-muted">No chronic conditions recorded.</p>
            )}
          </Panel>

          <Panel title="Family history" icon={Users} dense>
            {familyQuery.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Loading family history" />
            ) : (familyQuery.data ?? []).length > 0 ? (
              <ul className="space-y-2">
                {(familyQuery.data ?? []).map((entry) => (
                  <li key={entry.id} className="text-[12px]">
                    <span className="font-semibold text-ink">{entry.relation}</span>
                    <span className="text-ink-muted"> — </span>
                    <span className="text-ink-soft">{entry.condition}</span>
                    {entry.ageAtDiagnosis !== undefined && (
                      <span className="tnum text-ink-muted">
                        {' '}
                        (diagnosed at {entry.ageAtDiagnosis})
                      </span>
                    )}
                    {entry.note && (
                      <span className="block text-[11px] text-ink-muted">{entry.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-muted">No family history recorded.</p>
            )}
          </Panel>
        </div>
      </div>

      {/* Investigation records sit full width: lab panels and study reports
          need the room, and both are read during a consultation. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Panel title="Laboratory reports" icon={FlaskConical}>
          {labsQuery.loading ? (
            <LoadingState variant="skeleton" rows={2} label="Loading laboratory reports" />
          ) : (
            <LabReportList reports={labsQuery.data ?? []} />
          )}
        </Panel>

        <Panel title="Imaging and diagnostics" icon={ScanLine}>
          {studiesQuery.loading ? (
            <LoadingState variant="skeleton" rows={2} label="Loading study reports" />
          ) : (
            <StudyReportList reports={studiesQuery.data ?? []} />
          )}
        </Panel>
      </div>

      {editing && (
        <EditPatientDrawer
          patient={patient}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setSavedPatient(updated)}
        />
      )}

      <Drawer
        open={selectedVisit !== null}
        onClose={() => setSelectedVisit(null)}
        title={selectedVisit?.chiefComplaint ?? 'Visit'}
        description={
          selectedVisit
            ? `${formatDate(selectedVisit.visitedOn)} · ${selectedVisit.doctorName}`
            : undefined
        }
      >
        {selectedVisit && (
          <div className="space-y-1">
            <ClinicalDataRow
              label="Visit date"
              value={formatDate(selectedVisit.visitedOn)}
              numeric
              layout="stacked"
            />
            <ClinicalDataRow
              label="Reason for visit"
              value={selectedVisit.chiefComplaint}
              layout="stacked"
            />
            <ClinicalDataRow
              label="Diagnosis"
              value={selectedVisit.diagnosis}
              layout="stacked"
              emphasis
            />
            <ClinicalDataRow
              label="Summary"
              value={selectedVisit.summary}
              layout="stacked"
            />
            <ClinicalDataRow
              label="Seen by"
              value={selectedVisit.doctorName}
              layout="stacked"
            />
          </div>
        )}
      </Drawer>
    </div>
  )
}

/* ---------------------------------------------------------------- vitals */

function VitalsHistoryTable({ snapshots }: { snapshots: VitalsSnapshot[] }) {
  const columns: TableColumn<VitalsSnapshot>[] = [
    {
      key: 'recordedAt',
      header: 'Recorded',
      width: '160px',
      cellClassName: 'tnum whitespace-nowrap',
      render: (snapshot) => formatDateTime(snapshot.recordedAt),
    },
    {
      key: 'hr',
      header: 'HR',
      align: 'right',
      render: (snapshot) => <Reading snapshot={snapshot} keyName="heartRate" />,
    },
    {
      key: 'bp',
      header: 'BP',
      align: 'right',
      render: (snapshot) => {
        const systolic = snapshot.readings.systolicBp
        const diastolic = snapshot.readings.diastolicBp
        if (!systolic || !diastolic) return <span className="text-ink-muted">—</span>
        const worst =
          systolic.status === 'critical' || diastolic.status === 'critical'
            ? 'critical'
            : systolic.status === 'caution' || diastolic.status === 'caution'
              ? 'caution'
              : 'normal'
        return (
          <span className={cn('tnum font-medium', STATUS_TEXT[worst])}>
            {systolic.value}/{diastolic.value}
          </span>
        )
      },
    },
    {
      key: 'spo2',
      header: 'SpO₂',
      align: 'right',
      render: (snapshot) => <Reading snapshot={snapshot} keyName="spo2" />,
    },
    {
      key: 'temp',
      header: 'Temp',
      align: 'right',
      render: (snapshot) => <Reading snapshot={snapshot} keyName="temperature" />,
    },
    {
      key: 'rr',
      header: 'RR',
      align: 'right',
      render: (snapshot) => <Reading snapshot={snapshot} keyName="respiratoryRate" />,
    },
    {
      key: 'glucose',
      header: 'Glucose',
      align: 'right',
      render: (snapshot) => <Reading snapshot={snapshot} keyName="bloodGlucose" />,
    },
  ]

  return (
    <Table
      columns={columns}
      rows={snapshots}
      getRowId={(snapshot) => snapshot.recordedAt}
      dense
      caption="Previously recorded vitals"
    />
  )
}

function Reading({
  snapshot,
  keyName,
}: {
  snapshot: VitalsSnapshot
  keyName: keyof VitalsSnapshot['readings']
}) {
  const reading = snapshot.readings[keyName]
  if (!reading) return <span className="text-ink-muted">—</span>
  return (
    <span className={cn('tnum font-medium', STATUS_TEXT[reading.status])}>
      {formatVitalValue(reading.key, reading.value)}
    </span>
  )
}

/* ----------------------------------------------------------- medications */

function MedicationsTable({ medications }: { medications: CurrentMedication[] }) {
  const columns: TableColumn<CurrentMedication>[] = [
    {
      key: 'drug',
      header: 'Medication',
      render: (medication) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {medication.brandName} {medication.strength}
          </p>
          <p className="truncate text-[11px] text-ink-muted">{medication.genericName}</p>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      width: '170px',
      render: (medication) => (
        <span className="whitespace-nowrap">
          {medication.frequency} · {medication.timing}
        </span>
      ),
    },
    {
      key: 'startedOn',
      header: 'Started',
      width: '110px',
      cellClassName: 'tnum whitespace-nowrap',
      render: (medication) => formatDate(medication.startedOn),
    },
    {
      key: 'prescriber',
      header: 'Prescribed by',
      width: '160px',
      render: (medication) => medication.prescribedBy,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      width: '100px',
      render: (medication) =>
        medication.active ? (
          <Badge variant="normal">Active</Badge>
        ) : (
          <Badge>Stopped</Badge>
        ),
    },
  ]

  return (
    <Table
      columns={columns}
      rows={medications}
      getRowId={(medication) => medication.id}
      dense
      caption="Medications recorded on this chart"
      emptyState={
        <EmptyState
          size="sm"
          icon={Pill}
          title="No medications recorded"
          description="Nothing is currently prescribed on this chart."
        />
      }
    />
  )
}

/* ---------------------------------------------------------------- visits */

function VisitsTable({
  visits,
  onSelect,
}: {
  visits: PastVisit[]
  onSelect: (visit: PastVisit) => void
}) {
  const columns: TableColumn<PastVisit>[] = [
    {
      key: 'visitedOn',
      header: 'Date',
      width: '110px',
      cellClassName: 'tnum whitespace-nowrap',
      render: (visit) => <span className="font-medium text-ink">{formatDate(visit.visitedOn)}</span>,
    },
    {
      key: 'complaint',
      header: 'Reason for visit',
      render: (visit) => visit.chiefComplaint,
    },
    {
      key: 'diagnosis',
      header: 'Diagnosis',
      render: (visit) => <span className="text-ink">{visit.diagnosis}</span>,
    },
    {
      key: 'doctor',
      header: 'Seen by',
      width: '150px',
      render: (visit) => visit.doctorName,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '110px',
      render: (visit) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => onSelect(visit)}>
            Summary
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Table
      columns={columns}
      rows={visits}
      getRowId={(visit) => visit.id}
      onRowClick={onSelect}
      dense
      caption="Previous visits"
      emptyState={
        <EmptyState
          size="sm"
          icon={ClipboardList}
          title="No previous visits"
          description="This patient has no recorded consultations yet."
        />
      }
    />
  )
}

/* ------------------------------------------------------------- not found */

function PatientNotFound({ patientId }: { patientId: string }) {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <SectionHeader
        title="Patient Profile"
        description="No chart matches this identifier."
        icon={IdCard}
        size="lg"
        className="mb-4"
      />
      <Panel title="Patient not found" icon={SearchX} tone="critical">
        <EmptyState
          icon={SearchX}
          title="No patient with this ID"
          description={`Nothing in the directory matches "${patientId}". Check the identifier, or search the directory by name or phone number.`}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" icon={UserSearch} onClick={() => navigate('/patients/search')}>
                Back to Patient Search
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={CalendarCheck}
                onClick={() => navigate('/')}
              >
                Today's Clinic
              </Button>
            </div>
          }
        />
      </Panel>
    </div>
  )
}
