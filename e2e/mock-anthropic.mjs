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
//   transcript line, and one citing a reference that does not exist.
import http from 'node:http'

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

function respond(body) {
  const system = typeof body.system === 'string' ? body.system : ''
  const content = body.messages?.[0]?.content
  const user = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : ''
  if (system.startsWith('You extract clinically relevant facts')) return factsFrom(user)
  if (system.startsWith('You provide clinical decision support')) return recommendationsFrom(user)
  if (system.startsWith('You describe a clinical photograph')) {
    return { quality: 'limited', qualityReason: 'Test image (mock).', observations: [{ text: 'A uniformly coloured area (test output).', location: 'centre', confidence: 'low' }], limitations: ['Mock output for automated tests; not an analysis.'], summary: 'Mock description for automated tests.' }
  }
  return draftFrom(user)
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end('ok')
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'mock: unknown route' } }))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString())
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
