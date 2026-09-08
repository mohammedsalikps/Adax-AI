import { LoadingState } from '@/components/ui'

/**
 * Shown while a lazily loaded route chunk is fetched. The shell — sidebar,
 * topbar and navigation — stays interactive behind it.
 */
export function RouteFallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <LoadingState label="Loading screen" />
    </div>
  )
}
