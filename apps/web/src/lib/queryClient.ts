import { applicationOf, type Me } from '@adaxai/contracts'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api.ts'
import { markSessionEnded } from './sessionEnd.ts'
import { ME_KEY, replaceSession } from './session.ts'

/**
 * A 401 from any request made while signed in means the session ended (logout
 * elsewhere, expiry, deactivation). Everything cached is dropped and `me` is
 * cleared, which sends the person back to their application's sign-in page
 * with a notice; nothing of the old session stays on screen. A failed sign-in
 * is a 401 too, but it is not made while signed in.
 */
export function createQueryClient(): QueryClient {
  const sessionEnded = (e: unknown) => {
    if (!(e instanceof ApiError) || e.status !== 401) return
    const me = client.getQueryData<Me | null>(ME_KEY)
    if (!me) return
    markSessionEnded(applicationOf(me.role))
    replaceSession(client, null)
  }
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (e, query) => query.queryKey[0] !== ME_KEY[0] && sessionEnded(e) }),
    mutationCache: new MutationCache({ onError: (e) => sessionEnded(e) }),
    defaultOptions: {
      queries: {
        retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
        refetchOnWindowFocus: true,
        staleTime: 15_000,
      },
      // A finished mutation is forgotten as soon as nothing shows it: its variables can hold a password (sign-in, activation, a new
      // password, a temporary one), and the default is to keep them for five minutes.
      mutations: { retry: false, gcTime: 0 },
    },
  })
  return client
}
