import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  IdCard,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserPlus,
} from 'lucide-react'
import {
  Badge,
  Button,
  Divider,
  EmptyState,
  Input,
  Panel,
  Select,
  useToast,
} from '@/components/ui'
import { AllergyChip, ClinicalDataRow, SectionHeader } from '@/components/clinical'
import { calculateAge, formatAbha, formatDate, formatPhone } from '@/lib/format'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { mockDb } from '@/mock/db'
import type { Patient } from '@/types/patient'
import { RegistrationStepper } from './RegistrationStepper'
import {
  BLOOD_GROUP_OPTIONS,
  EMPTY_REGISTRATION_FORM,
  REGISTRATION_STEPS,
  SEVERITY_OPTIONS,
  SEX_OPTIONS,
  createDraftAllergy,
  toPatientInput,
  validateStep,
  type FormErrors,
  type RegistrationForm,
} from './registrationForm'

const LAST_INPUT_STEP = REGISTRATION_STEPS.length - 2

export function PatientRegistrationPage() {
  useDocumentTitle('Register Patient')

  const navigate = useNavigate()
  const { showToast } = useToast()

  const [step, setStep] = useState(0)
  const [form, setForm] = useState<RegistrationForm>(EMPTY_REGISTRATION_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<Patient | null>(null)
  const [conditionDraft, setConditionDraft] = useState('')

  function update<K extends keyof RegistrationForm>(
    key: K,
    value: RegistrationForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  function goNext() {
    const stepErrors = validateStep(step, form)
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors)
      return
    }
    setErrors({})
    setStep((current) => Math.min(current + 1, REGISTRATION_STEPS.length - 1))
  }

  function goBack() {
    setErrors({})
    setStep((current) => Math.max(current - 1, 0))
  }

  async function submit() {
    // Re-validate every input step, in case an earlier one was edited.
    for (let index = 0; index <= LAST_INPUT_STEP; index += 1) {
      const stepErrors = validateStep(index, form)
      if (Object.keys(stepErrors).length > 0) {
        setErrors(stepErrors)
        setStep(index)
        showToast({
          title: 'Check the highlighted fields',
          description: `Step ${index + 1} is incomplete.`,
          status: 'warning',
        })
        return
      }
    }

    setSubmitting(true)
    const patient = await mockDb.createPatient(toPatientInput(form))
    setSubmitting(false)
    setCreated(patient)
    showToast({
      title: 'Patient registered',
      description: `${patient.fullName} — ${patient.id}`,
      status: 'success',
    })
  }

  function startAnother() {
    setForm(EMPTY_REGISTRATION_FORM)
    setErrors({})
    setStep(0)
    setCreated(null)
  }

  function addCondition() {
    const value = conditionDraft.trim()
    if (!value || form.chronicConditions.includes(value)) return
    update('chronicConditions', [...form.chronicConditions, value])
    setConditionDraft('')
  }

  if (created) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Panel tone="accent" title="Registration complete" icon={CircleCheck}>
          <div className="flex flex-col items-center gap-1 py-4 text-center">
            <p className="text-sm text-ink-soft">Patient ID issued</p>
            <p className="tnum text-3xl font-semibold tracking-tight text-accent-ink">
              {created.id}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">{created.fullName}</p>
            <p className="tnum text-xs text-ink-muted">
              {calculateAge(created.dateOfBirth)} years · Registered{' '}
              {formatDate(created.registeredOn)}
            </p>
          </div>

          <Divider className="my-3" />

          <div className="space-y-0.5">
            <ClinicalDataRow label="Phone" value={formatPhone(created.contact.phone)} numeric />
            <ClinicalDataRow
              label="Allergies"
              value={created.allergies.length || 'None recorded'}
              status={created.allergies.length ? 'critical' : undefined}
            />
            <ClinicalDataRow
              label="Chronic conditions"
              value={created.chronicConditions.length || 'None recorded'}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button icon={UserPlus} onClick={startAnother}>
              Register another
            </Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              Back to Today's Clinic
            </Button>
          </div>

          <p className="mt-4 text-[11px] text-ink-muted">
            Stored in the browser only. This demonstration has no server or
            database — clearing site data removes the record.
          </p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <SectionHeader
        title="Register Patient"
        description="Creates a new chart and issues a clinic patient ID."
        icon={UserPlus}
        size="lg"
      />

      <RegistrationStepper
        steps={REGISTRATION_STEPS}
        currentStep={step}
        onStepSelect={setStep}
      />

      <Panel
        title={REGISTRATION_STEPS[step].title}
        description={REGISTRATION_STEPS[step].hint}
        footer={
          <div className="flex w-full items-center gap-2">
            <Button
              variant="ghost"
              icon={ArrowLeft}
              onClick={goBack}
              disabled={step === 0 || submitting}
            >
              Back
            </Button>
            <span className="tnum ml-auto text-[11px] text-ink-muted">
              Step {step + 1} of {REGISTRATION_STEPS.length}
            </span>
            {step < REGISTRATION_STEPS.length - 1 ? (
              <Button icon={ArrowRight} iconPosition="right" onClick={goNext}>
                Continue
              </Button>
            ) : (
              <Button icon={CircleCheck} loading={submitting} onClick={() => void submit()}>
                Register patient
              </Button>
            )}
          </div>
        }
      >
        {step === 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              required
              value={form.fullName}
              error={errors.fullName}
              placeholder="As it appears on records"
              wrapperClassName="sm:col-span-2"
              onChange={(event) => update('fullName', event.target.value)}
            />
            <Input
              label="Date of birth"
              type="date"
              required
              value={form.dateOfBirth}
              error={errors.dateOfBirth}
              hint={
                form.dateOfBirth && !errors.dateOfBirth
                  ? `${calculateAge(form.dateOfBirth)} years old`
                  : undefined
              }
              onChange={(event) => update('dateOfBirth', event.target.value)}
            />
            <Select
              label="Sex"
              required
              options={SEX_OPTIONS}
              placeholder="Select"
              value={form.sex}
              error={errors.sex}
              onChange={(event) =>
                update('sex', event.target.value as RegistrationForm['sex'])
              }
            />
            <Select
              label="Blood group"
              options={BLOOD_GROUP_OPTIONS}
              placeholder="Not known"
              value={form.bloodGroup}
              onChange={(event) =>
                update('bloodGroup', event.target.value as RegistrationForm['bloodGroup'])
              }
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Height"
                suffix="cm"
                numeric
                inputMode="numeric"
                value={form.heightCm}
                error={errors.heightCm}
                onChange={(event) => update('heightCm', event.target.value)}
              />
              <Input
                label="Weight"
                suffix="kg"
                numeric
                inputMode="decimal"
                value={form.weightKg}
                error={errors.weightKg}
                onChange={(event) => update('weightKg', event.target.value)}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Mobile number"
              required
              inputMode="tel"
              numeric
              maxLength={10}
              placeholder="10-digit number"
              value={form.phone}
              error={errors.phone}
              onChange={(event) => update('phone', event.target.value)}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              error={errors.email}
              placeholder="Optional"
              onChange={(event) => update('email', event.target.value)}
            />
            <Input
              label="Address"
              required
              wrapperClassName="sm:col-span-2"
              placeholder="House number, street, locality"
              value={form.addressLine}
              error={errors.addressLine}
              onChange={(event) => update('addressLine', event.target.value)}
            />
            <Input
              label="City"
              required
              value={form.city}
              error={errors.city}
              onChange={(event) => update('city', event.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="State"
                required
                value={form.state}
                error={errors.state}
                onChange={(event) => update('state', event.target.value)}
              />
              <Input
                label="PIN code"
                required
                numeric
                inputMode="numeric"
                maxLength={6}
                value={form.pincode}
                error={errors.pincode}
                onChange={(event) => update('pincode', event.target.value)}
              />
            </div>

            <Divider label="Emergency contact" className="sm:col-span-2 my-1" />

            <Input
              label="Name"
              placeholder="Optional"
              value={form.emergencyName}
              onChange={(event) => update('emergencyName', event.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Relationship"
                placeholder="Spouse, son…"
                value={form.emergencyRelationship}
                onChange={(event) => update('emergencyRelationship', event.target.value)}
              />
              <Input
                label="Phone"
                numeric
                inputMode="tel"
                maxLength={10}
                value={form.emergencyPhone}
                error={errors.emergencyPhone}
                onChange={(event) => update('emergencyPhone', event.target.value)}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Input
              label="ABHA number"
              icon={IdCard}
              numeric
              inputMode="numeric"
              maxLength={14}
              placeholder="14-digit Ayushman Bharat Health Account"
              hint="Optional. Leave blank if the patient does not have one."
              value={form.abhaNumber}
              error={errors.abhaNumber}
              wrapperClassName="max-w-md"
              onChange={(event) => update('abhaNumber', event.target.value)}
            />

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-control border p-3.5 transition-colors ${
                errors.consentGiven
                  ? 'border-critical bg-critical-soft/30'
                  : 'border-line bg-surface-alt hover:border-line-strong'
              }`}
            >
              <input
                type="checkbox"
                checked={form.consentGiven}
                onChange={(event) => update('consentGiven', event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <ShieldCheck size={14} className="text-accent" aria-hidden />
                  Consent recorded
                </span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  The patient consents to their clinical information being recorded
                  and used for their care at this clinic.
                </span>
              </span>
            </label>

            {errors.consentGiven && (
              <p role="alert" className="text-[11px] font-medium text-critical">
                {errors.consentGiven}
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-ink">Known allergies</h3>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Plus}
                  onClick={() =>
                    update('allergies', [...form.allergies, createDraftAllergy()])
                  }
                >
                  Add allergy
                </Button>
              </div>

              {errors.allergies && (
                <p role="alert" className="mt-2 text-[11px] font-medium text-critical">
                  {errors.allergies}
                </p>
              )}

              {form.allergies.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={TriangleAlert}
                  title="No allergies recorded"
                  description="Add any known drug or substance allergy."
                  className="mt-2 rounded-control border border-dashed border-line"
                />
              ) : (
                <div className="mt-3 space-y-3">
                  {form.allergies.map((allergy, index) => (
                    <div
                      key={allergy.id}
                      className="grid grid-cols-1 items-end gap-3 rounded-control border border-line bg-surface-alt p-3 sm:grid-cols-[1fr_1fr_140px_auto]"
                    >
                      <Input
                        label="Substance"
                        size="sm"
                        value={allergy.substance}
                        placeholder="Penicillin"
                        onChange={(event) => {
                          const next = [...form.allergies]
                          next[index] = { ...allergy, substance: event.target.value }
                          update('allergies', next)
                        }}
                      />
                      <Input
                        label="Reaction"
                        size="sm"
                        value={allergy.reaction}
                        placeholder="Rash, anaphylaxis"
                        onChange={(event) => {
                          const next = [...form.allergies]
                          next[index] = { ...allergy, reaction: event.target.value }
                          update('allergies', next)
                        }}
                      />
                      <Select
                        label="Severity"
                        size="sm"
                        options={SEVERITY_OPTIONS}
                        value={allergy.severity}
                        onChange={(event) => {
                          const next = [...form.allergies]
                          next[index] = {
                            ...allergy,
                            severity: event.target
                              .value as (typeof form.allergies)[number]['severity'],
                          }
                          update('allergies', next)
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={Trash2}
                        aria-label={`Remove allergy ${index + 1}`}
                        onClick={() =>
                          update(
                            'allergies',
                            form.allergies.filter((item) => item.id !== allergy.id),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Divider />

            <div>
              <h3 className="text-[13px] font-semibold text-ink">Chronic conditions</h3>
              <div className="mt-2 flex items-end gap-2">
                <Input
                  label="Condition"
                  size="sm"
                  placeholder="Type 2 diabetes mellitus"
                  value={conditionDraft}
                  wrapperClassName="max-w-sm"
                  onChange={(event) => setConditionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addCondition()
                    }
                  }}
                />
                <Button size="sm" variant="secondary" icon={Plus} onClick={addCondition}>
                  Add
                </Button>
              </div>

              {form.chronicConditions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.chronicConditions.map((condition) => (
                    <span
                      key={condition}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-2 py-1 text-[11px] font-semibold text-ink-soft"
                    >
                      {condition}
                      <button
                        type="button"
                        aria-label={`Remove ${condition}`}
                        onClick={() =>
                          update(
                            'chronicConditions',
                            form.chronicConditions.filter((item) => item !== condition),
                          )
                        }
                        className="text-ink-muted transition-colors hover:text-critical"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                Demographics
              </h3>
              <div className="mt-1.5 space-y-0.5">
                <ClinicalDataRow label="Full name" value={form.fullName || '—'} emphasis />
                <ClinicalDataRow
                  label="Date of birth"
                  value={
                    form.dateOfBirth
                      ? `${formatDate(form.dateOfBirth)} (${calculateAge(form.dateOfBirth)} years)`
                      : '—'
                  }
                  numeric
                />
                <ClinicalDataRow
                  label="Sex"
                  value={SEX_OPTIONS.find((option) => option.value === form.sex)?.label ?? '—'}
                />
                <ClinicalDataRow label="Blood group" value={form.bloodGroup || 'Not known'} />
                <ClinicalDataRow
                  label="Height and weight"
                  value={
                    form.heightCm || form.weightKg
                      ? `${form.heightCm || '—'} cm · ${form.weightKg || '—'} kg`
                      : 'Not recorded'
                  }
                  numeric
                />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                Contact
              </h3>
              <div className="mt-1.5 space-y-0.5">
                <ClinicalDataRow
                  label="Mobile"
                  value={form.phone ? formatPhone(form.phone) : '—'}
                  numeric
                />
                <ClinicalDataRow label="Email" value={form.email || 'Not given'} />
                <ClinicalDataRow
                  label="Address"
                  value={
                    [form.addressLine, form.city, form.state, form.pincode]
                      .filter(Boolean)
                      .join(', ') || '—'
                  }
                  layout="stacked"
                />
                <ClinicalDataRow
                  label="Emergency contact"
                  value={
                    form.emergencyName
                      ? `${form.emergencyName} (${form.emergencyRelationship || 'Not stated'}) · ${formatPhone(form.emergencyPhone)}`
                      : 'Not given'
                  }
                  layout="stacked"
                />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                Identity and consent
              </h3>
              <div className="mt-1.5 space-y-0.5">
                <ClinicalDataRow
                  label="ABHA number"
                  value={form.abhaNumber ? formatAbha(form.abhaNumber) : 'Not given'}
                  numeric
                />
                <ClinicalDataRow
                  label="Consent"
                  value={
                    form.consentGiven ? (
                      <Badge variant="normal">Recorded</Badge>
                    ) : (
                      <Badge variant="critical">Not recorded</Badge>
                    )
                  }
                />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                Clinical baseline
              </h3>
              {form.allergies.length === 0 && form.chronicConditions.length === 0 ? (
                <p className="mt-1.5 text-xs text-ink-muted">Nothing recorded.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {form.allergies
                    .filter((allergy) => allergy.substance.trim())
                    .map((allergy) => (
                      <AllergyChip
                        key={allergy.id}
                        substance={allergy.substance}
                        severity={allergy.severity}
                        reaction={allergy.reaction}
                        size="sm"
                      />
                    ))}
                  {form.chronicConditions.map((condition) => (
                    <Badge key={condition}>{condition}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
