import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`)
  expect(summary, 'axe WCAG 2.2 AA violations').toEqual([])
}

test('home shows the four portals and live status of all three services', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'ADAXAI workspace' })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('Synthetic data only. Not for clinical use.')

  const portals = page.getByRole('region', { name: 'Portals' }).getByRole('link')
  await expect(portals).toHaveText([/Doctor portal/, /Nurse portal/, /Admin portal/, /Patient portal/])

  // Real services, not mocks: API, PostgreSQL (via the API) and the Python thermal service.
  await expect(page.getByTestId('status-api')).toContainText('Operational')
  await expect(page.getByTestId('status-database')).toContainText('Operational')
  await expect(page.getByTestId('status-database')).toContainText('PostgreSQL 17.10')
  await expect(page.getByTestId('status-database')).toContainText('UTF8')
  await expect(page.getByTestId('status-thermal')).toContainText('Operational')
  await expect(page.getByText('All services operational')).toBeVisible()

  await expectNoAxeViolations(page)
})

test('portal placeholders state they are not yet available', async ({ page }) => {
  for (const name of ['Doctor', 'Nurse', 'Admin', 'Patient']) {
    await page.goto('/')
    await page.getByRole('region', { name: 'Portals' }).getByRole('link', { name: new RegExp(`${name} portal`) }).click()
    await expect(page.getByRole('heading', { level: 1, name: `${name} portal` })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Not yet available' })).toBeVisible()
    await expect(page).toHaveTitle(`${name} portal · ADAXAI`)
    await expectNoAxeViolations(page)
  }
})

test('unknown routes show a not-found page', async ({ page }) => {
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await expectNoAxeViolations(page)
})

test('the skip link moves focus to the main content', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard navigation is checked on desktop')
  await page.goto('/')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main')).toBeFocused()
})
