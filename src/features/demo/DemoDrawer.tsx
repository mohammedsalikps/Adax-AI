import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarCheck,
  Database,
  FileText,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UserSearch,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Badge,
  Button,
  Divider,
  Drawer,
  LoadingState,
  Modal,
  useToast,
} from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { mockDb } from '@/mock/db'

/** Key that survives the reload so the toast can be shown afterwards. */
export const DEMO_RESET_FLAG = 'medconsult.demoReset'

const WORKFLOW_STEPS = [
  'Select a patient from Today’s Clinic, or find one in the directory.',
  'Start the consultation from the queue, the chart or a search result.',
  'Start the transcription simulation, then pause, resume and stop it.',
  'Generate the AI draft and review what it extracted from the transcript.',
  'Enter the diagnosis yourself — the assistant never diagnoses.',
  'Add medication yourself — the assistant never prescribes.',
  'Save the prescription draft, then preview, print, share or copy it.',
  'Save the consultation, then reopen it and confirm everything persisted.',
]

const SIMULATION_NOTES = [
  'No microphone is used and no speech recognition runs — transcript lines are replayed from a script.',
  'The assistant is a deterministic text extractor, not a model. It cannot diagnose or recommend treatment.',
  'Anything the transcript does not cover stays “Not mentioned in transcript.”',
  'Prescriptions are doctor-entered only, and printed output is marked as a demonstration document.',
  'All data is fictional and stored in this browser alone. No server, database or external service is contacted.',
]

/**
 * Finds a real seeded patient and a real saved consultation to point the
 * quick links at. Nothing here is hardcoded — if the seed data changes, the
 * links follow it.
 */
async function findDemoExamples() {
  const queue = await mockDb.listQueue()
  if (queue.length === 0) return null

  for (const entry of queue) {
    const consultations = await mockDb.listConsultations(entry.patient.id)
    const withPrescription = consultations.find((item) => item.prescription.length > 0)
    if (withPrescription) {
      return { patient: entry.patient, consultationId: withPrescription.id }
    }
  }

  return { patient: queue[0].patient, consultationId: undefined }
}

export interface DemoDrawerProps {
  open: boolean
  onClose: () => void
}

/** Demo guidance and demo-data tools. A demonstration aid, not a clinical feature. */
export function DemoDrawer({ open, onClose }: DemoDrawerProps) {
  // Mounted only while open, so the quick-link lookup never runs on pages
  // where the drawer is closed.
  return open ? <DemoDrawerContent onClose={onClose} /> : null
}

function DemoDrawerContent({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const examples = useAsyncData(findDemoExamples, 'demo-examples')

  function go(path: string) {
    onClose()
    navigate(path)
  }

  function resetDemoData() {
    setResetting(true)
    try {
      mockDb.reset()
      // Flag the reload so the confirmation shows on the restored screen
      // rather than flashing away as the page reloads.
      sessionStorage.setItem(DEMO_RESET_FLAG, '1')
      window.location.reload()
    } catch (cause) {
      setResetting(false)
      setConfirmOpen(false)
      showToast({
        title: 'Could not reset the demo data',
        description: cause instanceof Error ? cause.message : 'Unexpected error.',
        status: 'error',
      })
    }
  }

  const example = examples.data ?? null

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title="Demo guide"
        description="Demonstration aid — not part of the clinical workflow"
        size="md"
      >
        <div className="space-y-6">
          <section>
            <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              Jump to a screen
            </h3>

            {examples.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Finding demo records" />
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-2">
                <QuickLink
                  icon={CalendarCheck}
                  label="Today's Clinic"
                  detail="The appointment queue for today"
                  onClick={() => go('/')}
                />
                <QuickLink
                  icon={UserSearch}
                  label="Search patient"
                  detail="Find by name, ID, phone or ABHA number"
                  onClick={() => go('/patients/search')}
                />
                <QuickLink
                  icon={UserPlus}
                  label="Register patient"
                  detail="Multi-step intake that issues a new patient ID"
                  onClick={() => go('/patients/new')}
                />
                <QuickLink
                  icon={Stethoscope}
                  label="Example consultation"
                  detail={
                    example
                      ? `${example.patient.fullName} · ${example.patient.id}`
                      : 'No seeded patient available'
                  }
                  disabled={!example}
                  onClick={() => example && go(`/consultation/${example.patient.id}`)}
                />
                <QuickLink
                  icon={FileText}
                  label="Prescription preview"
                  detail={
                    example?.consultationId
                      ? 'Reopen the saved consultation, then Preview & print'
                      : 'No saved prescription in the demo data'
                  }
                  disabled={!example?.consultationId}
                  onClick={() => example && go(`/consultation/${example.patient.id}`)}
                />
              </div>
            )}
          </section>

          <Divider />

          <section>
            <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              Demo workflow
            </h3>
            <ol className="mt-2 space-y-2">
              {WORKFLOW_STEPS.map((step, index) => (
                <li key={step} className="flex gap-2.5 text-[13px] text-ink-soft">
                  <span className="tnum flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent-ink">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </section>

          <Divider />

          <section>
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              <ShieldCheck size={13} aria-hidden />
              What is simulated
            </h3>
            <ul className="mt-2 space-y-1.5">
              {SIMULATION_NOTES.map((note) => (
                <li key={note} className="flex gap-2.5 text-xs text-ink-soft">
                  <span
                    aria-hidden
                    className="mt-[6px] size-1.5 shrink-0 rounded-full bg-line-strong"
                  />
                  {note}
                </li>
              ))}
            </ul>
          </section>

          <Divider />

          <section>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                <Database size={13} aria-hidden />
                Demo data
              </h3>
              <Badge variant="caution">Destructive</Badge>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              Restores the seeded patients, appointments and consultations, and
              discards everything created during the demonstration — registered
              patients, saved consultations, transcripts, drafts and recorded vitals.
            </p>
            <Button
              variant="secondary"
              icon={RotateCcw}
              className="mt-3"
              onClick={() => setConfirmOpen(true)}
            >
              Reset demo data
            </Button>
          </section>
        </div>
      </Drawer>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Reset demo data?"
        description="This cannot be undone."
        size="sm"
        closeOnOverlayClick={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button variant="danger" loading={resetting} onClick={resetDemoData}>
              Reset and reload
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-soft">
          Every record created during this demonstration will be discarded and the
          original seed data restored. The screen reloads once the reset completes.
        </p>
      </Modal>
    </>
  )
}

function QuickLink({
  icon: Icon,
  label,
  detail,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon
  label: string
  detail: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2.5 rounded-control border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon size={15} className="shrink-0 text-ink-muted" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-ink">{label}</span>
        <span className="tnum block truncate text-[11px] text-ink-muted">{detail}</span>
      </span>
    </button>
  )
}
