import { createId } from '@/lib/ids'
import {
  NOT_MENTIONED,
  type ConsultationAiDraft,
  type DraftDiagnosis,
  type DraftSection,
  type TranscriptLine,
} from '@/types/consultation'

/* ------------------------------------------------------------------
   Mock documentation assistant.

   This is a deterministic text extractor, NOT a medical AI model. It
   classifies transcript lines by the phrases they contain and composes
   each draft section from those lines verbatim. It cannot diagnose,
   cannot recommend treatment, and cannot produce any clinical content
   that is not already spoken in the transcript — a section with no
   matching lines is reported as "Not mentioned in transcript."
------------------------------------------------------------------ */

const GENERATION_LATENCY_MS = 900

/** Doctor phrases that invite the patient to state why they attended. */
const OPENING_QUESTION =
  /(brings you in|bring you in|how can i help|what seems|what.s the problem|what is the problem|what can i do for you)/i

/** Doctor phrases that report a physical finding. */
const EXAMINATION_CUE =
  /(let me examine|on examination|examination shows|there is tenderness|tenderness over|straight leg raise|i can feel|chest is clear|abdomen is|your blood pressure is|your pulse is)/i

/** Doctor phrases that voice an impression the clinician themselves stated. */
const IMPRESSION_CUE =
  /(this looks like|looks like|appears to be|consistent with|my impression is|impression is|this is likely|most likely)/i

/** Doctor phrases carrying advice given during the consultation. */
const ADVICE_CUE =
  /(i would advise|i'd advise|advise|recommend|avoid|apply heat|keep moving|cut back|cutting back|make sure you|try to)/i

/** Doctor phrases arranging the next contact. */
const FOLLOW_UP_CUE =
  /(come back|follow.?up|review in|see you in|return in|book a follow|repeat the blood tests)/i

function toSection(lines: TranscriptLine[]): DraftSection {
  if (lines.length === 0) {
    return { text: NOT_MENTIONED, sourceLineIds: [] }
  }
  return {
    text: lines.map((line) => line.text).join(' '),
    sourceLineIds: lines.map((line) => line.id),
  }
}

function toDiagnosis(line: TranscriptLine): DraftDiagnosis {
  const match = IMPRESSION_CUE.exec(line.text)
  const remainder = match
    ? line.text.slice(match.index + match[0].length).trim()
    : line.text
  const name = remainder.replace(/[.\s]+$/, '') || line.text

  return {
    id: createId('dx'),
    // Capitalised for the form, but otherwise the clinician's own words.
    name: name.charAt(0).toUpperCase() + name.slice(1),
    evidence: line.text,
    sourceLineId: line.id,
  }
}

/**
 * Builds a draft from a transcript. Pure and synchronous — the same
 * transcript always produces the same draft.
 */
export function buildClinicalDraft(transcript: TranscriptLine[]): ConsultationAiDraft {
  const lines = transcript.filter((line) => line.isFinal && line.text.trim())
  const doctorLines = lines.filter((line) => line.speaker === 'doctor')
  const patientLines = lines.filter((line) => line.speaker === 'patient')

  // Chief complaint: the patient's answer to the opening question, or their
  // first utterance if no opening question was recorded.
  const promptIndex = lines.findIndex(
    (line) => line.speaker === 'doctor' && OPENING_QUESTION.test(line.text),
  )
  const complaintLine =
    promptIndex === -1
      ? patientLines[0]
      : lines.slice(promptIndex + 1).find((line) => line.speaker === 'patient')

  const historyLines = patientLines.filter((line) => line.id !== complaintLine?.id)

  // Each doctor line falls into at most one category, in priority order, so
  // no sentence is counted twice across sections.
  const examinationLines: TranscriptLine[] = []
  const impressionLines: TranscriptLine[] = []
  const followUpLines: TranscriptLine[] = []
  const adviceLines: TranscriptLine[] = []

  for (const line of doctorLines) {
    if (EXAMINATION_CUE.test(line.text)) examinationLines.push(line)
    else if (IMPRESSION_CUE.test(line.text)) impressionLines.push(line)
    else if (FOLLOW_UP_CUE.test(line.text)) followUpLines.push(line)
    else if (ADVICE_CUE.test(line.text)) adviceLines.push(line)
  }

  return {
    id: createId('draft'),
    generatedAt: new Date().toISOString(),
    sourceLineCount: lines.length,
    chiefComplaint: toSection(complaintLine ? [complaintLine] : []),
    historyOfPresentIllness: toSection(historyLines),
    examination: toSection(examinationLines),
    clinicalNotes: toSection(adviceLines),
    diagnoses: impressionLines.map(toDiagnosis),
    followUpInstructions: toSection(followUpLines),
  }
}

/**
 * The service entry point used by the interface. Adds latency so the
 * generating state is visible, and refuses an empty transcript rather than
 * returning an empty draft that looks like a result.
 */
export function generateClinicalDraft(
  transcript: TranscriptLine[],
): Promise<ConsultationAiDraft> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const usable = transcript.filter((line) => line.isFinal && line.text.trim())
      if (usable.length === 0) {
        reject(
          new Error(
            'There is no transcript to work from. Record or add transcript lines first.',
          ),
        )
        return
      }
      resolve(buildClinicalDraft(transcript))
    }, GENERATION_LATENCY_MS)
  })
}
