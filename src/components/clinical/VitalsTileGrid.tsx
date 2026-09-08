import { Droplet, HeartPulse, Ruler, Thermometer, Weight, Wind } from 'lucide-react'
import { cn } from '@/lib/cn'
import { VITAL_DEFINITIONS, formatVitalValue, referenceRangeLabel } from '@/lib/vitals'
import type { VitalStatus, VitalsSnapshot } from '@/types/vitals'
import { VitalTile } from './VitalTile'

export interface VitalsTileGridProps {
  snapshot: VitalsSnapshot
  /** Shown as unclassified tiles — height and weight have no clinical
   *  reference range in this model, so they carry no status colour. */
  heightCm?: number
  weightKg?: number
  className?: string
}

/** The worse of two readings drives a combined tile's colour. */
function worstOf(a: VitalStatus, b: VitalStatus): VitalStatus {
  if (a === 'critical' || b === 'critical') return 'critical'
  if (a === 'caution' || b === 'caution') return 'caution'
  return 'normal'
}

/**
 * One snapshot rendered as status-coloured tiles. Statuses come from the
 * snapshot, which derives them from the shared reference ranges — nothing
 * here decides whether a reading is normal.
 */
export function VitalsTileGrid({
  snapshot,
  heightCm,
  weightKg,
  className,
}: VitalsTileGridProps) {
  const { readings } = snapshot
  const systolic = readings.systolicBp
  const diastolic = readings.diastolicBp
  const bmi =
    heightCm && weightKg ? weightKg / (heightCm / 100) ** 2 : undefined

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4',
        className,
      )}
    >
      {systolic && diastolic ? (
        <VitalTile
          label="BP"
          value={`${formatVitalValue('systolicBp', systolic.value)}/${formatVitalValue('diastolicBp', diastolic.value)}`}
          unit="mmHg"
          status={worstOf(systolic.status, diastolic.status)}
          hint="90–130 / 60–85 mmHg"
        />
      ) : (
        <UnavailableTile label="BP" />
      )}

      {readings.heartRate ? (
        <VitalTile
          label="Heart rate"
          value={formatVitalValue('heartRate', readings.heartRate.value)}
          unit={VITAL_DEFINITIONS.heartRate.unit}
          status={readings.heartRate.status}
          icon={HeartPulse}
          hint={referenceRangeLabel('heartRate')}
        />
      ) : (
        <UnavailableTile label="Heart rate" />
      )}

      {readings.temperature ? (
        <VitalTile
          label="Temp"
          value={formatVitalValue('temperature', readings.temperature.value)}
          unit="°C"
          status={readings.temperature.status}
          icon={Thermometer}
          hint={referenceRangeLabel('temperature')}
        />
      ) : (
        <UnavailableTile label="Temp" />
      )}

      {readings.respiratoryRate ? (
        <VitalTile
          label="Resp rate"
          value={formatVitalValue('respiratoryRate', readings.respiratoryRate.value)}
          unit="/min"
          status={readings.respiratoryRate.status}
          hint={referenceRangeLabel('respiratoryRate')}
        />
      ) : (
        <UnavailableTile label="Resp rate" />
      )}

      {readings.spo2 ? (
        <VitalTile
          label="SpO₂"
          value={formatVitalValue('spo2', readings.spo2.value)}
          unit="%"
          status={readings.spo2.status}
          icon={Wind}
          hint={referenceRangeLabel('spo2')}
        />
      ) : (
        <UnavailableTile label="SpO₂" />
      )}

      {readings.bloodGlucose && (
        <VitalTile
          label="Glucose"
          value={formatVitalValue('bloodGlucose', readings.bloodGlucose.value)}
          unit="mg/dL"
          status={readings.bloodGlucose.status}
          icon={Droplet}
          hint={referenceRangeLabel('bloodGlucose')}
        />
      )}

      {weightKg !== undefined && (
        <VitalTile
          label="Weight"
          value={weightKg.toFixed(1)}
          unit="kg"
          icon={Weight}
          hint={bmi ? `BMI ${bmi.toFixed(1)}` : undefined}
        />
      )}

      {heightCm !== undefined && (
        <VitalTile label="Height" value={heightCm} unit="cm" icon={Ruler} />
      )}
    </div>
  )
}

/** Explicit "not measured" tile, so a gap is never mistaken for a value. */
function UnavailableTile({ label }: { label: string }) {
  return (
    <div className="flex flex-col justify-between gap-1.5 rounded-control border border-dashed border-line bg-surface-alt p-3">
      <span className="truncate text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
        {label}
      </span>
      <span className="text-sm font-medium text-ink-muted">Not recorded</span>
    </div>
  )
}
