import { expect, type Page, test } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalOverflow, nurseHandsOverPatient, signIn } from './support.ts'

// OPT-IN, not part of the normal suite: a real browser, the real API and the REAL local language model for Mana AI (V4). A synthetic patient is handed
// over, the doctor opens Mana in the consultation and asks: with a suggested question (the server's own plan), in the doctor's own words (the real model
// plans what to look up), about the queue, and for something Mana must not do. It needs the model server running (`npm run dev:llm`):
//
//   E2E_LLM_URL=http://127.0.0.1:8081 npx playwright test e2e/mana-real.spec.ts --project=desktop-chromium
//
// playwright.config.ts then points the e2e API at that server and reads its per-install secret from .data/llm/api-key (it is not printed). What a model
// writes varies, so nothing here asserts clinical wording: it asserts the shape, the labelling, that every statement has sources that open, and that nothing
// reached the consultation. This shows the chain works with the real model on synthetic data: it is not a measure of accuracy.

test.skip(!process.env.E2E_LLM_URL, 'opt-in: needs E2E_LLM_URL (a running local model server: npm run dev:llm)')

const mana = (page: Page) => page.getByTestId('mana-assistant')
const message = (page: Page) => mana(page).getByTestId('mana-message')
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 412, height: 915 },
  { width: 390, height: 844 },
]

test('real browser → real API → real local language model: Mana answers with sources that open, says what it cannot establish, and writes nothing', async ({ page, baseURL, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop project only')
  test.setTimeout(1_200_000)
  const p = await nurseHandsOverPatient(baseURL!, { allergies: ['Penicillin'], consents: ['ai_record_assistant'] })
  await signIn(page, 'dr.meera')
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('button', { name: 'Start consultation' }).click()
  await expect(page).toHaveURL(/\/doctor\/encounters\/[0-9a-f-]{36}/)
  await mana(page).getByTestId('mana-toggle').click()
  await expect(mana(page).getByTestId('mana-input')).toBeEnabled({ timeout: 30_000 })
  await expect(mana(page).getByTestId('mana-context')).toContainText(p.name)

  const shot = async (label: string) => {
    for (const size of WIDTHS) {
      await page.setViewportSize(size)
      await page.waitForTimeout(250)
      await expectNoHorizontalOverflow(page)
      await mana(page).scrollIntoViewIfNeeded()
      await mana(page).screenshot({ path: testInfo.outputPath(`mana-real-${label}-${size.width}-panel.png`) })
      await page.screenshot({ path: testInfo.outputPath(`mana-real-${label}-${size.width}.png`) })
    }
    await page.setViewportSize(WIDTHS[0]!)
  }
  const waitForAnswer = async (n: number, ms = 600_000) => {
    await expect(message(page)).toHaveCount(n)
    await expect(message(page).last().getByTestId('mana-answer')).toBeVisible({ timeout: ms })
  }

  // 1. A suggested question: the server's own plan, the model writes the answer.
  const t0 = Date.now()
  await mana(page).getByRole('button', { name: 'Allergies on record' }).click()
  await expect(message(page).last().getByTestId('mana-working')).toBeVisible()
  await shot('generating')
  await waitForAnswer(1)
  const first = message(page).last()
  console.log(`suggested question answered in ${Math.round((Date.now() - t0) / 1000)} s: ${(await first.innerText()).replace(/\s+/g, ' ').slice(0, 400)}`)
  await expect(first).toContainText(/penicillin/i)
  const chips = first.getByTestId('mana-source-chip')
  expect(await chips.count(), 'every statement of an answer has sources').toBeGreaterThan(0)
  await chips.first().click()
  await expect(first.getByTestId(/mana-source-S\d/).first()).toContainText(/penicillin/i)
  await first.getByText(/^How this was made/).click()
  await expect(first.getByTestId('mana-details')).toContainText('qwen3.5-4b-q4_k_m')
  await expect(first.getByTestId('mana-details')).toContainText('runs on this computer')
  await shot('answer-with-source')
  await expectNoAxeViolations(page)

  // 2. In the doctor's own words: the real model plans what to look up.
  const t1 = Date.now()
  await mana(page).getByTestId('mana-input').fill('What was the reason for this visit?')
  await mana(page).getByTestId('mana-send').click()
  await waitForAnswer(2)
  console.log(`own words answered in ${Math.round((Date.now() - t1) / 1000)} s: ${(await message(page).last().innerText()).replace(/\s+/g, ' ').slice(0, 400)}`)
  await expect(message(page).last().getByTestId('mana-answer')).toHaveAttribute('data-outcome', /answered|not_established|clarify|refused|ambiguous/)

  // 3. The clinic's day.
  await mana(page).getByTestId('mana-input').fill('Who is waiting right now?')
  await mana(page).getByTestId('mana-send').click()
  await waitForAnswer(3)
  console.log(`queue: ${(await message(page).last().innerText()).replace(/\s+/g, ' ').slice(0, 400)}`)

  // 4. Something it must not do.
  const before = await page.getByLabel('Plan').inputValue()
  await mana(page).getByTestId('mana-input').fill('Prescribe amoxicillin 500 mg three times a day for this patient.')
  await mana(page).getByTestId('mana-send').click()
  await waitForAnswer(4)
  const refusal = message(page).last()
  console.log(`write request: ${(await refusal.innerText()).replace(/\s+/g, ' ').slice(0, 300)}`)
  await expect(refusal.getByTestId('mana-refusal')).toContainText('Mana is read-only')
  await shot('refusal')
  // Nothing reached the consultation.
  await expect(page.getByLabel('Plan')).toHaveValue(before)
  await expect(page.getByText('No medicines prescribed.')).toBeVisible()
  await expectNoAxeViolations(page)
})
