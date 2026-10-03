import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, nurseHandsOverPatient, signIn } from './support.ts'

// In this suite the API talks to a TEST-ONLY mock of the Anthropic Messages API
// (e2e/mock-anthropic.mjs) through the real SDK; speech-to-text is unconfigured.

test('doctor records consent, saves a transcript, reviews AI suggestions and signs only reviewed text', async ({ page, baseURL, isMobile }) => {
  const p = await nurseHandsOverPatient(baseURL!)
  await signIn(page, 'dr.meera')
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('button', { name: 'Start consultation' }).click()
  await expect(page).toHaveURL(/\/doctor\/encounters\//)

  const panel = page.getByRole('region', { name: 'AI consultation assistant' })
  await expect(panel).toContainText('AI drafting: available')
  await expect(panel).toContainText('Speech-to-text: unavailable')

  // Nothing can be recorded or drafted before consent.
  await expect(panel.getByRole('button', { name: 'Start recording' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Patient agrees (verbal)' }).click()
  await expect(panel).toContainText('Consent recorded for this consultation')

  if (!isMobile) {
    // Browser recording with Chromium's fake microphone: audio is stored; transcription is honestly unavailable.
    await panel.getByRole('button', { name: 'Start recording' }).click()
    await expect(panel.getByText(/Recording 0:0[1-9]/)).toBeVisible({ timeout: 10_000 })
    await panel.getByRole('button', { name: 'Stop and save' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Speech-to-text is not configured' })).toBeVisible()
    await expect(panel.getByRole('list', { name: 'Saved recordings' })).toContainText('not transcribed')
  }

  await panel.getByLabel('Or type / paste the transcript').fill(
    ['Doctor: What brings you in today?', 'Patient: My throat hurts and I have had fever for two days.', 'Doctor: Your throat is red. Take warm saline gargles and plenty of fluids.'].join('\n'),
  )
  await panel.getByRole('button', { name: 'Save transcript' }).click()
  await expect(panel.getByRole('list', { name: 'Transcript segments' })).toContainText('S2 Patient: My throat hurts')

  await panel.getByRole('button', { name: 'Generate draft' }).click()
  const suggestions = panel.getByRole('region', { name: 'Suggestions to review' })
  await expect(suggestions).toContainText('3 pending')
  await expectNoAxeViolations(page)

  // Nothing has reached the note yet.
  await expect(page.getByLabel('Plan', { exact: true })).toHaveValue('')

  // Accept the chief complaint: appended to the note field.
  const cc = suggestions.getByRole('listitem').filter({ hasText: 'Reports: My throat hurts' })
  await cc.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByLabel('Chief complaint')).toHaveValue(/Sore throat and fever\nReports: My throat hurts and I have had fever for two days\./)

  // Edit the plan before adding it.
  const plan = suggestions.getByRole('listitem').filter({ hasText: 'Doctor advised:' }).or(suggestions.getByRole('listitem').filter({ has: page.getByLabel('Edit before adding') }))
  await plan.getByRole('button', { name: 'Edit' }).click()
  await plan.getByLabel('Edit before adding').fill('Warm saline gargles; oral fluids.')
  await plan.getByRole('button', { name: 'Add edited text' }).click()
  await expect(page.getByLabel('Plan', { exact: true })).toHaveValue('Warm saline gargles; oral fluids.')

  // The unsourced suggestion cannot be accepted without explicit confirmation; reject it.
  const unsourced = suggestions.getByRole('listitem').filter({ hasText: 'Unsourced test suggestion.' })
  await expect(unsourced).toContainText('Not linked to any part of the transcript')
  await expect(unsourced.getByRole('button', { name: 'Accept' })).toBeDisabled()
  await unsourced.getByRole('button', { name: 'Reject' }).click()
  await expect(unsourced).toContainText('Rejected')
  await expect(page.getByLabel('Assessment')).toHaveValue('')

  // Sign: the signed record contains exactly what the doctor accepted.
  await page.getByRole('button', { name: 'Add diagnosis' }).click()
  await page.getByLabel('Diagnosis 1', { exact: true }).fill('Acute pharyngitis')
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Complete consultation' }).click()
  const review = page.getByRole('dialog', { name: 'Review and sign' })
  await expect(review).toContainText('Warm saline gargles; oral fluids.')
  await expect(review).not.toContainText('Unsourced test suggestion.')
  await review.getByLabel(/including any AI-assisted text/).check()
  await review.getByRole('button', { name: 'Sign and complete' }).click()
  await expect(page.getByText(/^Signed /)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Consultation note' })).toContainText('Warm saline gargles; oral fluids.')
})
