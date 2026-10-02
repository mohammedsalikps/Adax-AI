import type { LoginRequest, Me, Role } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './api.ts'

export const ME_KEY = ['auth', 'me'] as const

/** The signed-in user, or null. Loaded once; refreshed after login/logout. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api<Me>('/auth/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: Infinity,
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginRequest) => api<Me>('/auth/login', { method: 'POST', body }),
    onSuccess: (me) => {
      qc.clear()
      qc.setQueryData(ME_KEY, me)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // Drop every cached record so nothing from this session survives in memory.
      qc.clear()
      qc.setQueryData(ME_KEY, null)
    },
  })
}

export const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/admin',
  doctor: '/doctor',
  nurse: '/nurse',
  patient: '/patient',
}
