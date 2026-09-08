import { useEffect } from 'react'

const SUFFIX = 'MedConsult'

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
