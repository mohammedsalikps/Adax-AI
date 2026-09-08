import type { Speaker, TranscriptLine } from '@/types/consultation'

/* ------------------------------------------------------------------
   Scripted consultation conversations for the mock transcription
   service. Entirely fictional. No audio is captured and no speech
   recognition runs — these lines are replayed on a timer to simulate
   a live transcript.
------------------------------------------------------------------ */

interface ScriptLine {
  speaker: Speaker
  text: string
  /** Recogniser confidence, replayed so the interface can show it. */
  confidence: number
}

/** Used for any patient without a specific script. */
const BACK_PAIN_SCRIPT: ScriptLine[] = [
  { speaker: 'doctor', text: 'Good morning. What brings you in today?', confidence: 0.98 },
  {
    speaker: 'patient',
    text: 'I have been having lower back pain for three days.',
    confidence: 0.96,
  },
  { speaker: 'doctor', text: 'Any fever or recent injury?', confidence: 0.97 },
  {
    speaker: 'patient',
    text: 'No fever. I lifted something heavy at home last week.',
    confidence: 0.94,
  },
  { speaker: 'doctor', text: 'How severe is the pain?', confidence: 0.98 },
  { speaker: 'patient', text: 'Around six out of ten.', confidence: 0.95 },
  {
    speaker: 'doctor',
    text: 'Does the pain travel down either leg, or is there any numbness?',
    confidence: 0.96,
  },
  {
    speaker: 'patient',
    text: 'No, it stays in the lower back. No numbness anywhere.',
    confidence: 0.95,
  },
  {
    speaker: 'doctor',
    text: 'Let me examine you. There is tenderness over the lumbar paraspinal muscles, and straight leg raise is negative on both sides.',
    confidence: 0.92,
  },
  {
    speaker: 'doctor',
    text: 'This looks like mechanical low back pain from the lifting strain.',
    confidence: 0.93,
  },
  {
    speaker: 'doctor',
    text: 'I would advise you to apply heat, keep moving gently, and avoid heavy lifting for two weeks.',
    confidence: 0.95,
  },
  {
    speaker: 'doctor',
    text: 'Come back in two weeks if the pain has not settled, or sooner if you develop leg weakness.',
    confidence: 0.94,
  },
  { speaker: 'patient', text: 'Understood, thank you doctor.', confidence: 0.97 },
]

/**
 * A review consultation that deliberately contains no examination and no
 * spoken impression, so the draft correctly reports those as not mentioned.
 */
const DIABETES_REVIEW_SCRIPT: ScriptLine[] = [
  { speaker: 'doctor', text: 'How can I help you today?', confidence: 0.97 },
  {
    speaker: 'patient',
    text: 'I am here for my three month diabetes review, and I have been feeling very tired.',
    confidence: 0.95,
  },
  { speaker: 'doctor', text: 'How long has the tiredness been going on?', confidence: 0.97 },
  {
    speaker: 'patient',
    text: 'About six weeks now. It is worse in the afternoons.',
    confidence: 0.94,
  },
  {
    speaker: 'doctor',
    text: 'Have you noticed any numbness or tingling in your feet?',
    confidence: 0.96,
  },
  {
    speaker: 'patient',
    text: 'Yes, some tingling in both feet, mostly at night.',
    confidence: 0.93,
  },
  { speaker: 'doctor', text: 'And how has your diet been?', confidence: 0.98 },
  {
    speaker: 'patient',
    text: 'Not great. We have been eating out a lot over the past two months.',
    confidence: 0.94,
  },
  {
    speaker: 'doctor',
    text: 'I would advise cutting back on eating out and restarting your daily walk.',
    confidence: 0.95,
  },
  {
    speaker: 'doctor',
    text: 'Please book a follow up in three months, and repeat the blood tests one week before.',
    confidence: 0.96,
  },
]

const SCRIPTS: Record<string, ScriptLine[]> = {
  'PT-2026-00142': DIABETES_REVIEW_SCRIPT,
}

/** Roughly how long each spoken line takes, for realistic timestamps. */
const LINE_INTERVAL_MS = 4200

/**
 * The scripted transcript for a patient, as TranscriptLine records.
 * Deterministic: the same patient always yields the same conversation.
 */
export function getTranscriptScript(patientId: string): TranscriptLine[] {
  const script = SCRIPTS[patientId] ?? BACK_PAIN_SCRIPT

  return script.map((line, index) => ({
    id: `tl_${patientId}_${index}`,
    speaker: line.speaker,
    text: line.text,
    offsetMs: index * LINE_INTERVAL_MS,
    isFinal: true,
    confidence: line.confidence,
  }))
}
