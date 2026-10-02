import fs from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, request as pwRequest } from '@playwright/test'

const envFile = path.resolve(import.meta.dirname, '..', '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

/** Password of the seeded synthetic demo users (generated into .env by `npm run setup`). */
export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? ''
if (!DEMO_PASSWORD) throw new Error('SEED_DEMO_PASSWORD missing from .env; run `npm run setup`')

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help} — ${v.nodes[0]?.target.join(' ')}`)
  expect(summary, 'axe WCAG 2.2 AA violations').toEqual([])
}

/**
 * The page must fit the device width. On phones, Chrome silently widens the
 * layout viewport when anything overflows, which breaks taps; this catches it.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  const viewport = page.viewportSize()!
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: 'page wider than the screen' }).toBeLessThanOrEqual(viewport.width)
  expect(await page.evaluate(() => innerWidth)).toBe(viewport.width)
}

/** Signs in through the UI and waits until the app has left the sign-in page (unless failure is expected). */
export async function signIn(page: Page, username: string, password = DEMO_PASSWORD, opts: { expectFailure?: boolean } = {}) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  if (!opts.expectFailure) await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

/** A unique suffix so tests can run repeatedly against the same dev database. */
export const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Nurse side via the API (its UI is covered by nurse-workflow.spec): register, check in, vitals, ready. */
export async function nurseHandsOverPatient(baseURL: string, opts: { allergies?: string[] } = {}) {
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-adaxai-csrf': '1' } })
  expect((await api.post('/api/auth/login', { data: { username: 'nurse.anil', password: DEMO_PASSWORD } })).ok()).toBe(true)
  const given = `Meena${uniq()}`
  const patient = await (await api.post('/api/patients', { data: { givenName: given, familyName: 'Synthetic', dateOfBirth: '1984-02-11', sex: 'female', phone: `7${String(Date.now()).slice(-9)}` } })).json()
  for (const substance of opts.allergies ?? []) await api.post(`/api/patients/${patient.id}/allergies`, { data: { substance, severity: 'moderate' } })
  const depts = (await (await api.get('/api/departments')).json()).departments
  const visit = await (await api.post('/api/visits', { data: { patientId: patient.id, departmentId: depts.find((d: { code: string }) => d.code === 'GEN').id, chiefComplaint: 'Sore throat and fever' } })).json()
  await api.post(`/api/visits/${visit.id}/observations`, { data: { items: [{ kind: 'temperature', value: 38.2 }, { kind: 'heart_rate', value: 92 }] } })
  await api.post(`/api/visits/${visit.id}/status`, { data: { status: 'ready' } })
  await api.dispose()
  return { name: `${given} Synthetic`, patientId: patient.id as string, mrn: patient.mrn as string }
}

