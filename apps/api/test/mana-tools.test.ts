import type { PlannedCall } from '@adaxai/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildManaWorld, createManaBase, type ManaWorld } from '../src/eval/mana-fixture.ts'
import type { SessionUser } from '../src/auth/sessions.ts'
import { EntityBook } from '../src/mana/assistant/entities.ts'
import { runTool } from '../src/mana/assistant/tools.ts'
import { type ManaCtx } from '../src/mana/assistant/types.ts'
import { facilityToday } from '../src/patients/service.ts'
import { loadAppSettings } from '../src/settings/load.ts'
import { adminQuery, call, createTestApp, login, resetDatabase, TEST_PASSWORD } from './helpers.ts'

// The tools are the only way Mana reaches a record, and none of them writes. These tests run them as a doctor of one clinic against a synthetic clinic
// (a second clinic, a few patients with histories, today's queue and appointments) and check what they return, to whom, and what they refuse.

const ctx = createTestApp()
let world: ManaWorld
let today = ''
const settings = loadAppSettings()

beforeAll(async () => {
  await resetDatabase()
  const base = await createManaBase(ctx.db, TEST_PASSWORD)
  world = await buildManaWorld({ call: (m, u, o) => call(ctx.app, m, u, o ?? {}), login: (u) => login(ctx.app, u), admin: (s, p) => adminQuery(s, p), db: ctx.db }, base, TEST_PASSWORD)
  today = await facilityToday(ctx.db, base.facilityId)
}, 120_000)
afterAll(() => ctx.close())

const WHO = { doctor: 'doctor', doctor2: 'doctor2' } as const
function me(who: 'doctor' | 'doctor2' | 'doctorB' | 'admin' | 'nurse'): SessionUser {
  const b = world.base
  const m = {
    doctor: { id: b.users.doctor, username: 't.doctor', facilityId: b.facilityId, departmentId: b.departments.gen, role: 'doctor' as const },
    doctor2: { id: b.users.doctor2, username: 't.doctor2', facilityId: b.facilityId, departmentId: b.departments.ped, role: 'doctor' as const },
    doctorB: { id: world.users.doctorB, username: 't.doctorB', facilityId: world.otherFacilityId, departmentId: world.otherDepartmentId, role: 'doctor' as const },
    admin: { id: b.users.admin, username: 't.admin', facilityId: b.facilityId, departmentId: null, role: 'admin' as const },
    nurse: { id: b.users.nurse, username: 't.nurse', facilityId: b.facilityId, departmentId: b.departments.gen, role: 'nurse' as const },
  }[who]
  return { ...m, sessionId: 'test', fullName: `Dr. ${m.username}`, patientId: null, mustChangePassword: false }
}

function mk(who: Parameters<typeof me>[0] = 'doctor', scope: ManaCtx['scope'] = { encounterId: null, patientId: null }, o: { book?: EntityBook; local?: boolean } = {}): ManaCtx {
  return { db: ctx.db, me: me(who), settings, scope, book: o.book ?? new EntityBook(), today, timeZone: 'Asia/Kolkata', now: new Date(), modelIsLocal: o.local ?? true, disclosed: new Set(), textShown: new Set(), denials: [] }
}

const blank: PlannedCall = { tool: 'get_current_context', patient: null, topic: null, text: null, which: null, when: null, minutes: null, date: null, mine: null, status: null }
const plan = (c: Partial<PlannedCall> & Pick<PlannedCall, 'tool'>): PlannedCall => ({ ...blank, ...c })
const texts = (o: { facts: { text: string }[]; findings: { text: string }[] }) => [...o.facts.map((f) => f.text), ...o.findings.map((f) => f.text)].join('\n')

describe('what a tool returns', () => {
  it('reads one patient’s record by topic: the sentences, the records they rest on, and what the explicit rules found', async () => {
    const c = mk('doctor', { encounterId: null, patientId: world.p.meena.id })
    const r = await runTool(c, plan({ tool: 'get_patient_record', patient: 'current', topic: 'allergies' }))
    expect(r.status).toBe('ok')
    expect(r.patientId).toBe(world.p.meena.id)
    expect(texts(r)).toMatch(/Penicillin/)
    // The recorded allergy and the amoxicillin of the earlier prescription are the same group: a finding made by rules, not by a model.
    expect(r.findings.some((f) => f.kind === 'conflict' && /Amoxicillin/i.test(f.text))).toBe(true)
    const withSources = r.facts.find((f) => f.items.length)!
    expect(withSources.items[0]).toMatchObject({ kind: 'allergy' })
    expect(withSources.items[0]!.label).toMatch(/Allergy/)
  })

  it('names patients by a handle and never by a name, an MRN or a telephone number', async () => {
    const c = mk()
    const tools: PlannedCall[] = [
      plan({ tool: 'get_today_queue', status: 'any' }),
      plan({ tool: 'get_recent_visits', when: 'today' }),
      plan({ tool: 'get_my_consultations', when: 'today' }),
      plan({ tool: 'get_appointments', when: 'tomorrow' }),
      plan({ tool: 'get_patient_visits', patient: `mrn:${world.p.meena.mrn}` }),
      plan({ tool: 'get_patient_record', patient: `mrn:${world.p.rahulS.mrn}`, topic: 'briefing' }),
      plan({ tool: 'get_consultation', patient: `mrn:${world.p.meena.mrn}`, which: 'last' }),
      plan({ tool: 'find_patient', text: 'Anita Das' }),
    ]
    const seen: string[] = []
    for (const t of tools) {
      const r = await runTool(c, t)
      seen.push(texts(r), ...r.facts.flatMap((f) => f.items.map((i) => `${i.label} ${i.excerpt}`)))
      expect(['ok', 'empty'], `${t.tool}: ${r.detail}`).toContain(r.status)
    }
    const all = seen.join('\n')
    for (const p of Object.values(world.p)) {
      expect(all, p.name).not.toContain(p.name)
      expect(all, p.name).not.toContain(p.mrn)
      expect(all).not.toContain(p.name.split(' ')[0] + ' ' + p.name.split(' ')[1])
    }
    expect(all).not.toMatch(/\b94000\d{5}\b/)
    expect(all).toMatch(/\bP\d\b/)
  })

  it('keeps the older record, the patient’s own words and amendments apart from today’s visit, with dates in the clinic’s own words', async () => {
    const r = await runTool(mk(), plan({ tool: 'get_consultation', patient: `mrn:${world.p.meena.mrn}`, which: 'last' }))
    expect(r.status).toBe('ok')
    const t = texts(r)
    expect(t).toMatch(/Signed consultation of \d{1,2} \w{3,4} \d{4}/)
    expect(t).toMatch(/Acute pharyngitis/)
    expect(t).toMatch(/Amoxicillin/)
    // "the previous one" does not exist for a patient with one signed consultation.
    const previous = await runTool(mk(), plan({ tool: 'get_consultation', patient: `mrn:${world.p.meena.mrn}`, which: 'previous' }))
    expect(previous.status).toBe('not_found')
    expect(previous.findings[0]!.kind).toBe('absent')
  })

  it('says a patient has no visits, or no investigation results, as a statement about the record and not as a fact about the patient', async () => {
    const r = await runTool(mk(), plan({ tool: 'get_patient_visits', patient: `mrn:${world.p.zara.mrn}` }))
    // (Zara is a patient of the other clinic: for this doctor she does not exist.)
    expect(r.status).toBe('not_found')
    const none = await runTool(mk(), plan({ tool: 'get_patient_record', patient: `mrn:${world.p.anita.mrn}`, topic: 'investigations' }))
    expect(none.facts).toHaveLength(0)
    expect(none.findings[0]).toMatchObject({ kind: 'absent' })
    expect(none.findings[0]!.text).toMatch(/No investigation results are recorded/)
  })
})

describe('the clinic’s day', () => {
  it('counts today’s queue by status and lists the people still to be seen, as handles', async () => {
    const r = await runTool(mk(), plan({ tool: 'get_today_queue' }))
    expect(r.status).toBe('ok')
    expect(r.facts[0]!.text).toMatch(/1 waiting, 1 in triage, 1 ready for the doctor, 1 with a doctor, 2 completed/)
    const lines = r.facts.slice(1).map((f) => f.text)
    // Anita (waiting), Meena (in triage), Rahul Sharma (ready) and Vikram (with the doctor) are still open; the two completed visits are not listed.
    expect(lines).toHaveLength(4)
    expect(lines.join('\n')).toMatch(/waiting/)
    expect(lines.join('\n')).toMatch(/in triage/)
    expect(lines.join('\n')).toMatch(/with a doctor/)
    const done = await runTool(mk(), plan({ tool: 'get_today_queue', status: 'completed' }))
    expect(done.facts.slice(1)).toHaveLength(2)
  })

  it('finds the patient who checked in about two hours ago, and says which window it looked at', async () => {
    const c = mk()
    const r = await runTool(c, plan({ tool: 'get_recent_visits', when: 'minutes_ago', minutes: 120 }))
    expect(r.status).toBe('ok')
    expect(r.facts[0]!.text).toMatch(/Checked in between \d{1,2}:\d{2} [ap]m and \d{1,2}:\d{2} [ap]m/)
    const people = r.facts.slice(1)
    expect(people).toHaveLength(1)
    expect(people[0]!.text).toMatch(/Sore throat and fever returned/)
    expect(c.book.patientIdOf(people[0]!.patient!)).toBe(world.p.meena.id)
    // "In the last half hour" is a different question, with a different answer: the others checked in just now, she did not.
    const recent = await runTool(mk(), plan({ tool: 'get_recent_visits', when: 'last_minutes', minutes: 30 }))
    expect(recent.facts.slice(1).length).toBeGreaterThanOrEqual(3)
    expect(texts(recent)).not.toMatch(/Sore throat and fever returned/)
  })

  it('lists appointments in a window, and only the doctor’s own when asked', async () => {
    const all = await runTool(mk(), plan({ tool: 'get_appointments', when: 'tomorrow' }))
    expect(all.facts.slice(1)).toHaveLength(2)
    const mineOnly = await runTool(mk('doctor2'), plan({ tool: 'get_appointments', when: 'tomorrow', mine: true }))
    expect(mineOnly.status).toBe('empty')
    const mine = await runTool(mk('doctor'), plan({ tool: 'get_appointments', when: 'tomorrow', mine: true }))
    expect(mine.facts.slice(1)).toHaveLength(2)
    expect(texts(mine)).toMatch(/10:30 am/)
  })

  it('counts a doctor’s own consultations and nobody else’s', async () => {
    const one = await runTool(mk('doctor'), plan({ tool: 'get_my_consultations', when: 'today' }))
    expect(one.facts[0]!.text).toMatch(/1 signed that day, 1 open/)
    const two = await runTool(mk('doctor2'), plan({ tool: 'get_my_consultations', when: 'today' }))
    expect(two.facts[0]!.text).toMatch(/1 signed that day, 0 open/)
  })

  it('reports the clinic and its departments', async () => {
    const r = await runTool(mk(), plan({ tool: 'get_facility_information' }))
    expect(texts(r)).toMatch(/Test facility/)
    expect(texts(r)).toMatch(/General Medicine \(GEN\)/)
    expect(texts(r)).not.toMatch(/Other clinic/)
  })

  it('knows the open consultation and its patient, and says when none is open', async () => {
    const withOne = mk('doctor', { encounterId: world.openEncounterId, patientId: world.p.vikram.id })
    const r = await runTool(withOne, plan({ tool: 'get_current_context' }))
    expect(texts(r)).toMatch(/The open consultation is for P1/)
    expect(texts(r)).toMatch(/Cough and tiredness/)
    const without = await runTool(mk(), plan({ tool: 'get_current_context' }))
    expect(texts(without)).toMatch(/not about a particular patient/)
  })
})

describe('finding a patient never guesses', () => {
  it('a first name that fits two patients of the clinic is ambiguous, and the patient of another clinic with the same name is not among them', async () => {
    const c = mk()
    const r = await runTool(c, plan({ tool: 'find_patient', text: 'Rahul' }))
    expect(r.status).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
    const ids = r.candidates.map((a) => c.book.patientIdOf(a))
    expect(ids).toEqual(expect.arrayContaining([world.p.rahulS.id, world.p.rahulV.id]))
    expect(ids).not.toContain(world.p.rahulM.id)
    // The same through a record question: nothing is read, the doctor is asked to choose.
    const q = await runTool(mk(), plan({ tool: 'get_patient_record', patient: 'name:Rahul', topic: 'allergies' }))
    expect(q.status).toBe('ambiguous')
    expect(q.facts).toHaveLength(0)
  })

  it('a full name that fits one patient is that patient; an MRN is exact; a stranger is not found', async () => {
    const c = mk()
    const one = await runTool(c, plan({ tool: 'find_patient', text: 'Rahul Sharma' }))
    expect(one.status).toBe('ok')
    expect(one.patientId).toBe(world.p.rahulS.id)
    const byMrn = await runTool(mk(), plan({ tool: 'get_patient_visits', patient: `mrn:${world.p.rahulV.mrn}` }))
    expect(byMrn.status).toBe('ok')
    expect((await runTool(mk(), plan({ tool: 'find_patient', text: 'Nobody Atall' }))).status).toBe('not_found')
  })

  it('a handle that the conversation never showed is not a patient', async () => {
    const c = mk()
    expect((await runTool(c, plan({ tool: 'get_patient_record', patient: 'P7', topic: 'allergies' }))).status).toBe('not_found')
    expect((await runTool(c, plan({ tool: 'get_patient_record', patient: world.p.meena.id, topic: 'allergies' }))).status).toBe('not_found')
    expect((await runTool(c, plan({ tool: 'get_patient_record', patient: 'current', topic: 'allergies' }))).status).toBe('not_found')
  })
})

describe('what a tool will not do', () => {
  it('another clinic’s patients, and everything about them, are out of reach: by name, by MRN, by handle or by identifier', async () => {
    const c = mk()
    for (const handle of ['name:Rahul Mehta', 'name:Mehta', `mrn:${world.p.rahulM.mrn}`, 'name:Zara Khan', `mrn:${world.p.zara.mrn}`]) {
      const r = await runTool(c, plan({ tool: 'get_patient_record', patient: handle, topic: 'briefing' }))
      expect(r.status, handle).toBe('not_found')
      expect(r.facts, handle).toHaveLength(0)
    }
    // Even a scope that points at the other clinic's patient (a forged conversation) reads nothing.
    const forged = mk('doctor', { encounterId: null, patientId: world.p.rahulM.id })
    expect((await runTool(forged, plan({ tool: 'get_patient_record', patient: 'current', topic: 'briefing' }))).status).toBe('not_found')
    // The queue and the schedule are this clinic's: the other clinic's visit of today is not in it.
    const queue = await runTool(mk(), plan({ tool: 'get_today_queue', status: 'any' }))
    expect(texts(queue)).not.toMatch(/Wheeze/)
    // And from the other clinic the first clinic's patients do not exist.
    const b = mk('doctorB')
    expect((await runTool(b, plan({ tool: 'find_patient', text: 'Meena' }))).status).toBe('not_found')
    const bq = await runTool(b, plan({ tool: 'get_today_queue', status: 'any' }))
    expect(texts(bq)).toMatch(/Wheeze/)
    expect(texts(bq)).not.toMatch(/Sore throat/)
  })

  it('a role without the permission reads nothing, before anything is looked up', async () => {
    const admin = mk('admin')
    for (const t of [plan({ tool: 'find_patient', text: 'Meena' }), plan({ tool: 'get_patient_record', patient: `mrn:${world.p.meena.mrn}`, topic: 'allergies' }), plan({ tool: 'get_today_queue' }), plan({ tool: 'get_my_consultations' })]) {
      const r = await runTool(admin, t)
      expect(r.status, t.tool).toBe('refused')
      expect(r.facts).toHaveLength(0)
    }
    expect((await runTool(admin, plan({ tool: 'get_facility_information' }))).status).toBe('ok')
  })

  it('refuses a role that lacks the permission BEFORE it touches the database at all: the check comes first, not after a read', async () => {
    // A database that throws on any use: if a tool looked anything up before checking the role, the call would not come back as a plain refusal.
    const untouched = new Proxy({}, { get: () => { throw new Error('the database was touched') } }) as never
    const admin: ManaCtx = { ...mk('admin'), db: untouched }
    for (const t of [plan({ tool: 'find_patient', text: 'Meena' }), plan({ tool: 'get_patient_record', patient: 'name:Meena', topic: 'allergies' }), plan({ tool: 'get_patient_visits', patient: 'name:Meena' }), plan({ tool: 'get_consultation', patient: 'name:Meena', which: 'last' }), plan({ tool: 'get_today_queue' }), plan({ tool: 'get_recent_visits', when: 'today' }), plan({ tool: 'get_appointments', when: 'today' }), plan({ tool: 'get_my_consultations' })]) {
      const r = await runTool(admin, t)
      expect(r, t.tool).toMatchObject({ status: 'refused', detail: 'Your role is not allowed to read that.', facts: [], findings: [] })
    }
    // (A nurse holds the platform's own read permissions for patients, the queue and consultations, so the tools would not refuse a nurse: it is the route,
    // which is for doctors only, that keeps a nurse out of Mana: see "is for doctors" in mana-assistant.test.ts.)
  })

  it('a malformed call is refused with a reason and reads nothing', async () => {
    const c = mk()
    expect((await runTool(c, plan({ tool: 'get_consultation', patient: `mrn:${world.p.meena.mrn}`, which: 'date' }))).status).toBe('invalid')
    expect((await runTool(c, plan({ tool: 'get_recent_visits', when: 'last_minutes' }))).status).toBe('invalid')
    expect((await runTool(c, plan({ tool: 'get_recent_visits', when: 'next_minutes', minutes: 30 }))).status).toBe('invalid')
    expect((await runTool(c, plan({ tool: 'get_appointments', when: 'date' }))).status).toBe('invalid')
    expect((await runTool(c, plan({ tool: 'find_patient' }))).status).toBe('invalid')
    expect((await runTool(c, plan({ tool: 'get_patient_record', patient: 'everyone', topic: 'briefing' }))).status).toBe('not_found')
    expect((await runTool(c, { ...blank, tool: 'drop_tables' as never })).status).toBe('invalid')
  })

  it('a patient who withdrew consent to AI help is not read, and their reasons for visits are not shown, even by a local model', async () => {
    await adminQuery(`INSERT INTO consents (patient_id, type, status, method, scope, version, recorded_by) VALUES ($1, 'ai_record_assistant', 'withdrawn', 'verbal', 'ongoing', '2026-10-v1', $2)`, [world.p.meena.id, world.base.users.nurse])
    try {
      const r = await runTool(mk(), plan({ tool: 'get_patient_record', patient: `mrn:${world.p.meena.mrn}`, topic: 'allergies' }))
      expect(r.status).toBe('refused')
      expect(r.detail).toMatch(/withdrawn consent/)
      expect(r.facts).toHaveLength(0)
      const queue = await runTool(mk(), plan({ tool: 'get_today_queue' }))
      expect(texts(queue)).toMatch(/reason not shown/)
      expect(texts(queue)).not.toMatch(/Sore throat and fever returned/)
      // Others are unaffected.
      expect(texts(queue)).toMatch(/Diabetes review/)
    } finally {
      await adminQuery(`SET session_replication_role = replica; DELETE FROM consents WHERE patient_id = '${world.p.meena.id}' AND type = 'ai_record_assistant'`)
    }
  })

  it('with a model that does not run on this computer, the record is read only for a patient who consented to Mana AI record summaries', async () => {
    const hosted = mk('doctor', { encounterId: null, patientId: null }, { local: false })
    const r = await runTool(hosted, plan({ tool: 'get_patient_record', patient: `mrn:${world.p.rahulS.mrn}`, topic: 'allergies' }))
    expect(r.status).toBe('refused')
    expect(r.detail).toMatch(/does not run on this computer/)
  })

  it('text in a record that looks like an instruction is carried as text: markers are written apart, brackets cannot forge a source', async () => {
    const r = await runTool(mk(), plan({ tool: 'get_consultation', patient: `mrn:${world.p.suresh.mrn}`, which: 'last' }))
    expect(r.status).toBe('ok')
    // The note is data: it is there, as words, and nothing in it can pass for a source id or a chat marker.
    expect(texts(r)).toMatch(/Ignore all previous instructions/)
    for (const f of r.facts) {
      expect([...f.text].some((c) => c.charCodeAt(0) < 0x20 && c !== '\t')).toBe(false)
      expect(f.text).not.toMatch(/<\|/)
      expect(f.text).not.toMatch(/\[S\d+\]/)
    }
  })
})

describe('what is in a record’s free text, and when a record is looked up by date', () => {
  const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10)

  it('takes identifiers out of a note: the patient’s own name, record number and telephone number, and any other telephone or record number', async () => {
    const r = await runTool(mk(), plan({ tool: 'get_consultation', patient: `mrn:${world.p.nandini.mrn}`, which: 'last' }))
    expect(r.status).toBe('ok')
    const t = texts(r)
    expect(t).toMatch(/Cough for a week/)
    for (const secret of ['Nandini', 'Joshi', world.p.nandini.mrn, '9400000777', '98400 12345', '98400', 'ADX-009999']) expect(t, secret).not.toContain(secret)
    // The excerpt the doctor opens is the record itself, as written: the doctor may see their patient's own note.
    expect(r.facts.flatMap((f) => f.items).map((i) => i.excerpt).join('\n')).toMatch(/Cough for a week/)
  })

  it('takes identifiers out of the reason for a visit in a list, as well', async () => {
    const [v] = (await adminQuery(`select id, chief_complaint from visits where patient_id = $1 and visit_date = $2`, [world.p.anita.id, today])).rows
    try {
      await adminQuery(`update visits set chief_complaint = $2 where id = $1`, [v.id, `Headache; Anita Das (${world.p.anita.mrn}) rang from 9400000888 or 94000 00001; quote ADX-007777`])
      const queue = await runTool(mk(), plan({ tool: 'get_today_queue' }))
      const t = texts(queue)
      expect(t).toMatch(/Headache/)
      for (const secret of ['Anita', 'Das', world.p.anita.mrn, '9400000888', '94000 00001', 'ADX-007777']) expect(t, secret).not.toContain(secret)
      const recent = await runTool(mk(), plan({ tool: 'get_recent_visits', when: 'today' }))
      expect(texts(recent)).not.toMatch(/9400000888|ADX-007777/)
    } finally {
      await adminQuery(`update visits set chief_complaint = $2 where id = $1`, [v.id, v.chief_complaint])
    }
  })

  it('finds a signed consultation by its date in the clinic’s own days, and says how far it looked when there is none', async () => {
    const day = addDays(today, -14)
    const found = await runTool(mk(), plan({ tool: 'get_consultation', patient: `mrn:${world.p.rahulS.mrn}`, which: 'date', date: day }))
    expect(found.status).toBe('ok')
    expect(texts(found)).toMatch(/Diabetes|diabetes/)
    const other = await runTool(mk(), plan({ tool: 'get_consultation', patient: `mrn:${world.p.rahulS.mrn}`, which: 'date', date: addDays(today, -13) }))
    expect(other.status).toBe('not_found')
    expect(other.findings[0]!.text).toMatch(/^No signed consultation of this patient is recorded on /)
    // Nothing was left out of the search for a patient with so few consultations, so the answer does not say that anything was.
    expect(other.findings[0]!.text).not.toMatch(/most recent/)
  })

  it('counts a doctor’s consultations of a day in the database, not in the rows it lists: 25 signed are 25, and the listing says it is cut', async () => {
    const day = addDays(today, -3)
    const f = world.base.facilityId
    const ids = `'${f}', '${world.p.priya.id}', '${world.base.departments.gen}', '${world.base.users.doctor}'`
    await adminQuery(`
      SET session_replication_role = replica;
      WITH v AS (
        INSERT INTO visits (facility_id, patient_id, department_id, assigned_doctor_id, visit_date, token_number, status, checked_in_at, status_changed_at)
        SELECT ${ids}, '${day}'::date, g, 'completed', now() - interval '3 days', now() - interval '3 days' FROM generate_series(1, 25) g RETURNING id)
      INSERT INTO encounters (facility_id, patient_id, visit_id, doctor_id, status, started_at, signed_at, signed_snapshot, content_hash)
      SELECT '${f}', '${world.p.priya.id}', v.id, '${world.base.users.doctor}', 'signed', (('${day}'::date + time '10:00') at time zone 'Asia/Kolkata'), (('${day}'::date + time '10:30') at time zone 'Asia/Kolkata'), '{}'::jsonb, 'x' FROM v`)
    try {
      const r = await runTool(mk(), plan({ tool: 'get_my_consultations', when: 'date', date: day }))
      expect(r.facts[0]!.text).toMatch(/: 25 signed that day, 0 open \(started that day, not signed\), 0 discarded\./)
      expect(r.facts.slice(1)).toHaveLength(20)
      expect(r.findings[0]!.text).toMatch(/Only the first 20 consultations are listed; the counts above are of all of them\./)
    } finally {
      await adminQuery(`SET session_replication_role = replica; DELETE FROM encounters WHERE visit_id IN (SELECT id FROM visits WHERE facility_id = '${f}' AND visit_date = '${day}'::date); DELETE FROM visits WHERE facility_id = '${f}' AND visit_date = '${day}'::date`)
    }
  })

  it('says what its summary of visits says: the newest visit with its state, and whether any was completed', async () => {
    const r = await runTool(mk(), plan({ tool: 'get_patient_visits', patient: `mrn:${world.p.anita.mrn}` }))
    expect(r.facts[0]!.text).toMatch(/^The most recent visit on record was on .* \(waiting\); no completed visit is recorded among the visits read\.$/)
    const meena = await runTool(mk(), plan({ tool: 'get_patient_visits', patient: `mrn:${world.p.meena.mrn}` }))
    expect(meena.facts[0]!.text).toMatch(/the last completed visit was on /)
  })
})

describe('naming a patient', () => {
  it('needs every word the doctor wrote as a whole word of the name: a start of a name, or a longer name, is not that patient', async () => {
    const c = mk()
    for (const handle of ['name:Ani', 'name:Anit', 'name:Meena Kum', 'name:Das An']) expect((await runTool(c, plan({ tool: 'get_patient_record', patient: handle, topic: 'briefing' }))).status, handle).toBe('not_found')
    expect((await runTool(mk(), plan({ tool: 'get_patient_record', patient: 'name:Anita', topic: 'allergies' }))).status).toBe('ok')
    expect((await runTool(mk(), plan({ tool: 'get_patient_record', patient: 'name:Meena Kumar', topic: 'allergies' }))).status).toBe('ok')
  })

  it('a conversation can show sixty different patients; the sixty-first is refused in words, and nothing else is shown from that call', async () => {
    const book = new EntityBook(Array.from({ length: 60 }, (_, i) => ({ alias: `P${i + 1}`, patientId: crypto.randomUUID() })))
    const c = mk('doctor', { encounterId: null, patientId: null }, { book })
    const r = await runTool(c, plan({ tool: 'get_today_queue' }))
    expect(r.status).toBe('refused')
    expect(r.detail).toMatch(/at most 60 different patients/)
  })
})

describe('with a model that does not run on this computer', () => {
  it('shows no reason for a visit, in any list, of a patient who has not consented to Mana AI record summaries', async () => {
    const hosted = () => mk('doctor', { encounterId: null, patientId: null }, { local: false })
    const queue = await runTool(hosted(), plan({ tool: 'get_today_queue' }))
    expect(texts(queue)).toMatch(/reason not shown/)
    expect(texts(queue)).not.toMatch(/Headache for two days|Diabetes review|Sore throat and fever returned|Cough and tiredness/)
    const recent = await runTool(hosted(), plan({ tool: 'get_recent_visits', when: 'today' }))
    expect(texts(recent)).not.toMatch(/Headache for two days|Diabetes review|Sore throat and fever returned|Cough and tiredness/)
    const appts = await runTool(hosted(), plan({ tool: 'get_appointments', when: 'tomorrow' }))
    expect(texts(appts)).toMatch(/reason not shown/)
    expect(texts(appts)).not.toMatch(/Blood pressure follow-up|Review of headache/)
    const visits = await runTool(hosted(), plan({ tool: 'get_patient_visits', patient: `mrn:${world.p.anita.mrn}` }))
    expect(visits.status).toBe('refused')
    // The consultation open now: its reason is not shown either.
    const context = await runTool(mk('doctor', { encounterId: world.openEncounterId, patientId: world.p.vikram.id }, { local: false }), plan({ tool: 'get_current_context' }))
    expect(texts(context)).not.toMatch(/Cough and tiredness/)
  })
})
void WHO
