import { useQuery } from '@tanstack/react-query'
import { CircleCheck, LoaderCircle } from 'lucide-react'
import { api } from '../../lib/api.ts'
import { ErrorBanner } from './ErrorBanner.tsx'

/**
 * Whether signing in can work right now: the API answers and its database is
 * ready (GET /api/ready, which is public and returns only readiness and the
 * database's latency). When it cannot,
 * the selector says so before anyone types a password, with a retry.
 */
export function ServiceStatus() {
  const q = useQuery({
    queryKey: ['service', 'ready'],
    queryFn: () => api<{ status: string }>('/ready'),
    retry: false,
    networkMode: 'always',
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  })
  if (q.isError) {
    return <ErrorBanner view={{ problem: 'unavailable', title: 'Sign-in is temporarily unavailable', message: 'The service is not responding right now. Please try again in a moment.', retry: true }} onRetry={() => void q.refetch()} retrying={q.isFetching} />
  }
  return (
    <p role="status" className="flex items-center justify-center gap-2 text-sm text-ink-muted" data-testid="service-status">
      {q.isPending ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Checking the sign-in service…
        </>
      ) : (
        <>
          <CircleCheck aria-hidden="true" className="size-4 text-ok" />
          Sign-in service available
        </>
      )}
    </p>
  )
}
