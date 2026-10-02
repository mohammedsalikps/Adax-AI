import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalOverflow, nurseHandsOverPatient, signIn } from './support.ts'

test('doctor consults, writes the note, prescribes, signs, prints and amends; nurse sees the saved record', async ({ page, browser, baseURL, isMobile }) => {
  const p = await nurseHandsOverPatient(baseURL!)

  await signIn(page, 'dr.meera')
  const row = page.getByRole('listitem').filter({ hasText: p.name })
  await expect(row).toContainText('Ready for doctor')
  await row.getByRole('button', { name: 'Start consultation' }).click()
  await expect(page).toHaveURL(/\/doctor\/encounters\//)
  const encounterUrl = page.url()

  // The banner identifies the patient; the complaint is prefilled from check-in.
  await expect(page.getByTestId('patient-banner')).toContainText(p.mrn)
  await expect(page.getByLabel('Chief complaint')).toHaveValue('Sore throat and fever')
  await page.getByLabel('History of present illness').fill('Two days of sore throat and fever. No cough.')
  await page.getByLabel('Examination').fill('Tonsils enlarged, no exudate. Chest clear.')
  await page.getByLabel('Assessment').fill('Acute pharyngitis, likely viral.')
  await page.getByLabel('Plan').fill('Warm saline gargles, fluids, paracetamol for fever.')

  await page.getByRole('button', { name: 'Add diagnosis' }).click()
  await page.getByLabel('Diagnosis 1', { exact: true }).fill('Acute pharyngitis')
  await page.getByLabel('ICD-10 (optional)').fill('J02.9')
  await page.getByRole('button', { name: 'Add medicine' }).click()
  await page.getByLabel('Medicine', { exact: true }).fill('Paracetamol')
  await page.getByLabel('Strength', { exact: true }).fill('500 mg')
  await page.getByLabel('Form', { exact: true }).fill('Tablet')
  await page.getByLabel('Dose', { exact: true }).fill('1 tablet')
  await page.getByLabel('Frequency', { exact: true }).fill('Three times daily (TDS)')
  await page.getByLabel('Duration', { exact: true }).fill('3 days')
  await page.getByLabel('Instructions', { exact: true }).fill('After food')
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 10_000 })
  await expectNoAxeViolations(page)
  await expectNoHorizontalOverflow(page)

  // Autosave persisted to the database: a reload shows the same draft.
  await page.reload()
  await expect(page.getByLabel('Assessment')).toHaveValue('Acute pharyngitis, likely viral.')
  await expect(page.getByLabel('Medicine', { exact: true })).toHaveValue('Paracetamol')

  // Review and sign requires the attestation.
  await page.getByRole('button', { name: 'Review and sign' }).click()
  const review = page.getByRole('dialog', { name: 'Review and sign' })
  await expect(review).toContainText('Acute pharyngitis (J02.9)')
  await expect(review.getByRole('button', { name: 'Sign and complete' })).toBeDisabled()
  await review.getByLabel(/I have reviewed this record/).check()
  await expectNoAxeViolations(page)
  await review.getByRole('button', { name: 'Sign and complete' }).click()

  // Signed: read-only, with print and amendment.
  await expect(page.getByText(/^Signed /)).toBeVisible()
  await expect(page.getByLabel('Assessment')).toHaveCount(0)
  await expect(page.getByText('Integrity hash')).toBeVisible()
  await expectNoAxeViolations(page)

  await page.getByRole('link', { name: 'Print prescription' }).click()
  await expect(page.getByRole('note')).toContainText('not a valid prescription')
  await expect(page.locator('main')).toContainText(p.name)
  await expect(page.locator('main')).toContainText('Paracetamol 500 mg')
  await expect(page.locator('main')).toContainText('Electronically signed by Dr. Meera Iyer (synthetic)')
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Back' }).click()

  await page.getByRole('button', { name: 'Add amendment' }).click()
  const amend = page.getByRole('dialog', { name: 'Add amendment' })
  await amend.getByLabel('Reason').fill('Clarify fever threshold')
  await amend.getByLabel('Amendment').fill('Take paracetamol only if temperature is above 38 °C.')
  await amend.getByRole('button', { name: 'Add amendment' }).click()
  await expect(page.getByRole('region', { name: 'Amendments' })).toContainText('Clarify fever threshold')

  // The visit left the doctor's open queue.
  await page.goto('/doctor')
  await expect(page.getByRole('listitem').filter({ hasText: p.name })).toHaveCount(0)

  // The nurse sees the saved record in the timeline and can read (not edit) it.
  const nurseCtx = await browser.newContext(isMobile ? { viewport: page.viewportSize()!, isMobile: true, hasTouch: true } : {})
  const nurse = await nurseCtx.newPage()
  await signIn(nurse, 'nurse.anil')
  await nurse.goto(`/nurse/patients/${p.patientId}`)
  const timeline = nurse.getByRole('region', { name: 'Timeline' })
  await expect(timeline).toContainText('Consultation')
  await expect(timeline).toContainText('Acute pharyngitis (J02.9)')
  await expect(timeline).toContainText('Paracetamol 500 mg')
  await expect(timeline).toContainText('1 amendment')
  await timeline.getByRole('link', { name: 'Open consultation' }).click()
  await expect(nurse.getByText(/^Signed /)).toBeVisible()
  await expect(nurse.getByRole('button', { name: 'Add amendment' })).toHaveCount(0)
  await nurseCtx.close()

  // Persistence check from a brand-new browser session.
  const fresh = await browser.newContext()
  const fp = await fresh.newPage()
  await signIn(fp, 'dr.meera')
  await fp.goto(encounterUrl)
  await expect(fp.getByText('Take paracetamol only if temperature is above 38 °C.')).toBeVisible()
  await fresh.close()
})
