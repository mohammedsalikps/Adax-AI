import { request as pwRequest, expect, test } from '@playwright/test'
import { DEMO_PASSWORD, expectNoAxeViolations, expectNoHorizontalOverflow, signIn, uniq } from './support.ts'

test('nurse reviews a rule-based routing suggestion with a red flag and applies it', async ({ page, baseURL }) => {
  // A synthetic patient checked in with a red-flag reason for visit.
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-adaxai-csrf': '1' } })
  expect((await api.post('/api/auth/login', { data: { username: 'nurse.anil', password: DEMO_PASSWORD } })).ok()).toBe(true)
  const given = `Route${uniq()}`
  const patient = await (await api.post('/api/patients', { data: { givenName: given, familyName: 'Synthetic', dateOfBirth: '1960-05-01', sex: 'male', phone: `8${String(Date.now()).slice(-9)}` } })).json()
  const depts = (await (await api.get('/api/departments')).json()).departments
  await api.post('/api/visits', { data: { patientId: patient.id, departmentId: depts.find((d: { code: string }) => d.code === 'PED').id, chiefComplaint: 'Chest pain since this morning' } })
  await api.dispose()

  await signIn(page, 'nurse.anil')
  await page.goto('/nurse')
  const row = page.getByRole('listitem').filter({ hasText: given })
  await row.getByRole('button', { name: 'Routing' }).click()
  const dlg = page.getByRole('dialog', { name: /Routing/ })
  await expect(dlg).toContainText('No suggestion yet')
  await dlg.getByRole('button', { name: 'Suggest routing' }).click()
  const s = dlg.getByRole('region', { name: 'Routing suggestion' })
  await expect(s.getByRole('alert')).toContainText('Red flag: “chest pain” in the reason for visit')
  await expect(s.getByRole('alert')).toContainText('Inform the duty doctor now')
  await expect(s).toContainText('General Medicine')
  await expect(s).toContainText('routing-rules-v1')
  await expect(s).toContainText('Temperature')
  await expectNoAxeViolations(page)
  await expectNoHorizontalOverflow(page)
  await dlg.getByRole('button', { name: 'Apply suggestion' }).click()
  await expect(s).toContainText('applied')
  await dlg.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(row).toContainText('Urgent')
  await expect(row).toContainText('General Medicine')
})
