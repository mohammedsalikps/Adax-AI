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
  // On failure, name the outermost elements that stick out (elements inside a
  // horizontally scrolling container, such as wide tables, are not counted).
  const offenders = () =>
    page.evaluate(() => {
      const W = document.documentElement.clientWidth
      const scrolls = (el: Element | null): boolean => !!el && (['auto', 'scroll'].includes(getComputedStyle(el).overflowX) || scrolls(el.parentElement))
      return [...document.querySelectorAll('body *')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          const parent = el.parentElement?.getBoundingClientRect()
          return r.width > 0 && r.right > W + 0.5 && (!parent || parent.right <= W + 0.5) && !scrolls(el.parentElement)
        })
        .slice(0, 5)
        .map((el) => `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') ?? '').slice(0, 100)}"> right=${Math.round(el.getBoundingClientRect().right)}: ${(el.textContent ?? '').trim().slice(0, 80)}`)
    })
  await expect
    .poll(async () => {
      const width = await page.evaluate(() => document.documentElement.scrollWidth)
      return width <= viewport.width ? 'fits' : `page ${width}px wider than the ${viewport.width}px screen; overflowing: ${(await offenders()).join(' | ') || 'none found'}`
    })
    .toBe('fits')
  expect(await page.evaluate(() => innerWidth)).toBe(viewport.width)
}

export type EntryApp = 'doctor' | 'patient' | 'admin'

/** The application a demo account signs in to: administrators have their own, patients sign in by MRN, all clinical staff use the Doctor App. */
export const appFor = (username: string): EntryApp => (/^admin/i.test(username) ? 'admin' : /^ADX-/i.test(username) ? 'patient' : 'doctor')

/** Signs in through the UI, at the sign-in page of the account's application, and waits until the app has left it (unless failure is expected). */
export async function signIn(page: Page, username: string, password = DEMO_PASSWORD, opts: { expectFailure?: boolean; app?: EntryApp } = {}) {
  await page.goto(`/login/${opts.app ?? appFor(username)}`)
  await page.getByLabel(/^(Doctor username|Admin username|MRN)/).fill(username)
  await page.getByLabel(/^Password/).fill(password)
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
export async function nurseHandsOverPatient(baseURL: string, opts: { allergies?: string[]; consents?: string[] } = {}) {
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-adaxai-csrf': '1' } })
  expect((await api.post('/api/auth/login', { data: { username: 'nurse.anil', password: DEMO_PASSWORD } })).ok()).toBe(true)
  const given = `Meena${uniq()}`
  const patient = await (await api.post('/api/patients', { data: { givenName: given, familyName: 'Synthetic', dateOfBirth: '1984-02-11', sex: 'female', phone: `7${String(Date.now()).slice(-9)}` } })).json()
  for (const substance of opts.allergies ?? []) await api.post(`/api/patients/${patient.id}/allergies`, { data: { substance, severity: 'moderate' } })
  for (const type of opts.consents ?? []) await api.post(`/api/patients/${patient.id}/consents`, { data: { type, method: 'verbal' } })
  const depts = (await (await api.get('/api/departments')).json()).departments
  const visit = await (await api.post('/api/visits', { data: { patientId: patient.id, departmentId: depts.find((d: { code: string }) => d.code === 'GEN').id, chiefComplaint: 'Sore throat and fever' } })).json()
  await api.post(`/api/visits/${visit.id}/observations`, { data: { items: [{ kind: 'temperature', value: 38.2 }, { kind: 'heart_rate', value: 92 }] } })
  await api.post(`/api/visits/${visit.id}/status`, { data: { status: 'ready' } })
  await api.dispose()
  return { name: `${given} Synthetic`, patientId: patient.id as string, mrn: patient.mrn as string }
}

