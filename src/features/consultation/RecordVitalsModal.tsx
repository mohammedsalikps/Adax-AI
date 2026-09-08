import { useState } from 'react'
import { Activity } from 'lucide-react'
import { Button, Input, Modal, useToast } from '@/components/ui'
import { VITAL_DEFINITIONS, VITAL_ORDER, classifyVital, referenceRangeLabel } from '@/lib/vitals'
import { mockDb } from '@/mock/db'
import type { VitalKey, VitalReading, VitalsSnapshot } from '@/types/vitals'

export interface RecordVitalsModalProps {
  patientId: string
  open: boolean
  onClose: () => void
  onRecorded: (snapshot: VitalsSnapshot) => void
}

type DraftValues = Partial<Record<VitalKey, string>>

/**
 * Captures a new set of vitals. Statuses are derived by classifyVital from
 * the shared reference ranges — never entered or hard-coded here.
 */
export function RecordVitalsModal({
  patientId,
  open,
  onClose,
  onRecorded,
}: RecordVitalsModalProps) {
  const { showToast } = useToast()
  const [values, setValues] = useState<DraftValues>({})
  const [errors, setErrors] = useState<Partial<Record<VitalKey, string>>>({})
  const [saving, setSaving] = useState(false)

  function update(key: VitalKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  async function save() {
    const nextErrors: Partial<Record<VitalKey, string>> = {}
    const readings: Partial<Record<VitalKey, VitalReading>> = {}
    const recordedAt = new Date().toISOString()

    for (const key of VITAL_ORDER) {
      const raw = values[key]?.trim()
      if (!raw) continue

      const value = Number(raw)
      if (!Number.isFinite(value) || value <= 0) {
        nextErrors[key] = 'Enter a number.'
        continue
      }
      readings[key] = { key, value, status: classifyVital(key, value), recordedAt }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    if (Object.keys(readings).length === 0) {
      showToast({
        title: 'Nothing to record',
        description: 'Enter at least one measurement.',
        status: 'warning',
      })
      return
    }

    setSaving(true)
    try {
      const snapshot = await mockDb.recordVitals(patientId, { recordedAt, readings })
      showToast({ title: 'Vitals recorded', status: 'success' })
      onRecorded(snapshot)
      setValues({})
      onClose()
    } catch (cause) {
      showToast({
        title: 'Could not record vitals',
        description: cause instanceof Error ? cause.message : 'Unexpected error.',
        status: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title="Record vitals"
      description="Leave a field blank if that measurement was not taken."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon={Activity} loading={saving} onClick={() => void save()}>
            Save vitals
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {VITAL_ORDER.map((key) => (
          <Input
            key={key}
            label={VITAL_DEFINITIONS[key].label}
            size="sm"
            numeric
            inputMode="decimal"
            suffix={VITAL_DEFINITIONS[key].unit}
            hint={referenceRangeLabel(key)}
            value={values[key] ?? ''}
            error={errors[key]}
            onChange={(event) => update(key, event.target.value)}
          />
        ))}
      </div>
    </Modal>
  )
}
