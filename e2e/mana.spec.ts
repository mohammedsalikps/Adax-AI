import { expect, test } from '@playwright/test'
import { expectNoAxeViolations, expectNoHorizontalOverflow, nurseHandsOverPatient, signIn } from './support.ts'

// Mana AI. Record answers come from explicit rules; the AI summary comes from
// the TEST-ONLY mock of the Anthropic Messages API (e2e/mock-anthropic.mjs).
// All patients are synthetic.

test('Mana answers from the record with sources, labels the AI summary, and inserted text keeps its provenance through signing', async ({ page, baseURL }) => {
  const p = await nurseHandsOverPatient(baseURL!, { allergies: ['Penicillin'], consents: ['ai_record_assistant'] })
  await signIn(page, 'dr.meera')
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('button', { name: 'Start consultation' }).click()
  await expect(page).toHaveURL(/\/doctor\/encounters\//)

  const mana = page.getByRole('region', { name: 'Mana AI' })
  await mana.getByRole('button', { name: 'Pre-consultation briefing' }).click()
  const answer = mana.getByTestId('mana-answer').filter({ hasText: 'Give me a pre-consultation briefing.' })
  await expect(answer).toContainText('From the record')
  await expect(answer).toContainText('Allergy to Penicillin, severity moderate')
  await expect(answer).toContainText('Reason for visit: “Sore throat and fever”')
  await expect(answer).toContainText('Temperature 38.2 °C at this visit (measured by staff); no earlier reading')
  await expect(answer).toContainText('There is no signed consultation in the record.')
  await expect(answer.getByText('Not in record').first()).toBeVisible()

  // Every statement can be expanded to its source: field, date, status and provenance.
  await answer.getByText(/^Sources: A1$/).first().click()
  const source = answer.locator('details[open]').first()
  await expect(source).toContainText('Allergy')
  await expect(source).toContainText('Active')
  await expect(source).toContainText('Existing record')

  // The AI summary is separate, labelled, cites record items, and flags what it could not support.
  const summary = answer.getByTestId('mana-ai-summary')
  await expect(summary).toContainText('AI-generated summary · check against the sources')
  await expect(summary).toContainText('mock output for automated tests')
  await expect(summary).toContainText('Not supported by the record')
  await expect(summary).toContainText('Not found in the record: Recent HbA1c (mock)')
  await expect(summary).toContainText('prompt mana-qa-v1')
  await expectNoAxeViolations(page)

  // A follow-up question in the doctor's own words.
  await mana.getByLabel('Ask Mana').fill('Any mention of fever?')
  await mana.getByRole('button', { name: 'Ask', exact: true }).click()
  const followUp = mana.getByTestId('mana-answer').filter({ hasText: 'Any mention of fever?' })
  await expect(followUp).toContainText('Record search')
  await expect(followUp).toContainText('Record items mentioning fever')
  await expect(followUp).toContainText('Reason for visit (this visit): “Sore throat and fever”')

  // Insert reviewed text into the note: recorded with a reference to this answer.
  await answer.getByRole('button', { name: 'Mark reviewed' }).click()
  await expect(answer).toContainText('Reviewed by Dr. Meera Iyer')
  await answer.getByRole('button', { name: 'Insert into note…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert into the note' })
  await dialog.getByLabel('Note section').selectOption({ label: 'Medical history' })
  await dialog.getByLabel('Text to insert').fill('Penicillin allergy on record (checked with Mana sources).')
  await dialog.getByRole('button', { name: 'Insert into Medical history' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByLabel('Medical history')).toHaveValue('Penicillin allergy on record (checked with Mana sources).')
  await expect(page.getByRole('list', { name: 'AI-assisted text in this section' })).toContainText('AI-assisted text from mana answer (anthropic · mock-anthropic-e2e · mana-qa-v1; record rules mana-record-v1; text chosen and edited by the doctor)')
  await expect(answer).toContainText('In the note ×1')

  // Complete and sign: the review shows the AI-assisted text, and the signed record keeps it.
  await page.getByLabel('Assessment').fill('Acute pharyngitis, likely viral.')
  await page.getByLabel('Plan').fill('Warm saline gargles and fluids.')
  await page.getByRole('button', { name: 'Add diagnosis' }).click()
  await page.getByLabel('Diagnosis 1', { exact: true }).fill('Acute pharyngitis')
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Review and sign' }).click()
  const review = page.getByRole('dialog', { name: 'Review and sign' })
  await expect(review).toContainText('AI-assisted text in this note')
  await expect(review).toContainText('Medical history: AI-assisted text from mana answer')
  await review.getByLabel(/I have reviewed this record/).check()
  await review.getByRole('button', { name: 'Sign and complete' }).click()
  const signed = page.getByRole('region', { name: 'AI-assisted text' })
  await expect(signed).toContainText('unchanged in the note')

  // The patient record keeps Mana's earlier answers for this patient.
  await page.goto(`/doctor/patients/${p.patientId}`)
  const onProfile = page.getByRole('region', { name: 'Mana AI' })
  await expect(onProfile.getByTestId('mana-answer').first()).toContainText('Any mention of fever?')
  await expect(onProfile.getByRole('button', { name: 'Insert into note…' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('without the patient’s consent Mana still answers from the record but sends nothing for an AI summary', async ({ page, baseURL }) => {
  const p = await nurseHandsOverPatient(baseURL!)
  await signIn(page, 'dr.meera')
  await page.goto(`/doctor/patients/${p.patientId}`)
  const mana = page.getByRole('region', { name: 'Mana AI' })
  await mana.getByRole('button', { name: 'Last prescription' }).click()
  const answer = mana.getByTestId('mana-answer').first()
  await expect(answer).toContainText('There is no signed consultation in the record.')
  await expect(answer).toContainText('No AI summary: consent needed.')
  await expect(answer.getByTestId('mana-ai-summary')).toHaveCount(0)
  await expectNoAxeViolations(page)
  await expectNoHorizontalOverflow(page)
})
