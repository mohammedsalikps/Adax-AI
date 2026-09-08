/** Shared sizing scale for every form control. */
export type ControlSize = 'sm' | 'md' | 'lg'

export const CONTROL_SIZE_CLASSES: Record<ControlSize, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-[13px]',
  lg: 'h-10 px-3.5 text-sm',
}

/** Base appearance shared by Input, Select and Textarea. */
export const CONTROL_BASE_CLASSES =
  'w-full rounded-control border bg-surface text-ink transition-colors placeholder:text-ink-muted ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted'

export function controlBorderClasses(hasError: boolean): string {
  return hasError
    ? 'border-critical focus:border-critical'
    : 'border-line hover:border-line-strong focus:border-accent'
}
