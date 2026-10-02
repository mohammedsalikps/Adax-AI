// TEST-ONLY stand-in for the Anthropic Messages API, used solely by the
// Playwright suite (see playwright.config.ts). It lets the end-to-end tests
// exercise the real UI -> API -> SDK -> HTTP path without credentials.
// It is never started by `npm run dev`, setup or any demo configuration.
//
// It derives a deterministic draft from the transcript it receives:
// - chiefComplaint from the first Patient segment
// - plan from the last Doctor segment
// - one deliberately unsourced "assessment" item (cites a segment that does
//   not exist) so the UI's unsupported-suggestion safeguard is exercised.
import http from 'node:http'

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT || 4199)

function draftFrom(userText) {
  const lines = [...userText.matchAll(/^\[(S\d+)\] (?:(\w+): )?(.*)$/gm)].map((m) => ({ id: m[1], speaker: m[2] ?? null, text: m[3] }))
  const firstPatient = lines.find((l) => l.speaker === 'Patient')
  const lastDoctor = [...lines].reverse().find((l) => l.speaker === 'Doctor')
  const items = []
  if (firstPatient) items.push({ section: 'chiefComplaint', text: `Reports: ${firstPatient.text}`, sourceSegmentIds: [firstPatient.id] })
  if (lastDoctor) items.push({ section: 'plan', text: `Doctor advised: ${lastDoctor.text}`, sourceSegmentIds: [lastDoctor.id] })
  items.push({ section: 'assessment', text: 'Unsourced test suggestion.', sourceSegmentIds: ['S999'] })
  return { items }
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
      const user = body.messages?.[0]?.content ?? ''
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_mock_${Date.now()}` })
      res.end(
        JSON.stringify({
          id: `msg_mock_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: 'mock-anthropic-e2e',
          content: [{ type: 'text', text: JSON.stringify(draftFrom(typeof user === 'string' ? user : '')) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      )
    })
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[mock-anthropic] TEST-ONLY mock listening on ${PORT}`))
