import { expect, type Page, test } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalOverflow, signIn, signOut, uniq } from './support.ts'

/** Registers a synthetic patient through the UI and returns their MRN and the profile URL. */
async function registerPatient(page: Page, given: string, phone: string) {
  await page.goto('/nurse/register')
  await page.getByLabel('Given name').fill(given)
  await page.getByLabel('Family name').fill('Synthetic')
  await page.getByLabel('Date of birth').fill('1979-03-14')
  await page.getByLabel('Sex').selectOption('female')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: 'Register patient' }).click()
}

test.describe.configure({ mode: 'serial' })

test('nurse registers, checks in, records vitals and hands over to the doctor', async ({ page, browser, isMobile }) => {
  const given = `Kavya${uniq()}`
  const phone = `9${String(Date.now()).slice(-9)}`

  await signIn(page, 'nurse.anil')
  await expect(page).toHaveURL(/\/nurse$/)
  await expectNoHorizontalOverflow(page)

  // Register; the check-in dialog opens automatically afterwards.
  await registerPatient(page, given, phone)
  await expect(page.getByTestId('patient-banner')).toContainText(`${given} Synthetic`)
  const mrn = (await page.getByTestId('patient-banner').getByText(/ADX-\d{6}/).textContent())!.trim()
  const checkIn = page.getByRole('dialog', { name: `Check in ${given} Synthetic` })
  await checkIn.getByLabel('Department').selectOption({ label: 'General Medicine' })
  await checkIn.getByLabel('Reason for visit').fill('Fever for three days')
  await expectNoAxeViolations(page)
  await checkIn.getByRole('button', { name: 'Check in and issue token' }).click()

  // Back on the queue with a token.
  await expect(page).toHaveURL(/\/nurse$/)
  const row = page.getByRole('listitem').filter({ hasText: `${given} Synthetic` })
  await expect(row).toContainText('Waiting')
  await expect(row).toContainText('Fever for three days')
  await expect(row).toContainText('Allergies not recorded')
  await expectNoAxeViolations(page)

  // Vitals: a raised temperature is flagged; recording starts intake.
  await row.getByRole('button', { name: 'Vitals' }).click()
  const vitals = page.getByRole('dialog', { name: /Record vitals/ })
  await vitals.getByLabel('Temperature (°C)').fill('386')
  await vitals.getByRole('button', { name: 'Save vitals' }).click()
  await expect(vitals.getByText('Temperature must be between 30 and 44 °C')).toBeVisible()
  await vitals.getByLabel('Temperature (°C)').fill('38.6')
  await vitals.getByLabel('Heart rate (bpm)').fill('96')
  await vitals.getByLabel('SpO₂ (%)').fill('97')
  await expectNoAxeViolations(page)
  await vitals.getByRole('button', { name: 'Save vitals' }).click()
  await expect(row).toContainText('Nurse intake')
  await expect(row).toContainText('38.6')
  await expect(row).toContainText('High')

  await row.getByRole('button', { name: 'Ready for doctor' }).click()
  await expect(row).toContainText('Ready for doctor')

  // The doctor in General Medicine sees the patient in "My patients" (another session, same data).
  const doctorCtx = await browser.newContext(isMobile ? { viewport: page.viewportSize()!, isMobile: true, hasTouch: true } : {})
  const doctor = await doctorCtx.newPage()
  await signIn(doctor, 'dr.meera')
  await expect(doctor).toHaveURL(/\/doctor$/)
  const doctorRow = doctor.getByRole('listitem').filter({ hasText: `${given} Synthetic` })
  await expect(doctorRow).toContainText('Ready for doctor')
  await expect(doctorRow).toContainText(mrn)
  await doctorCtx.close()

  // A second registration with the same phone triggers the duplicate warning.
  await registerPatient(page, `Other${uniq()}`, phone)
  await expect(page.getByRole('heading', { name: 'This patient may already be registered' })).toBeVisible()
  await expect(page.getByText(mrn)).toBeVisible()
  await expectNoAxeViolations(page)
})

test('nurse maintains allergies and consent, and the patient activates their portal account', async ({ page, browser, isMobile }) => {
  const given = `Ravi${uniq()}`
  await signIn(page, 'nurse.anil')
  await registerPatient(page, given, `8${String(Date.now()).slice(-9)}`)
  await page.getByRole('dialog', { name: /Check in/ }).getByRole('button', { name: 'Close dialog' }).click()
  const banner = page.getByTestId('patient-banner')
  await expect(banner).toContainText('Allergies not recorded')
  const mrn = (await banner.getByText(/ADX-\d{6}/).textContent())!.trim()

  await page.getByRole('button', { name: 'Add allergy' }).click()
  const dlg = page.getByRole('dialog', { name: 'Add allergy' })
  await dlg.getByLabel('Substance').fill('Penicillin')
  await dlg.getByLabel('Reaction').fill('Hives')
  await dlg.getByLabel('Severity').selectOption('moderate')
  await dlg.getByRole('button', { name: 'Add allergy' }).click()
  await expect(banner).toContainText('Allergies: Penicillin')

  // Portal access needs recorded consent before a code can be issued.
  const portal = page.getByRole('region', { name: 'Patient portal' })
  await expect(portal.getByRole('button', { name: 'Issue activation code' })).toBeDisabled()
  const consentRow = page.getByRole('listitem').filter({ hasText: 'Online access to the patient’s own approved records.' })
  await consentRow.getByRole('button', { name: 'Record consent' }).click()
  await page.getByRole('dialog', { name: /Record consent/ }).getByRole('button', { name: 'Patient agrees' }).click()
  await expect(consentRow).toContainText('Granted')
  await portal.getByRole('button', { name: 'Issue activation code' }).click()
  const code = (await page.getByTestId('activation-code').textContent())!.trim()
  expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
  await expectNoHorizontalOverflow(page)
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await signOut(page)

  // The patient activates in their own browser and lands in the patient portal.
  const patientCtx = await browser.newContext(isMobile ? { viewport: page.viewportSize()!, isMobile: true, hasTouch: true } : {})
  const patient = await patientCtx.newPage()
  await patient.goto('/activate')
  await patient.getByLabel('MRN').fill(mrn)
  await patient.getByLabel('Activation code').fill(code)
  await patient.getByLabel('Choose a password').fill('Patient-passphrase-77')
  await patient.getByLabel(/I understand this portal/).check()
  await expectNoAxeViolations(patient)
  await patient.getByRole('button', { name: 'Activate and sign in' }).click()
  await expect(patient).toHaveURL(/\/patient/)
  // Patients cannot reach staff data.
  expect((await patient.request.get('/api/patients')).status()).toBe(403)
  await patientCtx.close()
})
