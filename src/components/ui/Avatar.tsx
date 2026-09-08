import { useState } from 'react'
import { cn } from '@/lib/cn'
import { initialsOf } from '@/lib/format'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'size-6 text-[9px]',
  sm: 'size-8 text-[10px]',
  md: 'size-10 text-xs',
  lg: 'size-14 text-sm',
  xl: 'size-20 text-lg',
}

export interface AvatarProps {
  /** Photo URL. Falls back to initials if absent or if loading fails. */
  src?: string
  /** Used for the initials fallback and the accessible name. */
  name: string
  size?: AvatarSize
  shape?: 'circle' | 'rounded'
  /** Hides the avatar from assistive technology when the name is already
   *  rendered next to it, so it is not announced twice. */
  decorative?: boolean
  className?: string
}

export function Avatar({
  src,
  name,
  size = 'md',
  shape = 'circle',
  decorative = false,
  className,
}: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed

  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-line bg-accent-soft font-semibold text-accent-ink select-none',
        shape === 'circle' ? 'rounded-full' : 'rounded-control',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={decorative ? '' : name}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
      {!showImage && !decorative && <span className="sr-only">{name}</span>}
    </span>
  )
}
