/** Identifier generation for the mock data layer. */

const PATIENT_ID_PATTERN = /^PT-(\d{4})-(\d{5})$/

/** Builds a clinic patient ID, e.g. PT-2026-00142. */
function formatPatientId(year: number, sequence: number): string {
  return `PT-${year}-${String(sequence).padStart(5, '0')}`
}

/**
 * Next patient ID for the current year, one above the highest existing
 * sequence. Ignores identifiers that do not match the clinic format.
 */
export function nextPatientId(existingIds: string[], now = new Date()): string {
  const year = now.getFullYear()

  const highest = existingIds.reduce((max, id) => {
    const match = PATIENT_ID_PATTERN.exec(id)
    if (!match || Number(match[1]) !== year) return max
    return Math.max(max, Number(match[2]))
  }, 0)

  return formatPatientId(year, highest + 1)
}

/** Prefixed random id for records the mock layer creates at runtime. */
export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
