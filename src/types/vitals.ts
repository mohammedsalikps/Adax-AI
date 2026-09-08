/** Live health inputs. Values arrive from a simulated device stream. */

export type VitalKey =
  | 'heartRate'
  | 'systolicBp'
  | 'diastolicBp'
  | 'spo2'
  | 'temperature'
  | 'respiratoryRate'
  | 'bloodGlucose'

export type VitalStatus = 'normal' | 'caution' | 'critical'

export interface VitalDefinition {
  key: VitalKey
  label: string
  shortLabel: string
  /** India convention: glucose in mg/dL, temperature in °C. */
  unit: string
  normalRange: [number, number]
  cautionRange: [number, number]
  decimals: number
}

export interface VitalReading {
  key: VitalKey
  value: number
  status: VitalStatus
  recordedAt: string
}

export interface VitalsSnapshot {
  recordedAt: string
  readings: Partial<Record<VitalKey, VitalReading>>
}
