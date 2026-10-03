// TEST-ONLY. The synthetic consultation that the speech stand-in (e2e/mock-speech.mjs) "hears", and the phrase by which the hosted-provider
// stand-in (e2e/mock-anthropic.mjs) recognises that words from it reached the provider. They live in one place so they cannot drift apart: a
// phrase that no longer appeared in the script would make "no capture words reached the hosted provider" true for the wrong reason.

/** `confidence` and the other scores are invented test values. */
export const SCRIPT = [
  { text: 'I have had a cough and a fever for three days.', confidence: 0.93, avgLogprob: -0.07, noSpeechProb: 0.01 },
  { text: 'I am allergic to penicillin.', confidence: 0.95, avgLogprob: -0.05, noSpeechProb: 0.01 },
  { text: 'I take metformin five hundred milligrams twice a day.', confidence: 0.9, avgLogprob: -0.1, noSpeechProb: 0.02 },
  { text: 'Let us do a chest X-ray and see you again in one week.', confidence: 0.88, avgLogprob: -0.13, noSpeechProb: 0.02 },
  // Below the app's "low model score" mark, so the end-to-end tests see how an unsure line is shown.
  { text: 'It gets worse in the evening.', confidence: 0.45, avgLogprob: -0.8, noSpeechProb: 0.1 },
]

/** A phrase only the speech stand-in ever produces (the other specs that call the hosted stand-in never type it). */
export const CAPTURE_PHRASE = 'metformin five hundred'

if (!SCRIPT.some((line) => line.text.includes(CAPTURE_PHRASE))) throw new Error('The capture phrase is not in the synthetic consultation: the check that its words never reach the hosted provider would pass for the wrong reason.')
