import { expect, test } from '@playwright/test'
import { nurseHandsOverPatient, signIn } from './support.ts'

// OPT-IN, not part of the normal suite: a real browser records synthetic speech, the real API sends it to the REAL local speech model, and the
// transcript and the important points are read back. It needs the local speech service running with its model, and a WAV for the synthetic microphone:
//
//   node data/eval/consultations-v1/make-demo-wav.mjs c01 8        (after synthesise-audio.ps1)
//   E2E_SPEECH_URL=http://127.0.0.1:8002 E2E_FAKE_AUDIO_FILE=<repo>/data/eval/audio/c01-demo.wav npx playwright test e2e/capture-real.spec.ts --project=desktop-chromium
//
// The speech is clean synthetic text-to-speech of a scripted consultation (data/eval/consultations-v1); this shows the chain works with the real
// model, it is not a measurement of accuracy.

test.skip(!process.env.E2E_SPEECH_URL || !process.env.E2E_FAKE_AUDIO_FILE, 'opt-in: needs E2E_SPEECH_URL (a running local speech service) and E2E_FAKE_AUDIO_FILE (a speech WAV)')

test('real browser → real API → real local speech model: a timed English transcript and important points', async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, 'The synthetic microphone is configured for the desktop project')
  test.setTimeout(180_000)
  const p = await nurseHandsOverPatient(baseURL!, { consents: ['ai_recording'] })
  await signIn(page, 'dr.meera')
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('button', { name: 'Start consultation' }).click()
  const live = page.getByRole('region', { name: 'Live transcription' })
  const points = page.getByRole('region', { name: 'Important points' })
  await expect(live.getByTestId('speech-status')).toContainText('faster-whisper-small')

  await live.getByRole('button', { name: 'Start recording' }).click()
  await expect(live.getByTestId('recording-state')).toContainText('Recording')
  // One full 20-second part is sent while recording; the rest when stopped.
  await expect(live.getByTestId('transcript-line').first()).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(8_000)
  await live.getByRole('button', { name: 'Stop' }).click()
  await expect(live.getByRole('button', { name: 'Start recording' })).toBeVisible({ timeout: 90_000 })

  const raw = live.getByTestId('raw-transcript')
  await expect(live.getByTestId('transcript-section').first()).toContainText('English')
  const text = (await raw.innerText()).toLowerCase()
  console.log(`transcript (synthetic speech, real model): ${text.replace(/\s+/g, ' ').slice(0, 600)}`)
  expect(text).toMatch(/fever/)
  expect(text).toMatch(/cough/)
  const times = await raw.getByTestId('transcript-line').evaluateAll((els) => els.map((el) => /(\d\d:\d\d)/.exec(el.textContent ?? '')?.[1] ?? ''))
  expect(times.length).toBeGreaterThan(2)
  expect(times).toEqual([...times].sort())
  await expect(points.locator('[data-testid="important-point"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(points.locator('[data-testid="important-point"][data-state="extracted"]').first()).toContainText('Rules on this computer')
  await page.screenshot({ path: test.info().outputPath('capture-real-model.png') })
})
