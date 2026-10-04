import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalOverflow, nurseHandsOverPatient, signIn } from './support.ts'

// OPT-IN, not part of the normal suite: a real browser, the real API and the REAL local language model. A synthetic patient is handed over, the
// doctor asks for a draft, and the draft that the real model wrote (minutes on a laptop CPU) is read back in the browser: labelled as AI, grouped,
// with sources, and nothing in the note until a statement is accepted and added. It needs the model server running (`npm run dev:llm`):
//
//   E2E_LLM_URL=http://127.0.0.1:8081 npx playwright test e2e/consult-real.spec.ts --project=desktop-chromium
//
// playwright.config.ts then points the e2e API at that server and reads its per-install secret from .data/llm/api-key (it is not printed).
// What a model writes varies, so nothing here asserts clinical wording; it asserts the shape, the labelling, the sources and that nothing reached
// the note on its own. This shows the chain works with the real model on synthetic data: it is not a measure of accuracy.

test.skip(!process.env.E2E_LLM_URL, 'opt-in: needs E2E_LLM_URL (a running local model server: npm run dev:llm)')

test('real browser → real API → real local language model: a draft with sources arrives for review, and nothing is in the note until the doctor adds it', async ({ page, baseURL, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop project only')
  test.setTimeout(720_000)
  const p = await nurseHandsOverPatient(baseURL!, { allergies: ['Penicillin'], consents: ['ai_recording'] })
  await signIn(page, 'dr.meera')
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('button', { name: 'Start consultation' }).click()
  await expect(page).toHaveURL(/\/doctor\/encounters\/[0-9a-f-]{36}/)
  const panel = page.getByTestId('consult-panel')
  const status = panel.getByTestId('consult-status')

  await expect(status).toContainText('NOT RUN', { timeout: 30_000 })
  await expect(panel.getByTestId('consult-model')).toContainText('qwen3.5-4b-q4_k_m')
  await expect(panel.getByTestId('consult-model')).toContainText('nothing leaves it')
  await panel.getByRole('button', { name: 'Generate draft' }).click()
  await expect(status).toContainText('GENERATING')
  await expect(panel.getByTestId('consult-progress')).toContainText('local model')
  const started = Date.now()
  await expect(status).toContainText(/READY FOR REVIEW|PARTIALLY AVAILABLE/, { timeout: 600_000 })
  const seconds = Math.round((Date.now() - started) / 1000)

  for (const label of ['AI DRAFT', 'AI-GENERATED', 'REQUIRES DOCTOR REVIEW']) await expect(panel.getByText(label, { exact: true })).toBeVisible()
  const statements = panel.getByTestId('consult-statement')
  const count = await statements.count()
  expect(count, 'statements in the draft').toBeGreaterThan(3)
  const rows = await statements.evaluateAll((els) =>
    els.map((el) => ({ section: el.getAttribute('data-section') ?? '', support: el.getAttribute('data-support') ?? '', cited: !!el.querySelector('details'), text: (el.querySelector('p.text-sm') as HTMLElement | null)?.innerText ?? '' })),
  )
  for (const r of rows) expect(['supported', 'inferred', 'not_found', 'conflicting', 'outdated'], `${r.section}: ${r.text}`).toContain(r.support)
  // A statement about the record always opens to the items it rests on.
  for (const r of rows.filter((x) => ['presenting_problem', 'symptoms', 'observations', 'allergies', 'medications', 'relevant_history'].includes(x.section))) expect(r.cited, `${r.section}: ${r.text}`).toBe(true)
  // The recorded allergy is in the draft, in some statement.
  await expect(panel.getByText(/penicillin/i).first()).toBeVisible()
  console.log(`real local model: draft ready in ${seconds} s with ${count} statements (${rows.map((r) => `${r.section}/${r.support}`).join(', ')})`)
  for (const r of rows.slice(0, 12)) console.log(`  [${r.section} · ${r.support}] ${r.text}`)

  // Nothing was written anywhere by the draft itself.
  await expect(page.getByLabel('History of present illness')).toHaveValue('')
  await expect(page.getByLabel('Plan')).toHaveValue('')
  await expect(page.getByText('No diagnosis yet.')).toBeVisible()
  await expect(page.getByText('No medicines prescribed.')).toBeVisible()
  await expect(panel.getByTestId('draft-facts')).toContainText('How this draft was made')
  await panel.getByTestId('draft-facts').click()
  await expect(panel.getByTestId('draft-facts')).toContainText('qwen3.5-4b-q4_k_m')
  await expect(panel.getByTestId('draft-facts')).toContainText('weights SHA-256 00fe7986ff5f')

  // Accept one statement and add it: only then does the note change.
  const first = statements.first()
  const text = (await first.locator('p.text-sm').first().innerText()).trim()
  const flagged = await first.getByLabel('Checks to make').count()
  if (flagged) await first.getByLabel('I have checked this against the record').check()
  await first.getByRole('button', { name: 'Accept' }).click()
  await expect(first).toContainText('Accepted')
  await expect(page.getByLabel('History of present illness')).toHaveValue('')
  await first.getByRole('button', { name: 'Add to note' }).click()
  await expect(first).toContainText('In the note')
  expect(text.length).toBeGreaterThan(5)

  await expectNoAxeViolations(page)
  await expectNoHorizontalOverflow(page)
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('consult-real-model.png'), fullPage: true })
})

// The whole chain of V3 with the real models, as the owner's success criteria describe it: a doctor opens a consultation, a real local speech model
// transcribes synthetic speech, the doctor confirms points, a real local language model writes the draft, the doctor accepts a statement and adds it to
// the note as a separate act, signs, and the signed record names the model and the prompt that produced the text. It needs both servers running and a speech WAV:
//
//   E2E_LLM_URL=http://127.0.0.1:8081 E2E_SPEECH_URL=http://127.0.0.1:8002 E2E_FAKE_AUDIO_FILE=<repo>/data/eval/audio/c01-demo.wav \
//     npx playwright test e2e/consult-real.spec.ts --project=desktop-chromium
test('the whole chain with the real models: recorded synthetic speech, confirmed points, a local draft, accept and add to the note, sign, and the signed record names the model and prompt', async ({ page, baseURL, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop project only')
  test.skip(!process.env.E2E_SPEECH_URL || !process.env.E2E_FAKE_AUDIO_FILE, 'needs E2E_SPEECH_URL (a running local speech service) and E2E_FAKE_AUDIO_FILE (a speech WAV) as well')
  test.setTimeout(900_000)
  const p = await nurseHandsOverPatient(baseURL!, { allergies: ['Penicillin'], consents: ['ai_recording'] })
  await signIn(page, 'dr.meera')
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('button', { name: 'Start consultation' }).click()
  await expect(page).toHaveURL(/\/doctor\/encounters\/[0-9a-f-]{36}/)

  // 1. Capture with the real local speech model.
  const live = page.getByRole('region', { name: 'Live transcription' })
  const points = page.getByRole('region', { name: 'Important points' })
  await expect(live.getByTestId('speech-status')).toContainText('faster-whisper-small')
  await live.getByRole('button', { name: 'Start recording' }).click()
  await expect(live.getByTestId('recording-state')).toContainText('Recording')
  await expect(live.getByTestId('transcript-line').first()).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(8_000)
  await live.getByRole('button', { name: 'Stop' }).click()
  await expect(live.getByRole('button', { name: 'Start recording' })).toBeVisible({ timeout: 90_000 })

  // 2. The doctor confirms points (a point whose speaker nobody assigned needs the tick first).
  await expect(points.locator('[data-testid="important-point"]').first()).toBeVisible({ timeout: 60_000 })
  for (let n = 0; n < 3; n++) {
    const next = points.locator('[data-testid="important-point"][data-state="extracted"]').first()
    if (!(await next.count())) break
    const tick = next.getByLabel('I have checked this against the conversation and the record')
    if (await tick.count()) await tick.check()
    await next.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(points.locator('[data-testid="important-point"][data-state="confirmed"]')).toHaveCount(n + 1)
  }
  const confirmed = await points.locator('[data-testid="important-point"][data-state="confirmed"]').count()
  expect(confirmed).toBeGreaterThan(0)

  // 3. The doctor drafts a medicine from the recorded allergy's group, so the fixed rules have a conflict to find; then asks for the draft.
  await page.getByRole('button', { name: 'Add medicine' }).click()
  await page.getByLabel('Medicine', { exact: true }).fill('Amoxicillin')
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 10_000 })
  const panel = page.getByTestId('consult-panel')
  const status = panel.getByTestId('consult-status')
  await expect(status).toContainText(/NOT RUN|STALE/, { timeout: 30_000 })
  await panel.getByRole('button', { name: 'Generate draft' }).click()
  await expect(status).toContainText('GENERATING')
  await expect(status).toContainText(/READY FOR REVIEW|PARTIALLY AVAILABLE/, { timeout: 600_000 })

  // 4. Where statements came from: at least one rests on a point the doctor confirmed; the rules' conflict is shown; missing and uncertain things have their place.
  await expect(panel.locator('summary', { hasText: /Sources \(\d+\):.*\bF\d/ }).first()).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Conflicts and uncertainties' })).toContainText('Found by fixed rules, not by the AI')
  await expect(panel.getByRole('region', { name: 'Conflicts and uncertainties' })).toContainText(/Amoxicillin/i)
  const statements = panel.getByTestId('consult-statement')
  const rows = await statements.evaluateAll((els) => els.map((el) => ({ section: el.getAttribute('data-section') ?? '', support: el.getAttribute('data-support') ?? '', text: (el.querySelector('p.text-sm') as HTMLElement | null)?.innerText ?? '' })))
  console.log(`real models, whole chain: ${confirmed} confirmed point(s); draft with ${rows.length} statements`)
  for (const r of rows.slice(0, 14)) console.log(`  [${r.section} · ${r.support}] ${r.text}`)
  await expect(page.getByLabel('History of present illness')).toHaveValue('')

  // 5. Accept one statement and add it to the note: the note changes only now.
  const target = panel.locator('[data-testid="consult-statement"][data-section="presenting_problem"]').first()
  const one = (await target.count()) ? target : statements.first()
  const added = (await one.locator('p.text-sm').first().innerText()).trim()
  const tick = one.getByLabel('I have checked this against the record')
  if (await tick.count()) await tick.check()
  await one.getByRole('button', { name: 'Accept' }).click()
  await expect(one).toContainText('Accepted')
  await one.getByRole('button', { name: 'Add to note' }).click()
  await expect(one).toContainText('In the note')

  // 6. The doctor writes the rest (the diagnosis and the plan are the doctor's own: nothing in the draft can write to them), reviews and signs. The drafted medicine is
  // removed: the conflict was only there to be found.
  await page.getByRole('button', { name: /^Remove medicine/ }).first().click()
  await page.getByRole('button', { name: 'Add diagnosis' }).click()
  await page.getByLabel('Diagnosis 1', { exact: true }).fill('Acute pharyngitis (provisional)')
  await page.getByLabel('Plan').fill('Fluids and rest. Review if no better in three days.')
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Complete consultation' }).click()
  const review = page.getByRole('dialog', { name: 'Review and sign' })
  await expect(review).toContainText('AI-assisted text')
  await review.getByLabel(/I have reviewed this record/).check()
  await review.getByRole('button', { name: 'Sign and complete' }).click()
  await expect(page.getByText(/^Signed /)).toBeVisible({ timeout: 30_000 })

  // 7. Later, the signed record says what the AI-assisted text came from and which model and prompt produced it.
  const main = page.locator('main')
  await expect(main).toContainText('consultation draft statement')
  await expect(main).toContainText('qwen3.5-4b-q4_k_m')
  await expect(main).toContainText('consult-draft-v1')
  await expect(main).toContainText(added.slice(0, 20))
  await expectNoAxeViolations(page)
  await page.screenshot({ path: testInfo.outputPath('consult-real-chain-signed.png'), fullPage: true })
})
