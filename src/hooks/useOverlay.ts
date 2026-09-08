import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  '[data-autofocus], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Every open overlay pushes its close handler here, most recent last. The
 * Android hardware back button needs this: unlike a browser, it has no other
 * way to know an overlay is open, and without it back would leave the app
 * while a dialog is still on screen.
 */
const overlayCloseStack: Array<() => void> = []

/**
 * Closes the most recently opened overlay. Returns true when one was closed,
 * so the caller can decide whether the back gesture was already consumed.
 */
export function closeTopOverlay(): boolean {
  const close = overlayCloseStack[overlayCloseStack.length - 1]
  if (!close) return false
  close()
  return true
}

/**
 * Shared behaviour for Modal and Drawer: lock background scrolling, close on
 * Escape, move focus into the overlay on open and restore it on close.
 */
export function useOverlay(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    overlayCloseStack.push(onClose)

    containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const index = overlayCloseStack.lastIndexOf(onClose)
      if (index !== -1) overlayCloseStack.splice(index, 1)
      document.body.style.overflow = originalOverflow
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  return containerRef
}
