import type { Observation, VitalKind } from '@adaxai/contracts'

/** The newest reading of each kind: a visit can hold several (a re-check), and only the latest says how the patient stands now. */
export function latestPerKind(vitals: Observation[]): Observation[] {
  const newest = new Map<VitalKind, Observation>()
  for (const o of vitals) {
    const current = newest.get(o.kind)
    if (!current || o.measuredAt > current.measuredAt) newest.set(o.kind, o)
  }
  return [...newest.values()]
}

/**
 * How the latest reading of each kind stands against the adult reference range (a display aid, not a diagnosis; children and kinds
 * without a range are not flagged). `fromDevice` counts readings that came from a device that is not validated in this deployment.
 */
export function vitalsStatus(vitals: Observation[]): { total: number; outside: Observation[]; flagged: boolean; fromDevice: number } {
  const latest = latestPerKind(vitals)
  return {
    total: latest.length,
    outside: latest.filter((o) => o.flag && o.flag !== 'normal'),
    flagged: latest.some((o) => o.flag !== null),
    fromDevice: latest.filter((o) => o.source === 'device').length,
  }
}
