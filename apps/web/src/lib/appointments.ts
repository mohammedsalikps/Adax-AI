import { NOTIFICATION_FAILURE_LABELS } from '@adaxai/contracts'
import type {
  Appointment,
  AppointmentDetail,
  AppointmentList,
  AppointmentOptions,
  AppointmentQuery,
  CancelAppointmentRequest,
  CheckInResult,
  CreateAppointmentRequest,
  NoShowAppointmentRequest,
  PatientAppointments,
  RescheduleAppointmentRequest,
  RetryNotificationsResult,
} from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, errorMessage } from './api.ts'
import { fmtDate } from './format.ts'

/**
 * Appointment times arrive already on the clinic's clock as a day (YYYY-MM-DD)
 * and a clock time (HH:MM). They are only formatted here, never converted:
 * the browser's own timezone plays no part.
 */
export function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' }).format(new Date(2000, 0, 1, h, m))
}

export const fmtWhen = (localDate: string, localTime: string) => `${fmtDate(localDate)}, ${fmtClock(localTime)}`

/** An instant shown on a named timezone (messages and the portal carry the clinic's timezone). */
export function fmtInstantIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(iso))
}

/** What the person is told when a save fails: the server's words, except where the code deserves plainer ones. */
export function appointmentErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'idempotency_key_reused') return 'A booking from this window was already saved. Close this window and check the schedule before booking again.'
    if (e.code === 'try_again') return e.message
  }
  return errorMessage(e)
}

export const appointmentsKey = ['appointments'] as const

export function useAppointments(params: AppointmentQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...appointmentsKey, 'list', params],
    queryFn: () =>
      api<AppointmentList>('/appointments', {
        query: { scope: params.scope, date: params.date, status: params.status, mine: params.mine, doctorId: params.doctorId },
      }),
    // The schedule is shared; poll so check-ins and cancellations by others appear without reloading. Every list read is audited
    // (with the patients it disclosed), so this is a minute, and only while the tab is visible (the default).
    refetchInterval: 60_000,
  })
}

export const useAppointmentOptions = () => useQuery({ queryKey: [...appointmentsKey, 'options'], queryFn: () => api<AppointmentOptions>('/appointments/options'), staleTime: 60_000 })

export function useAppointment(id: string | null) {
  return useQuery({ queryKey: [...appointmentsKey, 'detail', id], queryFn: () => api<AppointmentDetail>(`/appointments/${id}`), enabled: !!id, staleTime: 0 })
}

export function usePatientAppointments(patientId: string) {
  return useQuery({ queryKey: [...appointmentsKey, 'patient', patientId], queryFn: () => api<PatientAppointments>(`/patients/${patientId}/appointments`) })
}

/** A change to an appointment can change the schedule, the queue (check-in, a closed visit) and the patient's record. */
function useRefresh() {
  const qc = useQueryClient()
  return (patientId?: string) => {
    void qc.invalidateQueries({ queryKey: appointmentsKey })
    void qc.invalidateQueries({ queryKey: ['visits'] })
    if (patientId) void qc.invalidateQueries({ queryKey: ['patient', patientId] })
  }
}

export function useBookAppointment() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (body: CreateAppointmentRequest) => api<Appointment>('/appointments', { method: 'POST', body }), onSuccess: (a) => refresh(a.patient?.id) })
}

export function useRescheduleAppointment(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (body: RescheduleAppointmentRequest) => api<Appointment>(`/appointments/${id}/reschedule`, { method: 'POST', body }), onSuccess: (a) => refresh(a.patient?.id), onError: () => refresh() })
}

export function useCancelAppointment(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (body: CancelAppointmentRequest) => api<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body }), onSuccess: (a) => refresh(a.patient?.id), onError: () => refresh() })
}

export function useNoShowAppointment(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (body: NoShowAppointmentRequest) => api<Appointment>(`/appointments/${id}/no-show`, { method: 'POST', body }), onSuccess: (a) => refresh(a.patient?.id), onError: () => refresh() })
}

/** Check-in is safe to repeat: it returns the visit that was already made. */
export function useCheckInAppointment() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (v: { id: string; version?: number }) => api<CheckInResult>(`/appointments/${v.id}/check-in`, { method: 'POST', body: v.version ? { version: v.version } : {} }), onSuccess: (r) => refresh(r.appointment.patient?.id), onError: () => refresh() })
}

export function useRetryNotifications(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: () => api<RetryNotificationsResult>(`/appointments/${id}/notifications/retry`, { method: 'POST' }), onSuccess: () => refresh() })
}

/**
 * What staff are told about the patient after a booking, move or cancellation.
 * The only channel is the patient portal, so "told" means the message is
 * available there; when it is not, staff are warned instead of reassured.
 */
export function patientNote(a: Pick<Appointment, 'patientMessage'>): { tone: 'success' | 'warning'; text: string } {
  const m = a.patientMessage
  if (m?.status === 'delivered') return { tone: 'success', text: 'The message is available in the patient portal.' }
  const why = (m?.code && NOTIFICATION_FAILURE_LABELS[m.code]) || 'The message was not delivered.'
  return { tone: 'warning', text: `The patient has not been told. ${why} Nothing is sent by SMS or email; tell them another way, or use Try again in the appointment’s details.` }
}
