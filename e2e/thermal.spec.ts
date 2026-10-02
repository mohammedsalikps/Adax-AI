import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalOverflow, signIn, uniq } from './support.ts'

const SAMPLES = path.resolve(import.meta.dirname, '..', 'samples', 'thermal')
test.skip(!fs.existsSync(path.join(SAMPLES, 'flir_example.jpg')), 'thermal sample images not fetched (npm run setup)')

test('nurse uploads a radiometric image and measures regions; doctor approves; unsupported files are rejected', async ({ page, browser, isMobile }) => {
  const given = `Thermo${uniq()}`
  await signIn(page, 'nurse.anil')
  await page.goto('/nurse/register')
  await page.getByLabel('Given name').fill(given)
  await page.getByLabel('Date of birth').fill('1975-08-19')
  await page.getByLabel('Sex').selectOption('male')
  await page.getByLabel('Mobile number').fill(`6${String(Date.now()).slice(-9)}`)
  await page.getByRole('button', { name: 'Register patient' }).click()
  await page.getByRole('dialog', { name: /Check in/ }).getByRole('button', { name: 'Close dialog' }).click()

  // Consent first.
  const thermalCard = page.getByRole('region', { name: 'Thermal images' })
  await expect(thermalCard.getByRole('button', { name: 'Upload' })).toBeDisabled()
  const consentRow = page.getByRole('listitem').filter({ hasText: 'Capture and store thermal images' })
  await consentRow.getByRole('button', { name: 'Record consent' }).click()
  await page.getByRole('dialog', { name: /Record consent/ }).getByRole('button', { name: 'Patient agrees' }).click()
  await expect(consentRow).toContainText('Granted')

  // An unsupported FLIR variant is rejected with a clear message.
  await thermalCard.getByRole('button', { name: 'Upload' }).click()
  let dlg = page.getByRole('dialog', { name: 'Upload thermal image' })
  await dlg.getByLabel(/Radiometric JPEG/).setInputFiles(path.join(SAMPLES, 'zenmuse_xtr.jpg'))
  await dlg.getByLabel('Body region').fill('Knees')
  await dlg.getByRole('button', { name: 'Upload and extract' }).click()
  await expect(dlg.getByRole('alert')).toContainText('could not be decoded')
  await expectNoAxeViolations(page)

  // A supported radiometric file is extracted.
  await dlg.getByLabel(/Radiometric JPEG/).setInputFiles(path.join(SAMPLES, 'flir_example.jpg'))
  await dlg.getByLabel('Room temperature (°C)').fill('22')
  await dlg.getByLabel('Acclimatisation (minutes)').fill('15')
  await dlg.getByLabel('Camera distance (m)').fill('1')
  await dlg.getByRole('button', { name: 'Upload and extract' }).click()
  await expect(page).toHaveURL(/\/nurse\/thermal\//)
  const captureUrl = new URL(page.url()).pathname
  await expect(page.getByText('Draft — awaiting review')).toBeVisible()
  await expect(page.getByText('240 × 320')).toBeVisible()
  await expect(page.getByText('flyr 5.1.0')).toBeVisible()

  if (!isMobile) {
    // Hover readout and drawing by drag.
    const overlay = page.getByTestId('thermal-overlay')
    const box = (await overlay.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await expect(page.getByTestId('hover-readout')).toContainText(/x 1\d\d, y 1\d\d: \d+\.\d\d °C/)
    await page.getByRole('button', { name: 'Rectangle' }).click()
    // Clicking the tool can scroll the page; measure the canvas again before dragging.
    await overlay.scrollIntoViewIfNeeded()
    const b = (await overlay.boundingBox())!
    await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.1)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.25, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByTestId('roi-Region 1')).toBeVisible()
  } else {
    await page.getByRole('button', { name: 'Add region' }).click()
  }
  const first = page.getByTestId('roi-Region 1')
  await first.getByLabel('Label').fill('Left knee')
  await page.getByRole('button', { name: 'Add region' }).click()
  // Located by position: the test id follows the label, which is edited below.
  const second = page.locator('li[data-testid^="roi-"]').nth(1)
  await second.getByLabel('Label').fill('Right knee')
  await second.getByLabel('Shape').selectOption('ellipse')
  await second.getByLabel('X').fill('150')
  await page.getByTestId('roi-Left knee').getByLabel('Compare with').selectOption('Right knee')
  await expect(page.getByTestId('roi-stats-Left knee')).toContainText('preview')
  await page.getByRole('button', { name: 'Save regions' }).click()
  await expect(page.getByTestId('roi-stats-Left knee')).not.toContainText('preview')
  await expect(page.getByTestId('roi-stats-Right knee')).toContainText('Mean')
  await expect(page.getByTestId('pair-diffs')).toContainText('Left knee − Right knee: mean')
  await expectNoAxeViolations(page)
  await expectNoHorizontalOverflow(page)
  // Nurses cannot approve.
  await expect(page.getByRole('button', { name: 'Approve measurements' })).toHaveCount(0)

  // The doctor finds it awaiting review and approves it.
  const docCtx = await browser.newContext(isMobile ? { viewport: page.viewportSize()!, isMobile: true, hasTouch: true } : {})
  const doc = await docCtx.newPage()
  await signIn(doc, 'dr.meera')
  await doc.goto('/doctor/thermal')
  await doc.getByRole('row', { name: new RegExp(given) }).getByRole('link', { name: 'Knees' }).click()
  await expect(doc.getByTestId('pair-diffs')).toBeVisible()
  await doc.getByLabel('Note').fill('Image adequate for comparison')
  await doc.getByRole('button', { name: 'Approve measurements' }).click()
  await expect(doc.getByText('Approved', { exact: true })).toBeVisible()
  await expect(doc.getByRole('button', { name: 'Save regions' })).toHaveCount(0)
  await expect(doc.getByTestId('roi-Left knee').getByLabel('Label')).toBeDisabled()
  await docCtx.close()

  // The nurse now sees it as approved and read-only.
  await page.goto(captureUrl)
  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add region' })).toHaveCount(0)
})
