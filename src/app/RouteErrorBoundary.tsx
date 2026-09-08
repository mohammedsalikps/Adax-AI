import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { CalendarCheck, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button, EmptyState, Panel } from '@/components/ui'

/** Message for the user; never a stack trace. */
function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `The screen returned ${error.status} ${error.statusText}.`
  }
  return 'This screen could not be displayed. The rest of the application is unaffected.'
}

/**
 * Route-level fallback for a render failure. The real error is still logged
 * to the console so it stays visible during development; the user sees a
 * plain message with a way forward.
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  // Keep the underlying error observable to developers.
  console.error('Route render failed:', error)

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Panel title="Something went wrong" icon={TriangleAlert} tone="critical">
        <EmptyState
          icon={TriangleAlert}
          title="This screen could not be displayed"
          description={describe(error)}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                icon={RotateCcw}
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={CalendarCheck}
                onClick={() => navigate('/')}
              >
                Back to Today's Clinic
              </Button>
            </div>
          }
        />
        <p className="mt-2 text-center text-[11px] text-ink-muted">
          Technical details are in the browser console.
        </p>
      </Panel>
    </div>
  )
}
