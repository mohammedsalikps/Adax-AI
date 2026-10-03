const SIZES = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } as const

/** First and last initial of a name, ignoring a title ("Dr."), a suffix ("Jr.") and anything in brackets ("(synthetic)", "(not verified)"): "Dr. Meera Iyer (synthetic)" is MI; one word gives one letter. */
export function initialsOf(name: string): string {
  const parts = name
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !/^(dr|mr|mrs|ms|miss|prof|jr|sr|ii|iii)\.?$/i.test(w))
  if (!parts.length) return '?'
  const first = parts[0]!
  const last = parts.length > 1 ? parts[parts.length - 1]! : ''
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

/**
 * Initials on a soft tint. There are no patient photographs in the product,
 * and a name is always printed beside the avatar, so it is hidden from
 * assistive technology (it carries no information of its own).
 */
export function PatientAvatar({ name, size = 'md', className = '' }: { name: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-strong ${SIZES[size]} ${className}`}>
      {initialsOf(name)}
    </span>
  )
}
