/** The text of the confirmation a flagged statement needs before the doctor accepts it. */
export function confirmReasonFor(item: { flags: unknown; needsConfirmation: boolean }): string | null {
  if (!item.needsConfirmation) return null
  const flags = (Array.isArray(item.flags) ? (item.flags as string[]) : []).map((f) => f.replace(/_/g, ' '))
  return `This statement is marked${flags.length ? ` (${flags.join(', ')})` : ''}. Confirm that you have checked it against the record before accepting it.`
}
