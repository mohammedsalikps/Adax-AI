import { QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'
import { ME_KEY } from './auth.tsx'

/**
 * A 401 from any query means the session ended (logout elsewhere, expiry,
 * deactivation). Clearing `me` sends the user back to the sign-in page.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (e, query) => {
        if (e instanceof ApiError && e.status === 401 && query.queryKey !== ME_KEY) {
          client.clear()
          client.setQueryData(ME_KEY, null)
        }
      },
    }),
    defaultOptions: {
      queries: {
        retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
        refetchOnWindowFocus: true,
        staleTime: 15_000,
      },
      mutations: { retry: false },
    },
  })
  return client
}
