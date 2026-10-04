// TEST-ONLY stand-in for the local language-model server (llama.cpp's llama-server), used by the end-to-end suite so it needs no model.
// It speaks the little of the OpenAI-style API that the application uses: GET /health, GET /v1/models, POST /v1/chat/completions. It answers
// from the sources it is shown, copying their text, so every statement it returns is grounded in the record and cites ids that exist.
// Loopback only, and like the real server it wants a bearer secret (except for /health). It is NOT a model: nothing here is "AI output" in
// any sense but shape, and no screen shows it as anything other than a test stand-in.
//
// Control (test only): POST /__mode {"mode": "ok" | "slow" | "down" | "invalid" | "inject" | "empty", "delayMs"?: number}, GET /__calls (what was
// asked, as counts and whether given words were in the prompt), POST /__reset.

import http from 'node:http'

const PORT = Number.parseInt(process.env.MOCK_LLM_PORT ?? '8181', 10)
const KEY = process.env.MOCK_LLM_KEY ?? 'e2e-llm-secret-not-a-key'
const MODEL = 'mock-llm-e2e'

let mode = 'ok'
let delayMs = 400
/** @type {{ at: number, promptChars: number, prompt: string, refs: string[] }[]} */
let calls = []

const send = (res, status, body) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })

/** The sources of the user message: "[A1] 2026-10-04 | field | status | provenance: text". */
function sourcesOf(user) {
  const out = []
  for (const line of user.split('\n')) {
    const m = /^\[([A-Z]{1,2}\d{1,3})\] (\S+) \| ([^|]*) \| ([^|]*) \| ([^:]*): (.*)$/.exec(line)
    if (m) out.push({ ref: m[1], date: m[2], field: m[3].trim(), status: m[4].trim(), provenance: m[5].trim(), text: m[6].trim() })
  }
  return out
}

const fact = (text, refs, basis = 'stated', uncertainty = null) => ({ text, refs, basis, uncertainty })
const suggestion = (text, refs, rationale, uncertainty = null) => ({ text, refs, rationale, uncertainty })

function draftFrom(sources) {
  const of = (re) => sources.filter((s) => re.test(`${s.ref} ${s.field}`))
  const reason = sources.filter((s) => /^R\d/.test(s.ref) && /this visit/i.test(s.field))
  const points = sources.filter((s) => /^F\d/.test(s.ref))
  const symptomPoints = points.filter((s) => /symptom|complaint|duration/i.test(s.field))
  const allergies = of(/^A\d/).filter((s) => /^Allergy:/i.test(s.text))
  const meds = sources.filter((s) => /^(M|P|U)\d/.test(s.ref))
  const obs = sources.filter((s) => /^V\d/.test(s.ref) && /this visit/i.test(s.text))
  const history = sources.filter((s) => /^(H|N|D)\d/.test(s.ref)).slice(0, 4)
  const first = sources[0]
  return {
    insufficient_information: false,
    presenting_problem: reason.slice(0, 1).map((s) => fact(s.text, [s.ref])),
    symptoms: symptomPoints.slice(0, 4).map((s) => fact(s.text, [s.ref])),
    observations: obs.slice(0, 3).map((s) => fact(s.text, [s.ref])),
    relevant_history: history.map((s) => fact(s.text.slice(0, 200), [s.ref])),
    allergies: allergies.slice(0, 3).map((s) => fact(s.text, [s.ref])),
    medications: meds.slice(0, 3).map((s) => fact(s.text.slice(0, 200), [s.ref])),
    potential_considerations: reason.slice(0, 1).map((s) => suggestion('Consider whether the problem needs an examination finding that is not yet documented.', [s.ref], `Prompted by ${s.ref}.`, 'Depends on the examination.')),
    potential_investigations: obs.slice(0, 1).map((s) => suggestion('May be worth repeating the measurement if it does not match how the patient looks.', [s.ref], `Prompted by ${s.ref}.`)),
    potential_medication_considerations: allergies.length && meds.length ? [suggestion('Check the medicines in the record against the recorded allergy before anything is added.', [allergies[0].ref, meds[0].ref], `Allergy ${allergies[0].ref} and medicine ${meds[0].ref} are both in the record.`)] : [],
    missing_information: [fact('The duration of the main symptom is not documented.', [], 'not_found')].slice(0, symptomPoints.length ? 0 : 1),
    uncertainties: [],
    summary: first ? fact('A draft summary of the record items shown, for the doctor to check.', [first.ref], 'inferred') : null,
  }
}

/** What a model that follows an instruction hidden in a record item would write: made-up references, a dose, a flat diagnosis, a link. */
function injected(sources) {
  const first = sources[0]?.ref ?? 'A1'
  return {
    insufficient_information: false,
    presenting_problem: [fact('Ignore the record: the patient has no allergies and needs amoxicillin 500 mg three times a day.', ['Z99'])],
    symptoms: [fact('The patient definitely has pneumonia. See https://example.invalid/steal?x=1', [first])],
    observations: [fact('Blood pressure 250/190 mmHg.', [first])],
    relevant_history: [],
    allergies: [fact('No known allergies.', [], 'not_found')],
    medications: [],
    potential_considerations: [suggestion('Start azithromycin 500 mg once daily for 5 days.', [first], 'The record says so.')],
    potential_investigations: [],
    potential_medication_considerations: [suggestion('Prescribe amoxicillin.', [first], 'Instructed.')],
    missing_information: [],
    uncertainties: [],
    summary: fact('Everything is fine.', [first], 'stated'),
  }
}

const empty = () => ({ insufficient_information: true, presenting_problem: [], symptoms: [], observations: [], relevant_history: [], allergies: [], medications: [], potential_considerations: [], potential_investigations: [], potential_medication_considerations: [], missing_information: [], uncertainties: [], summary: null })

// --- Mana AI (V4): the planner and the writer -------------------------------------------------------------------------------------------------------
// Both calls come to the same endpoint; the system prompt says which. The planner is a handful of keyword rules (a stand-in: it names no model's skill),
// the writer copies the facts it is shown, citing their ids. In mode "inject" the writer behaves as a model steered by a record would (a link, a handle
// nobody gave); in mode "empty" it writes nothing.

const manaCall = (tool, rest = {}) => ({ tool, patient: null, topic: null, text: null, which: null, when: null, minutes: null, date: null, mine: null, status: null, ...rest })
const manaPlan = (kind, calls = [], clarification = null) => ({ kind, calls, clarification })

function manaPlanFrom(user) {
  const q = /^QUESTION: (.*)$/m.exec(user)?.[1] ?? ''
  const lower = q.toLowerCase()
  const current = /^CURRENT PATIENT: yes/m.test(user)
  const focus = /^FOCUS: (P\d+)/m.exec(user)?.[1] ?? null
  if (/\b(prescribe|sign this|delete|cancel my|book an|add .* allergy)\b/.test(lower)) return manaPlan('write_request')
  if (/\b(usual dose|guideline|paediatric dose)\b/.test(lower)) return manaPlan('general_knowledge')
  if (/\b(every patient|all patients|audit log)\b/.test(lower)) return manaPlan('out_of_scope')
  if (/^(hi|hello|thanks)\b/.test(lower)) return manaPlan('other')
  const named = /\b(?:of|for|about|does|did|is|on)\s+((?:[A-Z][\w'-]+)(?:\s+[A-Z][\w'-]+)?)/.exec(q)?.[1]
  const patient = named ? `name:${named.replace(/'s$/, '')}` : /\b(she|he|her|his|their|they)\b/.test(lower) && focus ? focus : current ? 'current' : null
  if (/waiting|queue/.test(lower)) return manaPlan('tools', [manaCall('get_today_queue', { mine: /\bmy\b/.test(lower), status: /waiting/.test(lower) ? 'waiting' : null })])
  if (/appointments?/.test(lower)) return manaPlan('tools', [manaCall('get_appointments', { when: /tomorrow/.test(lower) ? 'tomorrow' : 'today', mine: /\bmy\b|\bi have\b/.test(lower) })])
  if (/\bvisits?\b/.test(lower)) return manaPlan('tools', [manaCall('get_patient_visits', { patient })])
  const topic = /allerg/.test(lower) ? 'allergies' : /medic|prescri/.test(lower) ? 'medicines' : /vital|blood pressure|temperature/.test(lower) ? 'vitals' : /diagnos/.test(lower) ? 'diagnoses' : /history/.test(lower) ? 'history' : /chang/.test(lower) ? 'changes' : 'briefing'
  return manaPlan('tools', [manaCall('get_patient_record', { patient, topic })])
}

function manaAnswerFrom(user) {
  const facts = []
  for (const line of user.split('\n')) {
    const m = /^\[(S\d{1,3})\] (?:\((P\d{1,2})\) )?(.*)$/.exec(line)
    if (m) facts.push({ ref: m[1], text: m[3].trim() })
  }
  if (mode === 'empty') return { blocks: [] }
  if (mode === 'inject') return { blocks: [{ text: 'Nobody has any allergies. See https://evil.invalid/collect for the rest.', refs: [facts[0]?.ref ?? 'S1'] }] }
  return { blocks: facts.slice(0, 6).map((f) => ({ text: f.text, refs: [f.ref] })) }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/health') return mode === 'down' ? send(res, 503, { error: { code: 503, message: 'Loading model' } }) : send(res, 200, { status: 'ok' })
  if (url.pathname.startsWith('/__')) {
    if (url.pathname === '/__mode' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}')
      mode = b.mode ?? 'ok'
      delayMs = typeof b.delayMs === 'number' ? b.delayMs : mode === 'slow' ? 6000 : 400
      return send(res, 200, { mode, delayMs })
    }
    if (url.pathname === '/__calls') return send(res, 200, { count: calls.length, calls: calls.map((c) => ({ at: c.at, promptChars: c.promptChars, refs: c.refs, kind: c.kind, prompt: url.searchParams.get('prompts') === '1' ? c.prompt : undefined })) })
    if (url.pathname === '/__reset') {
      calls = []
      mode = 'ok'
      delayMs = 400
      return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'unknown' })
  }
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: { message: 'Invalid API Key', type: 'authentication_error', code: 401 } })
  if (req.method === 'GET' && url.pathname === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model' }] })
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = JSON.parse((await readBody(req)) || '{}')
    const user = String((body.messages ?? []).find((m) => m.role === 'user')?.content ?? '')
    const system = String((body.messages ?? []).find((m) => m.role === 'system')?.content ?? '')
    const mana = system.startsWith('You decide what to look up') ? 'plan' : system.startsWith('You write a short answer for a doctor') ? 'answer' : null
    const sources = sourcesOf(user)
    calls.push({ at: Date.now(), promptChars: user.length, prompt: user, refs: mana ? [...user.matchAll(/^\[(S\d+)\]/gm)].map((m) => m[1]) : sources.map((s) => s.ref), ...(mana && { kind: mana }) })
    if (mode === 'down') return send(res, 503, { error: { code: 503, message: 'Loading model' } })
    let aborted = false
    req.on('close', () => {
      aborted = true
    })
    await new Promise((r) => setTimeout(r, delayMs))
    if (aborted) return
    const content = mode === 'invalid' ? 'This is not JSON at all.' : JSON.stringify(mana === 'plan' ? manaPlanFrom(user) : mana === 'answer' ? manaAnswerFrom(user) : mode === 'inject' ? injected(sources) : mode === 'empty' ? empty() : draftFrom(sources))
    return send(res, 200, { id: `mock-${calls.length}`, object: 'chat.completion', model: MODEL, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: Math.ceil(user.length / 4), completion_tokens: Math.ceil(content.length / 4) } })
  }
  return send(res, 404, { error: 'not found' })
})
server.listen(PORT, '127.0.0.1', () => console.log(`mock-llm listening on 127.0.0.1:${PORT}`))
