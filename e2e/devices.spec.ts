import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalOverflow, nurseHandsOverPatient, signIn, uniq } from './support.ts'

// Integration boundary only: no physical device is used. The audio file is a
// tiny synthetic WAV header, not a recording.
const WAV = Buffer.from('RIFF$\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x40\x1f\0\0\x80\x3e\0\0\x02\0\x10\0data\0\0\0\0', 'binary')

test('admin registers a device and issues a gateway token; nurse assigns it and uploads a stethoscope recording', async ({ page, browser, baseURL, isMobile }) => {
  test.setTimeout(90_000)
  const p = await nurseHandsOverPatient(baseURL!, { consents: ['device_monitoring'] })
  const serial = `E2E-${uniq()}`

  await signIn(page, 'admin')
  await page.goto('/admin/devices')
  await expect(page.getByText('No device has been connected or tested in this build')).toBeVisible()
  await page.getByRole('button', { name: 'Register device' }).click()
  const dlg = page.getByRole('dialog', { name: 'Register a device' })
  await dlg.getByLabel(/^Name/).fill(`Band ${serial}`)
  await dlg.getByLabel(/^Serial number/).fill(serial)
  await dlg.getByLabel('Integration').selectOption('gateway_api')
  await dlg.getByRole('button', { name: 'Register' }).click()
  const row = page.getByRole('row').filter({ hasText: serial })
  await row.getByRole('button', { name: 'Issue token' }).click()
  await expect(page.getByText('Gateway token (shown once)')).toBeVisible()
  await expect(page.locator('code')).toContainText('adxdev_')
  await expectNoAxeViolations(page)
  await expectNoHorizontalOverflow(page)

  const nurseCtx = await browser.newContext(isMobile ? { viewport: page.viewportSize()!, isMobile: true, hasTouch: true } : {})
  const nurse = await nurseCtx.newPage()
  await signIn(nurse, 'nurse.anil')
  await nurse.goto('/nurse/devices')
  const card = nurse.getByRole('listitem').filter({ hasText: `Band ${serial}` })
  await card.getByRole('button', { name: 'Assign to patient' }).click()
  const assign = nurse.getByRole('dialog', { name: /Assign Band/ })
  await assign.getByLabel('Find patient (name, MRN or phone)').fill(p.mrn)
  await assign.getByLabel('Patient', { exact: true }).selectOption({ label: `${p.name} · ${p.mrn}` })
  await assign.getByRole('button', { name: 'Assign' }).click()
  await expect(card).toContainText(`Assigned to ${p.name}`)
  await expectNoAxeViolations(nurse)

  await nurse.goto(`/nurse/patients/${p.patientId}`)
  const steth = nurse.getByRole('region', { name: 'Stethoscope recordings' })
  await steth.getByRole('button', { name: 'Add recording' }).click()
  const up = nurse.getByRole('dialog', { name: 'Add stethoscope recording' })
  await up.getByLabel(/Audio file/).setInputFiles({ name: 'synthetic-heart.wav', mimeType: 'audio/wav', buffer: WAV })
  await up.getByLabel('Site').selectOption('mitral')
  await up.getByRole('button', { name: 'Save recording' }).click()
  await expect(steth.getByTestId('auscultation')).toContainText('Mitral area (apex)')
  await expect(steth.getByTestId('auscultation').locator('audio')).toHaveAttribute('src', /\/api\/files\//)
  await expectNoAxeViolations(nurse)
  await expectNoHorizontalOverflow(nurse)

  await nurse.goto('/nurse/devices')
  await nurse.getByRole('listitem').filter({ hasText: `Band ${serial}` }).getByRole('button', { name: 'End assignment' }).click()
  await expect(nurse.getByRole('listitem').filter({ hasText: `Band ${serial}` }).getByRole('button', { name: 'Assign to patient' })).toBeVisible()
  await nurseCtx.close()
})
