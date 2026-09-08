import { Plus, Trash2 } from 'lucide-react'
import { Button, EmptyState, Input } from '@/components/ui'
import type { ConsultationDiagnosis } from '@/types/consultation'

export interface DiagnosisEditorProps {
  diagnoses: ConsultationDiagnosis[]
  errors: Record<string, string>
  onChange: (diagnoses: ConsultationDiagnosis[]) => void
  onAdd: () => void
  disabled?: boolean
}

export function DiagnosisEditor({
  diagnoses,
  errors,
  onChange,
  onAdd,
  disabled = false,
}: DiagnosisEditorProps) {
  function updateAt(index: number, changes: Partial<ConsultationDiagnosis>) {
    const next = [...diagnoses]
    next[index] = { ...next[index], ...changes }
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {diagnoses.length === 0 ? (
        <EmptyState
          size="sm"
          title="No diagnosis recorded"
          description="Add one or more diagnoses for this consultation."
          className="rounded-control border border-dashed border-line"
        />
      ) : (
        diagnoses.map((diagnosis, index) => (
          <div
            key={diagnosis.id}
            className="grid grid-cols-1 items-start gap-3 rounded-control border border-line bg-surface-alt p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <Input
              label={`Diagnosis ${index + 1}`}
              size="sm"
              placeholder="Type 2 diabetes mellitus"
              value={diagnosis.name}
              error={errors[diagnosis.id]}
              disabled={disabled}
              onChange={(event) => updateAt(index, { name: event.target.value })}
            />
            <Input
              label="Notes"
              size="sm"
              placeholder="Optional — staging, severity, laterality"
              value={diagnosis.notes ?? ''}
              disabled={disabled}
              onChange={(event) => updateAt(index, { notes: event.target.value })}
            />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={Trash2}
              disabled={disabled}
              aria-label={`Remove diagnosis ${diagnosis.name || index + 1}`}
              className="mt-[22px]"
              onClick={() => onChange(diagnoses.filter((item) => item.id !== diagnosis.id))}
            />
          </div>
        ))
      )}

      <Button size="sm" variant="secondary" icon={Plus} onClick={onAdd} disabled={disabled}>
        Add diagnosis
      </Button>
    </div>
  )
}
