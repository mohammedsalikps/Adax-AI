import { type APIRequestContext, type Browser, expect, type Page, request as pwRequest, test } from '@playwright/test'
import { DEMO_PASSWORD, expectNoAxeViolations, expectNoHorizontalOverflow, signIn, uniq } from './support.ts'

// Consent lifecycle across the apps, with synthetic data: the patient withdraws a consent in
// the portal; staff see it, withdraw portal access (which switches the account off at once),
// record consent again and issue a reset code; the patient withdraws portal access themselves.

async function staffApi(baseURL: string, username: string): Promise<APIRequestContext> {
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'x-adaxai-csrf': '1' } })
  expect((await api.post('/api/auth/login', { data: { username, password: DEMO_PASSWORD } })).ok()).toBe(true)
  return api
}

async function activate(page: Page, mrn: string, code: string, password: string) {
  await page.goto('/activate')
  await page.getByLabel('MRN').fill(mrn)
  await page.getByLabel('Activation code').fill(code)
  await page.getByLabel('Choose a password').fill(password)
  await page.getByLabel(/I understand this portal shows my own records/).check()
  await page.getByRole('button', { name: /Activate/ }).click()
  await expect(page).toHaveURL(/\/patient$/)
}

async function nursePage(browser: Browser, baseURL: string, isMobile: boolean) {
  const ctx = await browser.newContext({ baseURL, ...(isMobile && { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }) })
  const page = await ctx.newPage()
  await signIn(page, 'nurse.anil')
  return { ctx, page }
}

test('consent is granted, withdrawn and renewed across the patient portal and the staff app, with immediate effects', async ({ page, browser, baseURL, isMobile }) => {
  // A long multi-role journey: 33 s alone, but 57 s, 59 s and 30 s in three full runs on six workers, against the 60 s default (as devices.spec.ts, same reason).
  test.setTimeout(90_000)
  const nurseApi = await staffApi(baseURL!, 'nurse.anil')
  const given = `Consent${uniq()}`
  const patient = await (await nurseApi.post('/api/patients', { data: { givenName: given, familyName: 'Synthetic', dateOfBirth: '1988-03-02', sex: 'female', phone: `5${String(Date.now()).slice(-9)}` } })).json()
  for (const type of ['portal_access', 'research_use']) await nurseApi.post(`/api/patients/${patient.id}/consents`, { data: { type, method: 'verbal' } })
  const code = (await (await nurseApi.post(`/api/patients/${patient.id}/portal-activation`)).json()).activationCode as string
  await nurseApi.dispose()

  // 1. The patient activates and withdraws research consent in the portal.
  await activate(page, patient.mrn, code, 'Synthetic-portal-pass-1')
  await page.goto('/patient/consents')
  const research = page.getByTestId('portal-consent').filter({ hasText: 'De-identified research use' })
  await research.getByRole('button', { name: 'Withdraw…' }).click()
  const dialog = page.getByRole('dialog', { name: /Withdraw: De-identified research use/ })
  await expect(dialog).toContainText('Research datasets that already include your de-identified data can no longer be downloaded')
  await expectNoAxeViolations(page)
  await dialog.getByLabel('Reason (optional)').fill('Prefer not to take part')
  await dialog.getByRole('button', { name: 'Withdraw consent' }).click()
  await expect(research).toContainText('Withdrawn')
  await expect(research).toContainText('by you')
  await expectNoHorizontalOverflow(page)

  // 2. Staff see the withdrawal, then withdraw portal access: the account is switched off at once.
  const nurse = await nursePage(browser, baseURL!, isMobile)
  await nurse.page.goto(`/nurse/patients/${patient.id}`)
  const researchRow = nurse.page.getByTestId('consent-research_use')
  await expect(researchRow).toContainText('Withdrawn')
  await expect(researchRow).toContainText('by the patient in the portal')
  await expect(researchRow).toContainText('reason: Prefer not to take part')
  const portalRow = nurse.page.getByTestId('consent-portal_access')
  await portalRow.getByRole('button', { name: 'Withdraw…' }).click()
  const staffDialog = nurse.page.getByRole('dialog', { name: 'Withdraw consent: Patient portal' })
  await expect(staffDialog).toContainText('switched off at once')
  await expectNoAxeViolations(nurse.page)
  await staffDialog.getByLabel('Reason (optional)').fill('Relative may know the password')
  await staffDialog.getByRole('button', { name: 'Withdraw consent' }).click()
  const portalCard = nurse.page.getByRole('region', { name: 'Patient portal' })
  await expect(portalCard).toContainText('Account switched off')
  await expect(portalCard.getByRole('button', { name: 'Issue reset code' })).toBeDisabled()

  // The patient's session ended with the withdrawal.
  await page.goto('/patient/records')
  await expect(page).toHaveURL(/\/login/)

  // 3. The patient wants access again: new consent, reset code, new password.
  await portalRow.getByRole('button', { name: 'Record consent' }).click()
  await nurse.page.getByRole('dialog', { name: /Record consent: Patient portal/ }).getByRole('button', { name: 'Patient agrees' }).click()
  await expect(portalRow).toContainText('Granted')
  await portalCard.getByRole('button', { name: 'Issue reset code' }).click()
  const codeDialog = nurse.page.getByRole('dialog', { name: 'Reset code' })
  const resetCode = (await codeDialog.getByTestId('activation-code').textContent())!.trim()
  await codeDialog.getByRole('button', { name: 'Done' }).click()
  await nurse.page.getByText(/Consent history \(\d+ records\)/).click()
  await expect(nurse.page.getByText('Relative may know the password').first()).toBeVisible()
  await expectNoAxeViolations(nurse.page)
  await expectNoHorizontalOverflow(nurse.page)
  await activate(page, patient.mrn, resetCode, 'Synthetic-portal-pass-2')

  // 4. The patient withdraws portal access themselves and is signed out with an explanation.
  await page.goto('/patient/consents')
  await page.getByTestId('portal-consent').filter({ hasText: 'Patient portal' }).filter({ hasText: 'Agreed' }).getByRole('button', { name: 'Withdraw…' }).click()
  const own = page.getByRole('dialog', { name: /Withdraw: Patient portal/ })
  await expect(own).toContainText('signed out')
  await own.getByRole('button', { name: 'Withdraw consent' }).click()
  await expect(page).toHaveURL(/\/login\/patient\?notice=portal_withdrawn/)
  await expect(page.getByText('Online access switched off')).toBeVisible()
  await expectNoAxeViolations(page)
  await nurse.ctx.close()
})
