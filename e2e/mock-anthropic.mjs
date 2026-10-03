// TEST-ONLY stand-in for the Anthropic Messages API, used solely by the
// Playwright suite (see playwright.config.ts). It lets the end-to-end tests
// exercise the real UI -> API -> SDK -> HTTP path without credentials.
// It is never started by `npm run dev`, setup or any demo configuration.
//
// It recognises which application prompt it received from the system prompt
// and derives deterministic output from the input it is sent:
// - note draft: chiefComplaint from the first Patient segment, plan from the
//   last Doctor segment, and one deliberately unsourced item;
// - fact extraction: one fact per Patient segment (allergy lines become a
//   negated allergy fact) and one deliberately uncertain, unsourced fact;
// - recommendations: one point citing the first record item and the first
//   transcript line, and one citing a reference that does not exist;
// - Mana record questions: one statement citing the first two record items,
//   one citing a reference that does not exist, and one "not found" entry.
import http from 'node:http'
// The phrase by which a request is recognised as carrying words from the synthetic consultation of the speech stand-in (one definition, shared with it).
import { CAPTURE_PHRASE } from './synthetic-consultation.mjs'

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT || 4199)

const segmentsOf = (text) => [...text.matchAll(/^\[(S\d+)\] (?:(\w+): )?(.*)$/gm)].map((m) => ({ id: m[1], speaker: m[2] ?? null, text: m[3] }))
const nullDetails = { substance: null, medication: null, dose: null, duration: null, vitalKind: null, value: null, unit: null }

function draftFrom(userText) {
  const lines = segmentsOf(userText)
  const firstPatient = lines.find((l) => l.speaker === 'Patient')
  const lastDoctor = [...lines].reverse().find((l) => l.speaker === 'Doctor')
  const items = []
  if (firstPatient) items.push({ section: 'chiefComplaint', text: `Reports: ${firstPatient.text}`, sourceSegmentIds: [firstPatient.id] })
  if (lastDoctor) items.push({ section: 'plan', text: `Doctor advised: ${lastDoctor.text}`, sourceSegmentIds: [lastDoctor.id] })
  items.push({ section: 'assessment', text: 'Unsourced test suggestion.', sourceSegmentIds: ['S999'] })
  return { items }
}

function factsFrom(userText) {
  const facts = segmentsOf(userText)
    .filter((l) => l.speaker === 'Patient')
    .map((l, i) => {
      const allergy = /allerg/i.test(l.text)
      return {
        category: allergy ? 'allergy' : i === 0 ? 'chief_complaint' : 'symptom',
        text: allergy ? 'Denies any allergies.' : `Reports: ${l.text}`,
        attribution: 'patient_reported',
        certainty: 'stated',
        uncertaintyReason: null,
        negated: allergy && /\bno\b/i.test(l.text),
        details: nullDetails,
        sourceSegmentIds: [l.id],
      }
    })
  facts.push({ category: 'symptom', text: 'Possibly mentions night sweats.', attribution: 'other_speaker', certainty: 'uncertain', uncertaintyReason: 'Unclear in the recording (test).', negated: false, details: nullDetails, sourceSegmentIds: ['S999'] })
  return { facts }
}

function recommendationsFrom(userText) {
  const firstRecord = userText.match(/^\[([A-Z]\d+)\]/m)?.[1]
  const firstSegment = userText.match(/^\[(S\d+)\]/m)?.[1]
  const refs = [firstRecord, firstSegment].filter(Boolean)
  return {
    insufficientData: false,
    insufficientDataReason: null,
    recommendations: [
      { kind: 'clarification', urgency: 'routine', text: 'Consider confirming the history with the patient (test).', rationale: 'Based on the cited record item and transcript line (test).', supportingRefs: refs, conflicts: [], missingInformation: ['Duration of symptoms'] },
      { kind: 'investigation', urgency: 'routine', text: 'Unsupported test recommendation.', rationale: 'Cites nothing that exists (test).', supportingRefs: ['Z99'], conflicts: [], missingInformation: [] },
    ],
  }
}

function manaFrom(userText) {
  const refs = [...userText.matchAll(/^\[([A-Z]\d+)\]/gm)].map((m) => m[1])
  return {
    statements: [
      { text: `Summary of ${refs.length} record items for this question (mock output for automated tests).`, refs: refs.slice(0, 2) },
      { text: 'Unsupported mock statement.', refs: ['Z99'] },
    ],
    conflicts: [],
    notFound: ['Recent HbA1c (mock)'],
  }
}

function respond(body) {
  const system = typeof body.system === 'string' ? body.system : ''
  const content = body.messages?.[0]?.content
  const user = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : ''
  if (system.startsWith('You extract clinically relevant facts')) return factsFrom(user)
  if (system.startsWith('You provide clinical decision support')) return recommendationsFrom(user)
  if (system.startsWith("You answer a doctor's question about one patient")) return manaFrom(user)
  if (system.startsWith('You describe a clinical photograph')) {
    return { quality: 'limited', qualityReason: 'Test image (mock).', observations: [{ text: 'A uniformly coloured area (test output).', location: 'centre', confidence: 'low' }], limitations: ['Mock output for automated tests; not an analysis.'], summary: 'Mock description for automated tests.' }
  }
  return draftFrom(user)
}

// How many requests the (mock) hosted provider has been sent: a count only, no content. The capture tests read it to show that recording, transcription
// and the important points never call a hosted provider.
let messages = 0
// Requests that carry a phrase only the speech stand-in (e2e/mock-speech.mjs) ever "hears": other specs call this mock in parallel, so the capture tests
// check that none of THEIR text reaches it, not that nobody called it.
let fromCapture = 0

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end('ok')
    }
    if (req.method === 'GET' && req.url === '/__calls') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ calls: messages, fromCapture }))
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'mock: unknown route' } }))
      }
      messages++
      const raw = Buffer.concat(chunks).toString()
      if (raw.includes(CAPTURE_PHRASE)) fromCapture++
      const body = JSON.parse(raw)
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_mock_${Date.now()}` })
      res.end(
        JSON.stringify({
          id: `msg_mock_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: 'mock-anthropic-e2e',
          content: [{ type: 'text', text: JSON.stringify(respond(body)) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      )
    })
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[mock-anthropic] TEST-ONLY mock listening on ${PORT}`))
