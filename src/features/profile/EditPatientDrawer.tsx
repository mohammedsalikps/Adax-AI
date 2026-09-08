import { useState } from 'react'
import { Plus, Save, Trash2, TriangleAlert } from 'lucide-react'
import {
  Badge,
  Button,
  Divider,
  Drawer,
  EmptyState,
  Input,
  Select,
  useToast,
} from '@/components/ui'
import { mockDb } from '@/mock/db'
import type { Patient } from '@/types/patient'
import {
  createEditableAllergy,
  toEditForm,
  toPatientUpdate,
  validateEditForm,
  type EditFormErrors,
  type EditPatientForm,
} from './editPatientForm'

const SEVERITY_OPTIONS = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
]

export interface EditPatientDrawerProps {
  patient: Patient
  open: boolean
  onClose: () => void
  /** Called with the saved record so the profile can refresh. */
  onSaved: (patient: Patient) => void
}

/**
 * Edits the demographic and clinical-baseline fields of a chart.
 * Persists through the mock repository only — no medical record is
 * modified and nothing leaves the browser.
 */
export function EditPatientDrawer({
  patient,
  open,
  onClose,
  onSaved,
}: EditPatientDrawerProps) {
  const { showToast } = useToast()
  const [form, setForm] = useState<EditPatientForm>(() => toEditForm(patient))
  const [errors, setErrors] = useState<EditFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [conditionDraft, setConditionDraft] = useState('')

  function update<K extends keyof EditPatientForm>(key: K, value: EditPatientForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  function addCondition() {
    const value = conditionDraft.trim()
    if (!value || form.chronicConditions.includes(value)) return
    update('chronicConditions', [...form.chronicConditions, value])
    setConditionDraft('')
  }

  async function save() {
    const validation = validateEditForm(form)
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      showToast({
        title: 'Check the highlighted fields',
        description: 'Some details are incomplete or invalid.',
        status: 'warning',
      })
      return
    }

    setSaving(true)
    try {
      const updated = await mockDb.updatePatient(patient.id, toPatientUpdate(form))
      showToast({
        title: 'Patient details updated',
        description: `${updated.fullName} — ${updated.id}`,
        status: 'success',
      })
      onSaved(updated)
      onClose()
    } catch (cause) {
      showToast({
        title: 'Could not save changes',
        description: cause instanceof Error ? cause.message : 'Unexpected error.',
        status: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={saving ? () => undefined : onClose}
      title="Edit patient details"
      description={`${patient.fullName} · ${patient.id}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon={Save} loading={saving} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            required
            wrapperClassName="sm:col-span-2"
            value={form.fullName}
            error={errors.fullName}
            onChange={(event) => update('fullName', event.target.value)}
          />
          <Input
            label="Mobile number"
            required
            numeric
            inputMode="tel"
            maxLength={10}
            value={form.phone}
            error={errors.phone}
            onChange={(event) => update('phone', event.target.value)}
          />
          <Input
            label="Email"
            type="email"
            placeholder="Optional"
            value={form.email}
            error={errors.email}
            onChange={(event) => update('email', event.target.value)}
          />
        </section>

        <div>
          <Divider label="Address" />
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Address"
              required
              wrapperClassName="sm:col-span-2"
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
          </div>
        </div>

        <div>
          <Divider label="Emergency contact" />
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              placeholder="Optional"
              value={form.emergencyName}
              onChange={(event) => update('emergencyName', event.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Relationship"
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
        </div>

        <div>
          <Divider label="Allergies" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              Severe allergies are shown in red throughout the chart.
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() => update('allergies', [...form.allergies, createEditableAllergy()])}
            >
              Add
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
              className="mt-2 rounded-control border border-dashed border-line"
            />
          ) : (
            <div className="mt-3 space-y-3">
              {form.allergies.map((allergy, index) => (
                <div
                  key={allergy.id}
                  className="grid grid-cols-1 items-end gap-3 rounded-control border border-line bg-surface-alt p-3 sm:grid-cols-[1fr_1fr_130px_auto]"
                >
                  <Input
                    label="Substance"
                    size="sm"
                    value={allergy.substance}
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
                    aria-label={`Remove allergy ${allergy.substance || index + 1}`}
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

        <div>
          <Divider label="Existing conditions" />
          <div className="mt-3 flex items-end gap-2">
            <Input
              label="Condition"
              size="sm"
              placeholder="Type 2 diabetes mellitus"
              value={conditionDraft}
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

          {form.chronicConditions.length > 0 ? (
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
          ) : (
            <p className="mt-2 text-xs text-ink-muted">None recorded.</p>
          )}
        </div>

        <Badge variant="ai">
          Mock persistence — stored in this browser only
        </Badge>
      </div>
    </Drawer>
  )
}
