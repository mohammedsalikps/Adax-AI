import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  CalendarCheck,
  Pencil,
  CalendarClock,
  CircleCheck,
  ClipboardList,
  FileText,
  IdCard,
  Pill,
  Printer,
  Save,
  SearchX,
  Sparkles,
  ShieldAlert,
  Stethoscope,
  TriangleAlert,
  UserSearch,
} from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingState,
  Panel,
  Table,
  Textarea,
  useToast,
  type TableColumn,
} from '@/components/ui'
import {
  AllergyChip,
  ClinicalDataRow,
  SectionHeader,
  StatusBadge,
  VitalsTileGrid,
} from '@/components/clinical'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { calculateAge, formatDate, formatDateTime, formatTime } from '@/lib/format'
import { formatVitalValue } from '@/lib/vitals'
import { mockDb } from '@/mock/db'
import {
  AI_DRAFT_DISCLAIMER,
  type Consultation,
  type ConsultationAiDraft,
  type ConsultationStatus,
  type PastVisit,
} from '@/types/consultation'
import type { CurrentMedication } from '@/types/prescription'
import type { VitalsSnapshot } from '@/types/vitals'
import { generateClinicalDraft } from '@/mock/aiDraft'
import { AiDraftDrawer, type DraftApplySelection } from './AiDraftDrawer'
import { PrescriptionPreviewModal } from './PrescriptionPreviewModal'
import { PatientConsultationHeader } from './PatientConsultationHeader'
import { StepTitle } from './StepTitle'
import { TranscriptionPanel } from './TranscriptionPanel'
import { useTranscription } from './useTranscription'
import { ConsultationDetailDrawer } from './ConsultationDetailDrawer'
import { DiagnosisEditor } from './DiagnosisEditor'
import { PrescriptionEditor } from './PrescriptionEditor'
import { RecordVitalsModal } from './RecordVitalsModal'
import {
  EMPTY_CONSULTATION_FORM,
  EMPTY_ERRORS,
  createDiagnosis,
  createPrescriptionItem,
  hasErrors,
  toConsultationInput,
  toFormState,
  validateConsultation,
  type ConsultationFormErrors,
  type ConsultationFormState,
} from './consultationForm'

export function ConsultationPage() {
  const { patientId = '' } = useParams<{ patientId: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [form, setForm] = useState<ConsultationFormState>(EMPTY_CONSULTATION_FORM)
  const [errors, setErrors] = useState<ConsultationFormErrors>(EMPTY_ERRORS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Consultation | null>(null)
  const [recordingVitals, setRecordingVitals] = useState(false)
  const [freshVitals, setFreshVitals] = useState<VitalsSnapshot | null>(null)
  const [openConsultation, setOpenConsultation] = useState<Consultation | null>(null)
  const [aiDraft, setAiDraft] = useState<ConsultationAiDraft | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  // A completed consultation opens read-only until the doctor unlocks it.
  const [readOnly, setReadOnly] = useState(false)
  const savingTranscriptRef = useRef(false)
  const [generating, setGenerating] = useState(false)
  const [savingTranscript, setSavingTranscript] = useState(false)
  const transcription = useTranscription(patientId)
  // State updates are asynchronous, so two clicks in the same tick would both
  // see saving === false. A ref flips synchronously and blocks the second.
  const savingRef = useRef(false)


  const patientQuery = useAsyncData(
    () => mockDb.getPatient(patientId),
    `consult-patient:${patientId}`,
  )
  const medicationsQuery = useAsyncData(
    () => mockDb.listMedications(patientId),
    `consult-medications:${patientId}`,
  )
  const vitalsQuery = useAsyncData(
    () => mockDb.listVitalsHistory(patientId),
    `consult-vitals:${patientId}`,
  )
  const visitsQuery = useAsyncData(
    () => mockDb.listVisits(patientId),
    `consult-visits:${patientId}`,
  )
  const consultationsQuery = useAsyncData(
    () => mockDb.listConsultations(patientId),
    `consult-history:${patientId}`,
  )

  const patient = patientQuery.data
  useDocumentTitle(patient ? `${patient.fullName} · Consultation` : 'Consultation')
  const vitalsHistory = vitalsQuery.data ?? []
  // A set recorded in this session wins until the query refetches.
  const latestVitals = freshVitals ?? vitalsHistory[0]
  const earlierVitals = vitalsHistory.filter((snapshot) => snapshot !== latestVitals)

  function update<K extends keyof ConsultationFormState>(
    key: K,
    value: ConsultationFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  /**
   * Loads a saved consultation back into the workspace. Replaces state
   * outright rather than merging, so nothing is duplicated, and never
   * regenerates the draft or restarts recording.
   */
  function openSavedConsultation(consultation: Consultation) {
    setForm(toFormState(consultation))
    setErrors(EMPTY_ERRORS)
    setSaved(consultation)
    transcription.hydrate(consultation.transcript ?? [])
    setAiDraft(consultation.aiDraft ?? null)
    setReadOnly(consultation.status === 'completed')
    setOpenConsultation(null)
    showToast(
      consultation.status === 'completed'
        ? {
            title: 'Completed consultation opened',
            description: 'Read-only. Choose “Continue editing” to make changes.',
            status: 'info',
          }
        : {
            title: 'Draft loaded',
            description: 'Continue editing and save when ready.',
            status: 'info',
          },
    )
    window.scrollTo({ top: 0 })
  }

  async function generateDraft() {
    setGenerating(true)
    try {
      const draft = await generateClinicalDraft(transcription.lines)
      setAiDraft(draft)
      transcription.markDraftReady()
      setDraftOpen(true)
      // Persist the draft immediately when a consultation already exists;
      // storing it never alters the clinical fields.
      if (saved) await mockDb.saveAiDraft(saved.id, draft)
      showToast({
        title: 'Draft ready for review',
        description: 'AI-generated draft — review before saving.',
        status: 'info',
      })
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Could not generate a draft.'
      transcription.fail(message)
      showToast({ title: 'Draft generation failed', description: message, status: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  /** Copies the sections the doctor selected into the consultation form. */
  function applyDraft(selection: DraftApplySelection) {
    const followUpText = selection.followUpInstructions?.trim()
    setForm((current) => ({
      ...current,
      // Applying follow-up wording also turns follow-up on, otherwise the
      // applied text would sit in a section the doctor cannot see.
      followUpRequired: followUpText ? true : current.followUpRequired,
      chiefComplaint: selection.chiefComplaint ?? current.chiefComplaint,
      historyOfPresentIllness:
        selection.historyOfPresentIllness ?? current.historyOfPresentIllness,
      examination: selection.examination ?? current.examination,
      clinicalNotes: selection.clinicalNotes ?? current.clinicalNotes,
      followUpInstructions:
        selection.followUpInstructions ?? current.followUpInstructions,
      // Appended, so nothing the doctor already recorded is lost. Draft
      // diagnosis ids are stable, so applying the same draft twice would
      // otherwise duplicate rows and collide React keys.
      diagnoses: selection.diagnoses
        ? [
            ...current.diagnoses,
            ...selection.diagnoses.filter(
              (incoming) => !current.diagnoses.some((held) => held.id === incoming.id),
            ),
          ]
        : current.diagnoses,
    }))
    setDraftOpen(false)
    showToast({
      title: 'Draft applied to the consultation',
      description: 'Review and edit before saving. Nothing has been saved yet.',
      status: 'success',
    })
  }

  /** Explicit save of the transcript; creates a draft consultation if needed. */
  async function saveTranscript() {
    // A ref flips synchronously; two clicks in one tick would otherwise both
    // see savingTranscript === false and create two consultations.
    if (savingTranscriptRef.current) return
    savingTranscriptRef.current = true
    setSavingTranscript(true)
    try {
      if (saved) {
        const updated = await mockDb.saveTranscript(saved.id, transcription.lines)
        setSaved(updated)
      } else {
        const created = await mockDb.createConsultation(
          toConsultationInput(form, patientId, 'draft', {
            transcript: transcription.lines,
            aiDraft: aiDraft ?? undefined,
          }),
        )
        setSaved(created)
      }
      consultationsQuery.reload()
      showToast({
        title: 'Transcript saved',
        description: 'Stored on the consultation draft in this browser.',
        status: 'success',
      })
    } catch (cause) {
      showToast({
        title: 'Could not save the transcript',
        description: cause instanceof Error ? cause.message : 'Unexpected error.',
        status: 'error',
      })
    } finally {
      savingTranscriptRef.current = false
      setSavingTranscript(false)
    }
  }

  async function save(status: ConsultationStatus) {
    if (savingRef.current) return // Blocks a double submit.
    savingRef.current = true

    const validation = validateConsultation(form, { strict: status === 'completed' })
    if (hasErrors(validation)) {
      savingRef.current = false
      setErrors(validation)
      showToast({
        title: 'Check the highlighted fields',
        description: 'The consultation was not saved.',
        status: 'warning',
      })
      return
    }
    setErrors(EMPTY_ERRORS)
    setSaving(true)

    // A record that is already completed stays completed; saving edits to it
    // must never quietly demote it back to a draft.
    const effectiveStatus: ConsultationStatus =
      saved?.status === 'completed' ? 'completed' : status

    try {
      const payload = toConsultationInput(form, patientId, effectiveStatus, {
        transcript: transcription.lines,
        aiDraft: aiDraft ?? undefined,
      })
      const record = saved
        ? await mockDb.updateConsultation(saved.id, {
            ...payload,
            recordedVitals: freshVitals ?? saved.recordedVitals,
          })
        : await mockDb.createConsultation({
            ...payload,
            recordedVitals: freshVitals ?? undefined,
          })

      setSaved(record)
      consultationsQuery.reload()

      if (effectiveStatus === 'completed') {
        // Completing the consultation closes the matching appointment.
        const queue = await mockDb.listQueue()
        const entry = queue.find(
          (item) =>
            item.patient.id === patientId && item.appointment.status !== 'completed',
        )
        if (entry) await mockDb.updateAppointmentStatus(entry.appointment.id, 'completed')
      }

      showToast({
        title: effectiveStatus === 'completed' ? 'Consultation completed' : 'Draft saved',
        description: `${patient?.fullName ?? patientId} — stored in this browser.`,
        status: 'success',
      })
    } catch (cause) {
      // The form is left untouched so nothing the doctor typed is lost.
      showToast({
        title: 'Could not save the consultation',
        description: cause instanceof Error ? cause.message : 'Unexpected error.',
        status: 'error',
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (patientQuery.loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <LoadingState label="Loading consultation" />
      </div>
    )
  }

  if (patientQuery.error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Panel title="Consultation unavailable" icon={TriangleAlert} tone="critical">
          <EmptyState
            icon={TriangleAlert}
            title="Could not load this patient"
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
    return <ConsultationNotFound patientId={patientId} />
  }

  const age = calculateAge(patient.dateOfBirth)
  // Editing controls are disabled while saving, and while a completed
  // consultation is open for review.
  const locked = saving || readOnly
  const draftBusy =
    locked ||
    generating ||
    transcription.status === 'recording' ||
    transcription.status === 'processing'

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      {/* Page-level status banners span both columns. */}
      {readOnly && saved && (
        <Panel
          title="Completed consultation"
          icon={CircleCheck}
          tone="accent"
          dense
          className="mb-4"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-xs text-ink-soft">
              This consultation is completed and is shown read-only. Recording and draft
              generation are unchanged, and nothing is saved unless you choose to edit.
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={Pencil}
              className="ml-auto"
              onClick={() => {
                setReadOnly(false)
                showToast({
                  title: 'Editing enabled',
                  description: 'The consultation stays completed when you save.',
                  status: 'info',
                })
              }}
            >
              Continue editing
            </Button>
          </div>
        </Panel>
      )}

      {saved && !readOnly && (
        <Panel
          tone={saved.status === 'completed' ? 'accent' : 'default'}
          title={saved.status === 'completed' ? 'Consultation saved' : 'Draft saved'}
          icon={CircleCheck}
          dense
          className="mb-4"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="tnum text-xs text-ink-soft">
              Last saved {formatDateTime(saved.updatedAt)} · {saved.doctorName}
            </p>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={IdCard}
                onClick={() => navigate(`/patients/${patient.id}`)}
              >
                View patient
              </Button>
              <Button size="sm" icon={CalendarCheck} onClick={() => navigate('/')}>
                Return to clinic
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {/* A dominant workspace column beside a fixed-width context rail. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:gap-5">
        {/* ============================ consultation workspace ============= */}
        <div className="min-w-0 space-y-3.5">
          <PatientConsultationHeader
            patient={patient}
            onOpenProfile={() => navigate(`/patients/${patient.id}`)}
          />

          <TranscriptionPanel
            step={1}
            locked={readOnly}
            transcription={transcription}
            savingTranscript={savingTranscript}
            onSaveTranscript={() => void saveTranscript()}
          />

          <Panel
            title={<StepTitle step={2}>Vitals</StepTitle>}
            description={
              latestVitals
                ? `Mock device data · recorded ${formatDateTime(latestVitals.recordedAt)}`
                : 'Mock device data · nothing recorded yet'
            }
            icon={Activity}
            actions={
              <Button
                size="sm"
                variant="secondary"
                icon={Activity}
                disabled={locked}
                onClick={() => setRecordingVitals(true)}
              >
                Record
              </Button>
            }
          >
            {vitalsQuery.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Loading vitals" />
            ) : latestVitals ? (
              <VitalsTileGrid
                snapshot={latestVitals}
                heightCm={patient.heightCm}
                weightKg={patient.weightKg}
              />
            ) : (
              <EmptyState
                size="sm"
                icon={Activity}
                title="No vitals on record"
                description="Record a set of vitals for this consultation."
                action={
                  <Button
                    size="sm"
                    icon={Activity}
                    disabled={locked}
                    onClick={() => setRecordingVitals(true)}
                  >
                    Record vitals
                  </Button>
                }
              />
            )}
          </Panel>

          {/* The three narrative fields are one act of documentation, so they
              share a card instead of three near-identical ones. */}
          <Panel
            title={<StepTitle step={3}>Clinical documentation</StepTitle>}
            description="Chief complaint, history and examination"
            icon={FileText}
          >
            <div className="space-y-4">
              <Textarea
                label="Chief complaint"
                rows={2}
                placeholder="Patient reports lower back pain for 3 days."
                value={form.chiefComplaint}
                error={errors.chiefComplaint}
                disabled={locked}
                onChange={(event) => update('chiefComplaint', event.target.value)}
              />
              <Textarea
                label="History of present illness"
                rows={5}
                placeholder="Onset, duration, character, aggravating and relieving factors, associated symptoms, relevant negatives."
                value={form.historyOfPresentIllness}
                disabled={locked}
                onChange={(event) => update('historyOfPresentIllness', event.target.value)}
              />
              <Textarea
                label="Examination findings"
                rows={4}
                placeholder="General appearance, vitals interpretation, system-wise findings."
                value={form.examination}
                disabled={locked}
                onChange={(event) => update('examination', event.target.value)}
              />
            </div>
          </Panel>

          <Panel
            title={<StepTitle step={4}>AI documentation draft</StepTitle>}
            description="Extracted from the transcript · never diagnoses or prescribes"
            icon={Sparkles}
            tone={aiDraft ? 'ai' : 'default'}
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                {aiDraft && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={FileText}
                    onClick={() => setDraftOpen(true)}
                  >
                    Review draft
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={aiDraft ? 'ghost' : 'secondary'}
                  icon={Sparkles}
                  loading={generating}
                  disabled={draftBusy}
                  onClick={() => void generateDraft()}
                >
                  {aiDraft ? 'Regenerate' : 'Generate draft'}
                </Button>
              </div>
            }
          >
            {aiDraft ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Badge variant="ai">{AI_DRAFT_DISCLAIMER}</Badge>
                <p className="tnum text-[11px] text-ink-muted">
                  Generated {formatDateTime(aiDraft.generatedAt)} from{' '}
                  {aiDraft.sourceLineCount} transcript lines
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                No draft yet. Capture or type transcript lines above, then generate a draft
                to review. Nothing reaches the consultation until you apply it.
              </p>
            )}
          </Panel>

          <Panel
            title={<StepTitle step={5}>Diagnosis</StepTitle>}
            description="Doctor-entered — the assistant never diagnoses"
            icon={ClipboardList}
          >
            <DiagnosisEditor
              diagnoses={form.diagnoses}
              errors={errors.diagnoses}
              disabled={locked}
              onChange={(diagnoses) => update('diagnoses', diagnoses)}
              onAdd={() => update('diagnoses', [...form.diagnoses, createDiagnosis()])}
            />
          </Panel>

          <Panel
            title={<StepTitle step={6}>Prescription</StepTitle>}
            description="Doctor-entered only — no interaction checking in this build"
            icon={Pill}
            actions={
              <Button
                size="sm"
                variant="secondary"
                icon={Printer}
                onClick={() => setPreviewOpen(true)}
              >
                Preview &amp; print
              </Button>
            }
          >
            <PrescriptionEditor
              items={form.prescription}
              errors={errors.prescription}
              disabled={locked}
              onChange={(items) => update('prescription', items)}
              onAdd={() =>
                update('prescription', [...form.prescription, createPrescriptionItem()])
              }
            />
          </Panel>

          <Panel
            title={<StepTitle step={7}>Notes and follow-up</StepTitle>}
            icon={CalendarClock}
          >
            <div className="space-y-4">
              <Textarea
                label="Additional notes"
                rows={3}
                placeholder="Counselling given, patient concerns, decisions deferred, safety-netting advice."
                value={form.clinicalNotes}
                disabled={locked}
                onChange={(event) => update('clinicalNotes', event.target.value)}
              />

              <label className="flex cursor-pointer items-start gap-3 rounded-control border border-line bg-surface-alt p-3 transition-colors hover:border-line-strong">
                <input
                  type="checkbox"
                  checked={form.followUpRequired}
                  disabled={locked}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                  onChange={(event) => update('followUpRequired', event.target.checked)}
                />
                <span>
                  <span className="block text-[13px] font-semibold text-ink">
                    Follow-up required
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    Leave unticked if the patient does not need to be seen again.
                  </span>
                </span>
              </label>

              {form.followUpRequired && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Follow-up date"
                    type="date"
                    required
                    value={form.followUpDate}
                    error={errors.followUpDate}
                    disabled={locked}
                    onChange={(event) => update('followUpDate', event.target.value)}
                  />
                  <Input
                    label="Follow-up instructions"
                    placeholder="Repeat HbA1c one week before"
                    value={form.followUpInstructions}
                    disabled={locked}
                    onChange={(event) => update('followUpInstructions', event.target.value)}
                  />
                </div>
              )}
            </div>
          </Panel>

          {/* Closing actions for the workspace. */}
          <div
            className={
              readOnly
                ? 'hidden'
                : 'flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface p-3'
            }
          >
            <Button
              icon={CircleCheck}
              loading={saving}
              onClick={() => void save('completed')}
            >
              Save consultation
            </Button>
            <Button
              variant="secondary"
              icon={Save}
              loading={saving}
              onClick={() => void save('draft')}
            >
              Save as draft
            </Button>
            <Button variant="secondary" icon={Printer} onClick={() => setPreviewOpen(true)}>
              Preview &amp; print
            </Button>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => navigate('/')}
              disabled={saving}
            >
              Cancel and return to clinic
            </Button>
          </div>

          <Panel
            title="Consultation history"
            description="Previous consultations recorded in this system"
            icon={ClipboardList}
            flush
          >
            {consultationsQuery.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Loading consultations" />
            ) : (
              <ConsultationHistoryTable
                consultations={consultationsQuery.data ?? []}
                onOpen={setOpenConsultation}
                onContinue={openSavedConsultation}
              />
            )}
          </Panel>
        </div>

        {/* ============================== patient context rail ============= */}
        <aside
          aria-label="Patient context"
          className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:pb-1"
        >
          <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                Consultation
              </span>
              {saved ? (
                <StatusBadge
                  status={saved.status === 'completed' ? 'completed' : 'waiting'}
                  label={saved.status === 'completed' ? 'Completed' : 'Draft saved'}
                />
              ) : (
                <StatusBadge status="in-consultation" label="In progress" />
              )}
            </div>

            <Button
              icon={CircleCheck}
              loading={saving}
              fullWidth
              disabled={readOnly}
              onClick={() => void save('completed')}
            >
              Save consultation
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={IdCard}
                onClick={() => navigate(`/patients/${patient.id}`)}
              >
                Profile
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={CalendarCheck}
                onClick={() => navigate('/')}
              >
                Clinic
              </Button>
            </div>
          </div>

          <Panel title="Patient summary" icon={IdCard} dense>
            <ClinicalDataRow label="Patient ID" value={patient.id} numeric emphasis dense />
            <ClinicalDataRow label="Age" value={`${age} years`} numeric dense />
            <ClinicalDataRow
              label="Gender"
              value={patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)}
              dense
            />
            <ClinicalDataRow
              label="Blood group"
              value={patient.bloodGroup ?? 'Not known'}
              dense
            />
            <ClinicalDataRow
              label="Conditions"
              value={patient.chronicConditions.length || 'None recorded'}
              numeric
              dense
            />
          </Panel>

          <Panel
            title="Allergies"
            icon={ShieldAlert}
            tone={patient.allergies.length > 0 ? 'critical' : 'default'}
            dense
          >
            {patient.allergies.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {patient.allergies.map((allergy) => (
                  <AllergyChip
                    key={allergy.id}
                    substance={allergy.substance}
                    severity={allergy.severity}
                    reaction={allergy.reaction}
                    size="sm"
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-muted">No known allergies recorded.</p>
            )}
          </Panel>

          <Panel
            title="Current medications"
            description="Review before prescribing"
            icon={Pill}
            dense
          >
            {medicationsQuery.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Loading medications" />
            ) : (
              <MedicationList medications={medicationsQuery.data ?? []} />
            )}
          </Panel>

          <Panel title="Recent vitals" icon={Activity} dense>
            {earlierVitals.length === 0 ? (
              <p className="text-xs text-ink-muted">No earlier recordings.</p>
            ) : (
              <div className="space-y-2">
                {earlierVitals.slice(0, 2).map((snapshot) => (
                  <RecentVitalsRow key={snapshot.recordedAt} snapshot={snapshot} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Visit history" icon={ClipboardList} dense>
            {visitsQuery.loading ? (
              <LoadingState variant="skeleton" rows={2} label="Loading visits" />
            ) : (
              <VisitList visits={visitsQuery.data ?? []} />
            )}
          </Panel>
        </aside>
      </div>

      <p className="text-[11px] text-ink-muted">
        Demonstration software. Consultations are stored in this browser only —
        there is no server, no medical record system and no clinical validation.
      </p>

      <RecordVitalsModal
        patientId={patient.id}
        open={recordingVitals}
        onClose={() => setRecordingVitals(false)}
        onRecorded={(snapshot) => {
          setFreshVitals(snapshot)
          vitalsQuery.reload()
        }}
      />

      <AiDraftDrawer
        draft={aiDraft}
        open={draftOpen}
        regenerating={generating}
        existing={{
          chiefComplaint: form.chiefComplaint,
          historyOfPresentIllness: form.historyOfPresentIllness,
          examination: form.examination,
          clinicalNotes: form.clinicalNotes,
          followUpInstructions: form.followUpInstructions,
        }}
        onClose={() => setDraftOpen(false)}
        onApply={applyDraft}
        onRegenerate={() => void generateDraft()}
        onDiscard={() => {
          setAiDraft(null)
          setDraftOpen(false)
          showToast({ title: 'Draft discarded', status: 'info' })
        }}
      />

      <PrescriptionPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        patient={patient}
        age={age}
        diagnoses={form.diagnoses.filter((item) => item.name.trim())}
        items={form.prescription.filter((item) => item.medication.trim())}
        clinicalNotes={form.clinicalNotes}
        followUpRequired={form.followUpRequired}
        followUpDate={form.followUpDate}
        followUpInstructions={form.followUpInstructions}
      />

      <ConsultationDetailDrawer
        consultation={openConsultation}
        onClose={() => setOpenConsultation(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------- history */

function ConsultationHistoryTable({
  consultations,
  onOpen,
  onContinue,
}: {
  consultations: Consultation[]
  onOpen: (consultation: Consultation) => void
  onContinue: (consultation: Consultation) => void
}) {
  const columns: TableColumn<Consultation>[] = [
    {
      key: 'date',
      header: 'Date',
      width: '110px',
      cellClassName: 'tnum whitespace-nowrap',
      render: (item) => (
        <span className="font-medium text-ink">{formatDate(item.createdAt)}</span>
      ),
    },
    { key: 'doctor', header: 'Provider', width: '150px', render: (item) => item.doctorName },
    {
      key: 'summary',
      header: 'Complaint / diagnosis',
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{item.chiefComplaint || 'No complaint recorded'}</p>
          {item.diagnoses.length > 0 && (
            <p className="truncate text-[11px] text-ink-muted">
              {item.diagnoses.map((diagnosis) => diagnosis.name).join(', ')}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      width: '110px',
      render: (item) =>
        item.status === 'completed' ? (
          <Badge variant="normal">Completed</Badge>
        ) : (
          <Badge variant="caution">Draft</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '190px',
      render: (item) => (
        <div
          className="flex items-center justify-end gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          <Button size="sm" variant="secondary" onClick={() => onContinue(item)}>
            {item.status === 'draft' ? 'Continue' : 'Reopen'}
          </Button>
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => onOpen(item)}>
            Details
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Table
      columns={columns}
      rows={consultations}
      getRowId={(item) => item.id}
      onRowClick={onOpen}
      dense
      caption="Consultations recorded for this patient"
      emptyState={
        <EmptyState
          size="sm"
          icon={ClipboardList}
          title="No consultations yet"
          description="Saved consultations for this patient appear here."
        />
      }
    />
  )
}

/* ---------------------------------------------------------- side lists */

function MedicationList({ medications }: { medications: CurrentMedication[] }) {
  if (medications.length === 0) {
    return <p className="text-xs text-ink-muted">No medications recorded.</p>
  }

  return (
    <ul className="divide-y divide-line">
      {medications.map((medication) => (
        <li key={medication.id} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">
              {medication.brandName} {medication.strength}
            </p>
            <p className="tnum truncate text-[11px] text-ink-muted">
              {medication.frequency} · {medication.route} ·{' '}
              {medication.duration ?? 'Ongoing'}
            </p>
          </div>
          {medication.active ? (
            <Badge variant="normal">Active</Badge>
          ) : (
            <Badge>Stopped</Badge>
          )}
        </li>
      ))}
    </ul>
  )
}

function RecentVitalsRow({ snapshot }: { snapshot: VitalsSnapshot }) {
  const { systolicBp, diastolicBp, heartRate, spo2 } = snapshot.readings

  return (
    <div className="rounded-control border border-line bg-surface-alt px-2.5 py-2">
      <p className="tnum text-[11px] font-semibold text-ink-soft">
        {formatDate(snapshot.recordedAt)} · {formatTime(snapshot.recordedAt)}
      </p>
      <p className="tnum mt-0.5 text-[11px] text-ink-muted">
        {systolicBp && diastolicBp
          ? `BP ${systolicBp.value}/${diastolicBp.value}`
          : 'BP —'}
        {heartRate ? ` · HR ${formatVitalValue('heartRate', heartRate.value)}` : ''}
        {spo2 ? ` · SpO₂ ${formatVitalValue('spo2', spo2.value)}%` : ''}
      </p>
    </div>
  )
}

function VisitList({ visits }: { visits: PastVisit[] }) {
  if (visits.length === 0) {
    return <p className="text-xs text-ink-muted">No previous visits recorded.</p>
  }

  return (
    <ul className="divide-y divide-line">
      {visits.slice(0, 4).map((visit) => (
        <li key={visit.id} className="py-2 first:pt-0 last:pb-0">
          <p className="tnum text-[11px] font-semibold text-ink-soft">
            {formatDate(visit.visitedOn)}
          </p>
          <p className="truncate text-[13px] text-ink">{visit.chiefComplaint}</p>
          <p className="truncate text-[11px] text-ink-muted">{visit.diagnosis}</p>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------ not found */

function ConsultationNotFound({ patientId }: { patientId: string }) {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <SectionHeader
        title="Consultation"
        description="No patient matches this identifier."
        icon={Stethoscope}
        size="lg"
        className="mb-4"
      />
      <Panel title="Patient not found" icon={SearchX} tone="critical">
        <EmptyState
          icon={SearchX}
          title="Cannot start a consultation"
          description={`No patient in the directory matches "${patientId}". Check the identifier, or find the patient in the directory.`}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" icon={UserSearch} onClick={() => navigate('/patients/search')}>
                Find patient
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
