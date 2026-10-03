import { APPLICATION_ROLES, type LoginRequest, type Me, type Role } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { ApiError, api } from './api.ts'
import { checkSession, ME_KEY, replaceSession } from './session.ts'
import { markSignedOut } from './sessionEnd.ts'

/**
 * The signed-in user, or null. Loaded once, and checked again whenever the tab
 * or window is looked at again (lib/focus.ts): the session cookie is shared by
 * every tab, so a sign-in or sign-out in another tab changes who this one is,
 * and nothing of the person who was here may stay on screen (the routing guard
 * remounts the page for a different person). If the check itself fails (the
 * service is down) the person already shown stays shown; only a refusal changes
 * who they are.
 */
export function useMe() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => checkSession(qc),
    staleTime: Infinity,
    refetchOnWindowFocus: 'always',
    // A browser that thinks it is offline must still say so, not wait silently: the request is made and fails.
    networkMode: 'always',
    retry: false,
  })
}

/**
 * For code that sends something when a page closes (a last autosave, the final
 * chunk of a recording): true only while the person signed in is still the one
 * who was signed in when the page opened. When another person has taken over
 * (a sign-in in another tab), the page is rebuilt for them, and whatever the
 * first person had pending must not go out under the new person's session.
 */
export function useStillSamePerson(): () => boolean {
  const qc = useQueryClient()
  const opened = useRef(qc.getQueryData<Me | null>(ME_KEY)?.id)
  return useCallback(() => opened.current !== undefined && qc.getQueryData<Me | null>(ME_KEY)?.id === opened.current, [qc])
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    // The variables hold the password: the mutation is forgotten as soon as nothing is showing it (a success also clears the whole cache).
    gcTime: 0,
    mutationFn: async (body: LoginRequest) => {
      const me = await api<Me>('/auth/login', { method: 'POST', body })
      // The API already refuses an account at the wrong door. If a session ever came back for the wrong role, it is ended
      // before anything of it reaches the cache or the screen, and the person is told as at any wrong door.
      if (body.application && !APPLICATION_ROLES[body.application].includes(me.role)) {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
        throw new ApiError(403, 'wrong_application', 'This account cannot sign in to this application.')
      }
      return me
    },
    onSuccess: (me) => replaceSession(qc, me),
  })
}

/**
 * Signs out. The person is shown as signed out only when the server confirms it
 * (or says there was no session, 401): if the request fails, the session cookie
 * may still be valid, so they stay signed in and are told it did not work.
 */
export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      try {
        await api('/auth/logout', { method: 'POST' })
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e
      }
    },
    // Drop every cached record so nothing from this session survives in memory.
    onSuccess: () => {
      markSignedOut()
      replaceSession(qc, null)
    },
  })
}

export const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/admin',
  doctor: '/doctor',
  nurse: '/nurse',
  patient: '/patient',
}
