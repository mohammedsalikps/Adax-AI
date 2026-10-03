import crypto from 'node:crypto'
import { type APIRequestContext, type Browser, expect, request as pwRequest } from '@playwright/test'
import { DEMO_PASSWORD } from './support.ts'

/** Staff API session (test setup only; the journeys themselves run through the UI). */
export async function staff(baseURL: string, username: string): Promise<APIRequestContext> {
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-adaxai-csrf': '1' } })
  expect((await api.post('/api/auth/login', { data: { username, password: DEMO_PASSWORD } })).ok()).toBe(true)
  return api
}

export const addDays = (date: string, n: number) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)).toISOString().slice(0, 10)
export const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/** How the app shows a clinic-clock time (10:30 is "10:30 am"): matched loosely on the digits and am/pm, not on the space character. */
export function clockText(time: string): RegExp {
  const h = Number(time.slice(0, 2))
  return new RegExp(String.raw`\b${h % 12 || 12}:${time.slice(3, 5)}\s?${h < 12 ? 'am' : 'pm'}`, 'i')
}

/** A slot far from every other test's (tests share one database and run side by side): a random day 3 to 150 days ahead, on a five-minute time. */
export async function randomSlot(api: APIRequestContext) {
  const today = (await (await api.get('/api/appointments/options')).json()).today as string
  const date = addDays(today, 3 + Math.floor(Math.random() * 148))
  return { today, date, time: hhmm(8 + Math.floor(Math.random() * 10), 5 * Math.floor(Math.random() * 12)) }
}

export async function newPatient(api: APIRequestContext, given: string) {
  const p = await (await api.post('/api/patients', { data: { givenName: given, familyName: 'Synthetic', dateOfBirth: '1988-05-09', sex: 'female', phone: `8${String(Date.now()).slice(-9)}` } })).json()
  return { id: p.id as string, name: `${given} Synthetic`, mrn: p.mrn as string, given }
}

export async function gen(api: APIRequestContext) {
  const depts = (await (await api.get('/api/departments')).json()).departments as { id: string; code: string }[]
  return depts.find((d) => d.code === 'GEN')!.id
}

export async function bookViaApi(api: APIRequestContext, patientId: string, slot: { date: string; time: string }, doctorId: string | null = null) {
  const res = await api.post('/api/appointments', { data: { patientId, departmentId: await gen(api), doctorId, date: slot.date, time: slot.time, durationMinutes: 15, reason: 'Sore throat', idempotencyKey: crypto.randomUUID() } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as { id: string; version: number }
}

export async function otherContext(browser: Browser, baseURL: string, isMobile: boolean) {
  const ctx = await browser.newContext({ baseURL, ...(isMobile && { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }) })
  return { ctx, page: await ctx.newPage() }
}
