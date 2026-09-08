import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Select } from '@/components/ui'
import { SEED_FORMULARY } from '@/mock/medications'
import type { ConsultationPrescriptionItem } from '@/types/consultation'
import type { DoseFrequency, DoseRoute } from '@/types/prescription'
import {
  FREQUENCY_OPTIONS,
  ROUTE_OPTIONS,
  type PrescriptionFieldError,
} from './consultationForm'

export interface PrescriptionEditorProps {
  items: ConsultationPrescriptionItem[]
  errors: Record<string, PrescriptionFieldError>
  onChange: (items: ConsultationPrescriptionItem[]) => void
  onAdd: () => void
  disabled?: boolean
}

/**
 * Free-text prescription entry with optional lookup against the mock
 * formulary. Every line is entered by the doctor: the assistant cannot
 * create one. There is no interaction checking, allergy cross-checking or
 * clinical decision support — those remain out of scope.
 */
export function PrescriptionEditor({
  items,
  errors,
  onChange,
  onAdd,
  disabled = false,
}: PrescriptionEditorProps) {
  const listId = useId()

  function updateAt(index: number, changes: Partial<ConsultationPrescriptionItem>) {
    const next = [...items]
    next[index] = { ...next[index], ...changes }
    onChange(next)
  }

  /** Fills generic name and strength when a formulary brand is typed. */
  function applyFormulary(index: number, brand: string) {
    const match = SEED_FORMULARY.find(
      (drug) => drug.brandName.toLowerCase() === brand.trim().toLowerCase(),
    )
    if (!match) {
      updateAt(index, { medication: brand })
      return
    }
    updateAt(index, {
      medication: match.brandName,
      genericName: match.genericName,
      strength: match.strength,
      route: match.route,
    })
  }

  return (
    <div className="space-y-3">
      {/* One shared suggestion list for every medication field. */}
      <datalist id={listId}>
        {SEED_FORMULARY.map((drug) => (
          <option key={drug.id} value={drug.brandName}>
            {drug.genericName} {drug.strength}
          </option>
        ))}
      </datalist>

      {items.length === 0 ? (
        <EmptyState
          size="sm"
          title="Nothing prescribed"
          description="Add a medication to build the prescription for this visit."
          className="rounded-control border border-dashed border-line"
        />
      ) : (
        items.map((item, index) => {
          const rowErrors = errors[item.id] ?? {}

          return (
            <div
              key={item.id}
              className="rounded-control border border-line bg-surface-alt p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                    Medication {index + 1}
                  </p>
                  <Badge variant="accent">Doctor-entered</Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={Trash2}
                  disabled={disabled}
                  aria-label={`Remove medication ${item.medication || index + 1}`}
                  onClick={() => onChange(items.filter((row) => row.id !== item.id))}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Input
                  label="Medication"
                  size="sm"
                  required
                  list={listId}
                  placeholder="Paracetamol"
                  hint="Start typing to match the formulary"
                  value={item.medication}
                  error={rowErrors.medication}
                  disabled={disabled}
                  onChange={(event) => applyFormulary(index, event.target.value)}
                />
                <Input
                  label="Generic name"
                  size="sm"
                  placeholder="Acetaminophen"
                  value={item.genericName ?? ''}
                  disabled={disabled}
                  onChange={(event) => updateAt(index, { genericName: event.target.value })}
                />
                <Input
                  label="Strength"
                  size="sm"
                  placeholder="500 mg"
                  value={item.strength ?? ''}
                  disabled={disabled}
                  onChange={(event) => updateAt(index, { strength: event.target.value })}
                />
                <Input
                  label="Dose"
                  size="sm"
                  required
                  placeholder="1 tablet"
                  value={item.dose}
                  error={rowErrors.dose}
                  disabled={disabled}
                  onChange={(event) => updateAt(index, { dose: event.target.value })}
                />
                <Select
                  label="Frequency"
                  size="sm"
                  required
                  options={FREQUENCY_OPTIONS}
                  value={item.frequency}
                  error={rowErrors.frequency}
                  disabled={disabled}
                  onChange={(event) =>
                    updateAt(index, { frequency: event.target.value as DoseFrequency })
                  }
                />
                <Select
                  label="Route"
                  size="sm"
                  options={ROUTE_OPTIONS}
                  value={item.route}
                  disabled={disabled}
                  onChange={(event) =>
                    updateAt(index, { route: event.target.value as DoseRoute })
                  }
                />
                <Input
                  label="Duration"
                  size="sm"
                  required
                  placeholder="5 days"
                  value={item.duration}
                  error={rowErrors.duration}
                  disabled={disabled}
                  onChange={(event) => updateAt(index, { duration: event.target.value })}
                />
                <Input
                  label="Quantity"
                  size="sm"
                  placeholder="10 tablets"
                  value={item.quantity ?? ''}
                  disabled={disabled}
                  onChange={(event) => updateAt(index, { quantity: event.target.value })}
                />
                <Input
                  label="Instructions"
                  size="sm"
                  placeholder="After food"
                  value={item.instructions ?? ''}
                  disabled={disabled}
                  onChange={(event) => updateAt(index, { instructions: event.target.value })}
                />
              </div>
            </div>
          )
        })
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={Plus} onClick={onAdd} disabled={disabled}>
          Add medication
        </Button>
        {items.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            disabled={disabled}
            onClick={() => onChange([])}
          >
            Clear prescription
          </Button>
        )}
      </div>
    </div>
  )
}
