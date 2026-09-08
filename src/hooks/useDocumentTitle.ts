import { useEffect } from 'react'
import { APP_NAME } from '@/lib/brand'

const SUFFIX = APP_NAME

/** Sets the browser tab title for a screen, restoring it on unmount. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = `${title} · ${SUFFIX}`
    return () => {
      document.title = previous
    }
  }, [title])
}
