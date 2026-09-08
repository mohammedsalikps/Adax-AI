import { useState } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import type { ReactNode } from 'react'
import {
  Activity,
  Beaker,
  Droplet,
  FileText,
  Gauge,
  HeartPulse,
  Pill,
  Plus,
  Save,
  Search,
  Share2,
  Sparkles,
  Thermometer,
  TriangleAlert,
  UserPlus,
  Wind,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Divider,
  Drawer,
  EmptyState,
  Input,
  LoadingState,
  Modal,
  Panel,
  Select,
  Table,
  Tabs,
  Textarea,
  Toast,
  useToast,
  type TableColumn,
} from '@/components/ui'
import {
  AllergyChip,
  ClinicalDataRow,
  PatientChip,
  PatientIdentityCard,
  SectionHeader,
  StatusBadge,
  VitalTile,
  type ClinicalStatus,
} from '@/components/clinical'
import type { Sex } from '@/types/patient'

/* ------------------------------------------------------------------
   Temporary component gallery. Demonstration data only — nothing here
   is connected to a data source. Removed once the real screens exist.
------------------------------------------------------------------ */

interface DemoQueueRow {
  id: string
  patientId: string
  fullName: string
  age: number
  sex: Sex
  complaint: string
  status: ClinicalStatus
  slot: string
}

const DEMO_QUEUE: DemoQueueRow[] = [
  {
    id: '1',
    patientId: 'PT-2026-00142',
    fullName: 'Ramesh Iyer',
    age: 54,
    sex: 'male',
    complaint: 'Diabetes review, fatigue',
    status: 'in-consultation',
    slot: '10:30 AM',
  },
  {
    id: '2',
    patientId: 'PT-2026-00118',
    fullName: 'Meera Nair',
    age: 38,
    sex: 'female',
    complaint: 'Recurrent migraine',
    status: 'waiting',
    slot: '10:45 AM',
  },
  {
    id: '3',
    patientId: 'PT-2026-00097',
    fullName: 'Arjun Deshpande',
    age: 61,
    sex: 'male',
    complaint: 'Post-operative follow-up',
    status: 'completed',
    slot: '09:15 AM',
  },
]

const QUEUE_COLUMNS: TableColumn<DemoQueueRow>[] = [
  {
    key: 'patient',
    header: 'Patient',
    render: (row) => (
      <PatientChip
        patientId={row.patientId}
        fullName={row.fullName}
        age={row.age}
        sex={row.sex}
        size="sm"
      />
    ),
  },
  { key: 'complaint', header: 'Chief complaint', render: (row) => row.complaint },
  {
    key: 'slot',
    header: 'Slot',
    align: 'right',
    width: '96px',
    cellClassName: 'tnum',
    render: (row) => row.slot,
  },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    width: '150px',
    render: (row) => <StatusBadge status={row.status} />,
  },
]

const SPECIALTY_OPTIONS = [
  { value: 'general', label: 'General Medicine' },
  { value: 'cardiology', label: 'Cardiology' },
  { value: 'endocrinology', label: 'Endocrinology' },
  { value: 'orthopaedics', label: 'Orthopaedics (unavailable)', disabled: true },
]

function Showcase({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="scroll-mt-6">
      <SectionHeader title={title} description={description} divided />
      <div className="pt-4">{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>
}

export function ComponentShowcasePage() {
  useDocumentTitle('Component Library')

  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState('overview')
  const [notes, setNotes] = useState('Patient reports intermittent fatigue over three weeks.')
  const { showToast } = useToast()

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Component Library
          </h1>
          <Badge variant="ai">Temporary — Step 2</Badge>
        </div>
        <p className="mt-1 max-w-2xl text-ink-soft">
          Every reusable primitive and clinical component in the doctor console,
          rendered with demonstration data. This page is a development aid and is
          removed before the application ships.
        </p>
      </header>

      {/* ---------------------------------------------------------- Tokens */}
      <Showcase
        title="Design tokens"
        description="Neutral surfaces, one teal accent, and semantic colours reserved strictly for clinical status."
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { name: 'canvas', className: 'bg-canvas' },
            { name: 'surface', className: 'bg-surface' },
            { name: 'sunken', className: 'bg-surface-sunken' },
            { name: 'accent', className: 'bg-accent' },
            { name: 'normal', className: 'bg-normal' },
            { name: 'caution', className: 'bg-caution' },
            { name: 'critical', className: 'bg-critical' },
          ].map((token) => (
            <div key={token.name} className="overflow-hidden rounded-control border border-line">
              <div className={`h-12 ${token.className}`} />
              <p className="bg-surface px-2 py-1.5 text-[11px] font-medium text-ink-soft">
                {token.name}
              </p>
            </div>
          ))}
        </div>
      </Showcase>

      {/* --------------------------------------------------------- Buttons */}
      <Showcase
        title="Button"
        description="Four variants, three sizes, plus loading, disabled and icon-only states."
      >
        <div className="space-y-3">
          <Row>
            <Button variant="primary">Start consultation</Button>
            <Button variant="secondary">Open chart</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Discard visit</Button>
          </Row>
          <Row>
            <Button size="sm" icon={Plus}>
              Small
            </Button>
            <Button size="md" icon={Save}>
              Medium
            </Button>
            <Button size="lg" icon={Share2}>
              Large
            </Button>
            <Button icon={Search} iconPosition="right" variant="secondary">
              Trailing icon
            </Button>
          </Row>
          <Row>
            <Button loading>Saving</Button>
            <Button variant="secondary" loading>
              Generating summary
            </Button>
            <Button disabled>Disabled</Button>
            <Button variant="secondary" disabled icon={Pill}>
              Disabled
            </Button>
            <Button iconOnly icon={Plus} aria-label="Add item" />
            <Button variant="secondary" iconOnly icon={Search} aria-label="Search" />
          </Row>
        </div>
      </Showcase>

      {/* ------------------------------------------------- Badges & status */}
      <Showcase
        title="Badge and clinical status"
        description="StatusBadge is the single source of truth for status colour across the application."
      >
        <div className="space-y-3">
          <Row>
            <Badge>Neutral</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="normal" dot>
              Normal
            </Badge>
            <Badge variant="caution" dot>
              Borderline
            </Badge>
            <Badge variant="critical" icon={TriangleAlert}>
              Critical
            </Badge>
            <Badge variant="ai" icon={Sparkles}>
              AI generated
            </Badge>
          </Row>
          <Row>
            <StatusBadge status="waiting" />
            <StatusBadge status="in-consultation" />
            <StatusBadge status="completed" />
            <StatusBadge status="normal" />
            <StatusBadge status="caution" />
            <StatusBadge status="critical" />
            <StatusBadge status="ai-draft" />
            <StatusBadge status="accepted" />
            <StatusBadge status="rejected" />
            <StatusBadge status="waiting" label="Awaiting vitals" size="md" />
          </Row>
        </div>
      </Showcase>

      {/* -------------------------------------------------- Cards & panels */}
      <Showcase
        title="Card and Panel"
        description="Card is a generic surface. Panel is the titled clinical region the dashboard columns are built from."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Last HbA1c</CardTitle>
              <CardDescription>Recorded 12/06/2026</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="tnum text-2xl font-semibold text-caution">8.2%</p>
              <p className="mt-1 text-xs text-ink-muted">Target below 7.0%</p>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="secondary">
                View trend
              </Button>
            </CardFooter>
          </Card>

          <Panel
            title="Doctor notes"
            description="SOAP format"
            icon={FileText}
            actions={<Button size="sm" variant="ghost" icon={Save} aria-label="Save notes" iconOnly />}
            footer={<span className="text-[11px] text-ink-muted">Autosaved 10:42 AM</span>}
          >
            <ClinicalDataRow label="Subjective" value="Fatigue, foot numbness" layout="stacked" />
            <Divider className="my-1" />
            <ClinicalDataRow label="Assessment" value="Suboptimal glycaemic control" layout="stacked" />
          </Panel>

          <Panel
            title="AI-assisted summary"
            description="Requires physician review"
            icon={Sparkles}
            tone="ai"
            actions={<StatusBadge status="ai-draft" />}
          >
            <p className="text-ink-soft">
              54-year-old with an 8-year history of type 2 diabetes attending a
              three-month review. Reports fatigue and intermittent foot numbness.
            </p>
          </Panel>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Critical alert" icon={TriangleAlert} tone="critical">
            <p className="text-ink-soft">
              Header tone marks severity; the body stays neutral so clinical content
              is never rendered on a coloured background.
            </p>
          </Panel>
          <Panel title="Dense list" icon={Gauge} tone="accent" dense>
            <ClinicalDataRow label="Height" value="172 cm" numeric dense />
            <ClinicalDataRow label="Weight" value="81.4 kg" numeric dense />
            <ClinicalDataRow label="BMI" value="27.5" status="caution" numeric dense hint="Overweight" />
          </Panel>
        </div>
      </Showcase>

      {/* ----------------------------------------------------------- Forms */}
      <Showcase
        title="Input, Select and Textarea"
        description="One shared field wrapper, so labels, hints and validation behave identically everywhere."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Input label="Patient name" placeholder="Full name as per records" required />
          <Input label="Search" icon={Search} placeholder="Patient ID or phone" />
          <Input
            label="Fasting glucose"
            defaultValue="148"
            suffix="mg/dL"
            numeric
            hint="Reference range 70–100 mg/dL"
          />
          <Input
            label="ABHA number"
            defaultValue="12-3456"
            error="ABHA number must be 14 digits."
          />
          <Input label="Registered on" defaultValue="12/06/2026" disabled />
          <Input label="Small size" size="sm" placeholder="Compact control" />
          <Select label="Specialty" options={SPECIALTY_OPTIONS} defaultValue="general" />
          <Select
            label="Blood group"
            options={[
              { value: 'o+', label: 'O positive' },
              { value: 'a+', label: 'A positive' },
              { value: 'b+', label: 'B positive' },
            ]}
            placeholder="Select blood group"
            defaultValue=""
            error="Blood group is required."
          />
          <Select label="Disabled" options={SPECIALTY_OPTIONS} disabled defaultValue="general" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Textarea
            label="Consultation notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={280}
            showCount
            hint="Visible to the doctor only."
          />
          <Textarea
            label="Locked note"
            defaultValue="Signed and locked after the visit was finalised."
            disabled
            resize="none"
          />
        </div>
      </Showcase>

      {/* ------------------------------------------------------------ Tabs */}
      <Showcase
        title="Tabs"
        description="Underline and segmented variants, with arrow-key navigation and roving focus."
      >
        <div className="space-y-5">
          <div>
            <Tabs
              ariaLabel="Patient chart sections"
              value={tab}
              onValueChange={setTab}
              items={[
                { value: 'overview', label: 'Overview', icon: Activity },
                { value: 'history', label: 'Visit history', icon: FileText, count: 12 },
                { value: 'meds', label: 'Medications', icon: Pill, count: 4 },
                { value: 'labs', label: 'Investigations', icon: Beaker },
                { value: 'docs', label: 'Documents', disabled: true },
              ]}
            />
            <p className="mt-3 text-xs text-ink-muted">
              Selected tab: <span className="font-semibold text-ink-soft">{tab}</span>
            </p>
          </div>

          <Tabs
            ariaLabel="Transcript view"
            variant="segmented"
            size="sm"
            className="max-w-xs"
            items={[
              { value: 'transcript', label: 'Transcript' },
              { value: 'notes', label: 'Notes' },
            ]}
          />
        </div>
      </Showcase>

      {/* -------------------------------------------------------- Overlays */}
      <Showcase
        title="Modal, Drawer and Toast"
        description="Escape closes, background scrolling locks, and focus returns to the trigger on close."
      >
        <Row>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              showToast({
                title: 'Visit saved',
                description: 'Consultation record stored locally.',
                status: 'success',
              })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              showToast({
                title: 'Allergy conflict',
                description: 'Patient has a recorded penicillin allergy.',
                status: 'error',
              })
            }
          >
            Error toast
          </Button>
        </Row>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Toast title="Recording started" status="info" />
          <Toast title="Notes autosaved" status="success" />
          <Toast title="Weak signal" description="Device reading unstable." status="warning" />
          <Toast title="Save failed" description="Retry the save action." status="error" />
        </div>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Confirm prescription"
          description="Review the medication list before signing."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setModalOpen(false)
                  showToast({ title: 'Prescription signed', status: 'success' })
                }}
              >
                Sign and issue
              </Button>
            </>
          }
        >
          <div className="space-y-1">
            <ClinicalDataRow label="Glycomet 500 mg" value="1 tablet · BD · after food · 30 days" />
            <ClinicalDataRow label="Telma 40 mg" value="1 tablet · OD · before food · 30 days" />
            <ClinicalDataRow label="Follow-up" value="08/12/2026" emphasis />
          </div>
        </Modal>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Past visit"
          description="12 June 2026 · Dr Ananya Rao"
          footer={
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-1">
            <ClinicalDataRow label="Chief complaint" value="Routine diabetes review" layout="stacked" />
            <ClinicalDataRow label="Diagnosis" value="Type 2 diabetes mellitus, hypertension" layout="stacked" />
            <ClinicalDataRow label="HbA1c" value="8.2%" status="caution" numeric layout="stacked" />
          </div>
        </Drawer>
      </Showcase>

      {/* ----------------------------------------------------------- Table */}
      <Showcase
        title="Table"
        description="Generic and typed — column renderers are checked against the row shape."
      >
        <Panel title="Today's clinic" icon={Activity} flush>
          <Table
            columns={QUEUE_COLUMNS}
            rows={DEMO_QUEUE}
            getRowId={(row) => row.id}
            onRowClick={(row) =>
              showToast({ title: `Opened ${row.fullName}`, status: 'info' })
            }
            caption="Demonstration appointment queue"
          />
        </Panel>
      </Showcase>

      {/* ------------------------------------------------------- Clinical */}
      <Showcase
        title="Patient identity and allergies"
        description="The identity card sits top-right on the consultation dashboard; the photo opens the profile."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PatientIdentityCard
            patientId="PT-2026-00142"
            fullName="Ramesh Iyer"
            age={54}
            sex="male"
            bloodGroup="O+"
            allergyCount={2}
            onOpenProfile={() =>
              showToast({ title: 'Patient profile', description: 'Opens in Step 4.', status: 'info' })
            }
          />
          <PatientIdentityCard
            patientId="PT-2026-00118"
            fullName="Meera Nair"
            age={38}
            sex="female"
            bloodGroup="A+"
            allergyCount={0}
            size="sm"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Known allergies" icon={TriangleAlert} tone="critical">
            <div className="flex flex-wrap gap-2">
              <AllergyChip substance="Penicillin" severity="severe" reaction="Anaphylaxis" />
              <AllergyChip substance="Sulfa drugs" severity="moderate" reaction="Skin rash" />
              <AllergyChip substance="Dust mites" severity="mild" reaction="Sneezing" />
              <AllergyChip
                substance="Peanuts"
                severity="moderate"
                reaction="Swelling"
                onRemove={() => showToast({ title: 'Allergy removed', status: 'warning' })}
              />
            </div>
          </Panel>

          <Panel title="Patient references" icon={UserPlus}>
            <div className="flex flex-col gap-1">
              <PatientChip
                patientId="PT-2026-00142"
                fullName="Ramesh Iyer"
                age={54}
                sex="male"
                selected
                onClick={() => undefined}
              />
              <PatientChip
                patientId="PT-2026-00118"
                fullName="Meera Nair"
                age={38}
                sex="female"
                onClick={() => undefined}
              />
              <Divider className="my-2" label="Avatar sizes" />
              <Row>
                <Avatar name="Ramesh Iyer" size="xs" />
                <Avatar name="Meera Nair" size="sm" />
                <Avatar name="Arjun Deshpande" size="md" />
                <Avatar name="Ananya Rao" size="lg" />
                <Avatar name="Vikram Sethi" size="xl" shape="rounded" />
              </Row>
            </div>
          </Panel>
        </div>
      </Showcase>

      {/* ---------------------------------------------------------- Vitals */}
      <Showcase
        title="Vital tiles and clinical data rows"
        description="Status drives colour; every measurement uses tabular figures so digits do not shift."
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <VitalTile label="Heart rate" value={78} unit="bpm" icon={HeartPulse} trend="steady" hint="60–100" />
          <VitalTile label="BP" value="148/92" unit="mmHg" status="caution" trend="up" hint="Above target" />
          <VitalTile label="SpO₂" value={91} unit="%" status="critical" icon={Wind} trend="down" hint="Below 94%" />
          <VitalTile label="Temp" value="37.1" unit="°C" icon={Thermometer} hint="36.1–37.2" />
          <VitalTile label="Resp rate" value={16} unit="/min" hint="12–20" />
          <VitalTile label="Glucose" value={148} unit="mg/dL" status="caution" icon={Droplet} hint="Fasting" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Inline rows" icon={FileText}>
            <ClinicalDataRow label="Patient ID" value="PT-2026-00142" numeric />
            <ClinicalDataRow label="ABHA number" value="12-3456-7890-1234" numeric />
            <ClinicalDataRow label="HbA1c" value="8.2%" status="caution" numeric hint="Target below 7.0%" />
            <ClinicalDataRow label="Serum creatinine" value="1.9 mg/dL" status="critical" numeric hint="0.7–1.3 mg/dL" />
            <ClinicalDataRow label="Primary diagnosis" value="Type 2 diabetes mellitus" emphasis />
          </Panel>

          <Panel title="Stacked rows" icon={FileText}>
            <ClinicalDataRow label="Chief complaint" value="Fatigue and foot numbness" layout="stacked" />
            <ClinicalDataRow
              label="Current medication"
              value="Glycomet 500 mg · BD"
              layout="stacked"
              hint="Started 12/03/2025"
            />
            <ClinicalDataRow label="Follow-up" value="08/12/2026" layout="stacked" emphasis />
          </Panel>
        </div>
      </Showcase>

      {/* ------------------------------------------- Empty and loading */}
      <Showcase
        title="Empty and loading states"
        description="Every list, table and panel shares these two states."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="No results" flush>
            <EmptyState
              icon={Search}
              title="No patient found"
              description="No record matches that ID or phone number."
              action={
                <Button size="sm" icon={UserPlus}>
                  Register patient
                </Button>
              }
            />
          </Panel>

          <Panel title="Loading" flush>
            <LoadingState label="Loading patient records" />
            <Divider />
            <LoadingState variant="skeleton" rows={3} label="Loading visit history" />
          </Panel>
        </div>

        <div className="mt-4">
          <Panel title="Empty table" flush>
            <Table
              columns={QUEUE_COLUMNS}
              rows={[]}
              getRowId={(row) => row.id}
              emptyState={
                <EmptyState
                  size="sm"
                  title="No appointments today"
                  description="The clinic schedule is clear."
                />
              }
            />
          </Panel>
        </div>
      </Showcase>
    </div>
  )
}
