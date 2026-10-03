// SYNTHETIC hospital dataset v1 for the Doctor App (docs/DOCTOR_APP_PLAN.md, slice V1). Everything here is fictional.
//   npm run demo:hospital      after `npm run db:seed` (and `npm run db:migrate`)
//
// What it creates, through the real API in-process (sign-in, registration, consent, history entries, drafts, signing,
// appointments, check-in), so the data is made exactly as a user would make it:
//   - two more staff accounts (an orthopaedics doctor and a paediatrics nurse), same demo password as the others;
//   - twelve patients with allergies, conditions, medicines, investigation results and earlier signed consultations;
//   - today's schedule and queue in every state (booked, did not attend, waiting, in triage, ready, with the doctor, completed).
// Earlier consultations are given historical dates: the clock the API reads is held at that date for the one signing request, and
// the visit's own date is set directly in the database first. The audit log still shows the day the seed ran, which is true.
// Safe to repeat and to resume: a patient is recognised by name and date of birth, and every step of a patient's history is
// done only if it is not already there (an entry whose second step, a status change, did not happen is finished), so a run that
// failed half way is completed by the next one. One case needs a person: a run that failed inside an earlier consultation, between
// its visit and its signature, leaves an unsigned draft that the next run does not clean up (discard the draft and cancel the
// visit in the app first). Today's activity is added once per day.
// It refuses to run in production, outside a synthetic deployment, outside the synthetic facility, or if any patient is clinical.
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { and, eq, sql } from 'drizzle-orm'
import type { InjectOptions } from 'fastify'
import { buildApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import { type Config, loadConfig, loadDotEnv } from '../config.ts'
import { createDb } from './client.ts'
import { DOCTOR_FOR, HOSPITAL_STAFF, type PastConsultation, PATIENTS, type PatientSpec, type TodaySpec } from './hospital-seed-data.ts'
import { createAdminClient, createAppPool } from './pool.ts'
import { departments, facilities, patients, users } from './schema.ts'

const addDays = (date: string, n: number) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)).toISOString().slice(0, 10)

/** Holds the clock the API reads at one moment while `fn` runs (its requests only), then puts it back. */
async function withClockAt<T>(at: Date, fn: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date
  const fixed = at.getTime()
  const Fixed = new Proxy(RealDate, {
    construct: (target, args) => (args.length ? Reflect.construct(target, args) : new target(fixed)),
    get: (target, prop, receiver) => (prop === 'now' ? () => fixed : Reflect.get(target, prop, receiver)),
  })
  globalThis.Date = Fixed
  try {
    return await fn()
  } finally {
    globalThis.Date = RealDate
  }
}

export interface SeedResult {
  created: number
  /** Patients that already existed and had steps of their history completed. */
  completed: number
  activity: number
  newStaff: number
}

export async function seedHospital(opts: { config?: Config; password?: string; patients?: PatientSpec[]; log?: (m: string) => void } = {}): Promise<SeedResult> {
  const log = opts.log ?? ((m: string) => console.log(`[hospital-seed] ${m}`))
  if (!opts.config) loadDotEnv()
  const config = opts.config ?? loadConfig()
  const password = opts.password ?? process.env.SEED_DEMO_PASSWORD
  const specs = opts.patients ?? PATIENTS
  if (!password) throw new Error('SEED_DEMO_PASSWORD is not set (run `npm run setup`).')
  if (config.env === 'production') throw new Error('Refusing: this is a production deployment. The synthetic hospital dataset is never seeded into one.')
  if (config.dataOrigin !== 'synthetic') throw new Error('Refusing: DATA_ORIGIN is not "synthetic". This dataset is fictional and is only seeded into a synthetic deployment.')

  const pool = createAppPool(config.db)
  const app = buildApp({ config, pool, logger: false })
  const db = createDb(pool)
  const admin = createAdminClient(config.db)
  await admin.connect()
  try {
    // --- where it is allowed to write ----------------------------------------------------------------------------------
    const facility = await db.query.facilities.findFirst({ where: eq(facilities.code, 'DEMO-OPD-01') })
    if (!facility) throw new Error('The synthetic facility is missing. Run `npm run db:seed` first.')
    if (!facility.name.endsWith('(synthetic)')) throw new Error('Refusing: the facility is not marked synthetic.')
    const [clinical] = await db.select({ n: sql<number>`count(*)::int` }).from(patients).where(eq(patients.dataOrigin, 'clinical'))
    if (clinical!.n > 0) throw new Error('Refusing: this database holds patients marked as clinical. The synthetic dataset is not seeded beside real records.')

    // --- staff -------------------------------------------------------------------------------------------------
    const passwordHash = await hashPassword(password)
    let newStaff = 0
    for (const u of HOSPITAL_STAFF) {
      const dept = await db.query.departments.findFirst({ where: and(eq(departments.facilityId, facility.id), eq(departments.code, u.department)) })
      const r = await db
        .insert(users)
        .values({ facilityId: facility.id, username: u.username, fullName: u.fullName, role: u.role, departmentId: dept?.id ?? null, registrationNumber: u.registrationNumber, passwordHash })
        .onConflictDoNothing({ target: users.username })
        .returning({ id: users.id })
      newStaff += r.length
    }
    const userIdOf = async (username: string) => (await db.query.users.findFirst({ where: eq(users.username, username) }))!.id

    // Every account the seed acts as is in the synthetic facility (the guard above is about that facility, so the writes must land in it).
    for (const username of ['nurse.anil', ...Object.values(DOCTOR_FOR)]) {
      const u = await db.query.users.findFirst({ where: eq(users.username, username) })
      if (!u || u.facilityId !== facility.id) throw new Error(`Refusing: ${username} is not an account of the synthetic facility.`)
    }

    // --- sessions --------------------------------------------------------------------------------------------------
    async function session(username: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-adaxai-csrf': '1' }, payload: { username, password } })
      if (res.statusCode !== 200) throw new Error(`sign-in as ${username} failed (${res.statusCode}). Run npm run db:seed first.`)
      const cookie = res.cookies.find((c) => c.name === 'adaxai_session')!
      return async (method: InjectOptions['method'], url: string, payload?: unknown) => {
        const r = await app.inject({ method, url, headers: { cookie: `adaxai_session=${cookie.value}`, 'x-adaxai-csrf': '1' }, ...(payload !== undefined && { payload: payload as InjectOptions['payload'] }) })
        if (r.statusCode >= 400) throw new Error(`${method} ${url}: ${r.statusCode} ${r.body.slice(0, 300)}`)
        return r.json()
      }
    }
    const nurse = await session('nurse.anil')
    const doctors = { GEN: await session(DOCTOR_FOR.GEN), PED: await session(DOCTOR_FOR.PED), ORTH: await session(DOCTOR_FOR.ORTH) }
    const deptList = (await nurse('GET', '/api/departments')).departments as { id: string; code: string }[]
    const deptId = (code: string) => deptList.find((d) => d.code === code)!.id
    const options = (await nurse('GET', '/api/appointments/options')) as { today: string; timezone: string }
    const today = options.today
    const tomorrow = addDays(today, 1)

    /** Changes made directly in the database for dates and times, in one transaction with the trigger-skipping setting scoped to it. */
    async function adminTx(run: () => Promise<void>) {
      await admin.query('BEGIN')
      try {
        await admin.query('SET LOCAL session_replication_role = replica')
        await run()
        await admin.query('COMMIT')
      } catch (e) {
        await admin.query('ROLLBACK').catch(() => undefined)
        throw e
      }
    }

    const noteOf = (complaint: string, c: { history?: string; pastHistory?: string; examination?: string; assessment?: string; plan?: string; followUp?: string }) => ({
      chiefComplaint: complaint,
      history: c.history ?? '',
      pastHistory: c.pastHistory ?? '',
      examination: c.examination ?? '',
      assessment: c.assessment ?? '',
      plan: c.plan ?? '',
      followUp: c.followUp ?? '',
    })
    const rx = (items: PastConsultation['prescription']) => items.map((i) => ({ drugName: i.drugName, strength: i.strength, form: i.form, dose: i.dose, route: i.route ?? 'Oral', frequency: i.frequency, duration: i.duration, instructions: i.instructions ?? '' }))
    const dx = (items: PastConsultation['diagnoses']) => items.map((d, i) => ({ description: d.description, code: d.code, kind: d.kind ?? (i === 0 ? 'primary' : 'secondary') }))

    /** An earlier, signed consultation with a historical date. */
    async function pastConsultation(patientId: string, spec: PatientSpec, c: PastConsultation) {
      const doctor = doctors[spec.department]
      const date = addDays(today, -c.daysAgo)
      const at = new Date(Date.now() - c.daysAgo * 86_400_000)
      const v = await nurse('POST', '/api/visits', { patientId, departmentId: deptId(spec.department), chiefComplaint: c.complaint })
      await nurse('POST', `/api/visits/${v.id}/observations`, { items: c.vitals, measuredAt: new Date(at.getTime() - 20 * 60_000).toISOString() })
      await nurse('POST', `/api/visits/${v.id}/status`, { status: 'ready' })
      const e = await doctor('POST', `/api/visits/${v.id}/encounter`)
      // Give the visit its historical date (and the next free token that day) before it is signed, so the signed record carries it.
      await adminTx(async () => {
        await admin.query(
          `UPDATE visits SET visit_date = $2::date, token_number = (SELECT coalesce(max(v2.token_number), 0) + 1 FROM visits v2 WHERE v2.facility_id = visits.facility_id AND v2.visit_date = $2::date) WHERE id = $1`,
          [v.id, date],
        )
        await admin.query('UPDATE encounters SET started_at = $2 WHERE id = $1', [e.id, new Date(at.getTime() - 15 * 60_000).toISOString()])
      })
      const saved = await doctor('PUT', `/api/encounters/${e.id}/draft`, { version: e.version, note: noteOf(c.complaint, c), diagnoses: dx(c.diagnoses), prescription: rx(c.prescription) })
      await withClockAt(at, () => doctor('POST', `/api/encounters/${e.id}/sign`, { version: saved.version, attestation: true }))
    }

    /** Moves today's visit through the queue to `state`; for in_consultation and completed the doctor's work too. */
    async function advance(visitId: string, spec: PatientSpec, t: TodaySpec) {
      const doctor = doctors[spec.department]
      if (t.state === 'waiting') return
      if (t.vitals?.length) await nurse('POST', `/api/visits/${visitId}/observations`, { items: t.vitals })
      if (t.state === 'in_triage') return
      await nurse('POST', `/api/visits/${visitId}/status`, { status: 'ready' })
      if (t.state === 'ready') return
      const e = await doctor('POST', `/api/visits/${visitId}/encounter`)
      const saved = await doctor('PUT', `/api/encounters/${e.id}/draft`, {
        version: e.version,
        note: noteOf(t.complaint, t.note ?? {}),
        diagnoses: dx(t.state === 'completed' ? (t.diagnoses ?? []) : []),
        prescription: rx(t.state === 'completed' ? (t.prescription ?? []) : []),
      })
      if (t.state === 'completed') await doctor('POST', `/api/encounters/${e.id}/sign`, { version: saved.version, attestation: true })
    }

    // The clinic's time of day now, in minutes; appointment times are offsets from it (so the schedule is plausible at any hour).
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: options.timezone }).formatToParts(new Date())
    const nowMin = Number(parts.find((x) => x.type === 'hour')!.value) * 60 + Number(parts.find((x) => x.type === 'minute')!.value)
    const takenByDoctor = new Map<string, Set<number>>()
    const slotFor = (department: string, offset: number) => {
      const taken = takenByDoctor.get(department) ?? new Set<number>()
      takenByDoctor.set(department, taken)
      let m = Math.min(23 * 60 + 55, Math.max(5, Math.floor((nowMin + offset) / 5) * 5))
      while (taken.has(m) && m > 20) m -= 15
      taken.add(m)
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    }

    /** Today's appointment (booked for tomorrow, then moved to today's clock time) and/or today's visit. */
    async function todaysActivity(patientId: string, spec: PatientSpec) {
      const t = spec.today
      if (!t) return false
      const visitsToday = ((await nurse('GET', `/api/patients/${patientId}/visits`)).visits as { visitDate: string }[]).some((v) => v.visitDate === today)
      const apptsToday = ((await nurse('GET', `/api/patients/${patientId}/appointments`)).items as { localDate: string }[]).some((a) => a.localDate === today)
      if (visitsToday || apptsToday) return false
      if (t.atOffsetMin === undefined) {
        const v = await nurse('POST', '/api/visits', { patientId, departmentId: deptId(spec.department), chiefComplaint: t.complaint })
        await advance(v.id, spec, t)
        return true
      }
      const doctorId = await userIdOf(DOCTOR_FOR[spec.department])
      const time = slotFor(spec.department, t.atOffsetMin)
      const appt = await nurse('POST', '/api/appointments', { patientId, departmentId: deptId(spec.department), doctorId, date: tomorrow, time, durationMinutes: 15, reason: t.complaint, idempotencyKey: crypto.randomUUID() })
      try {
        await adminTx(async () => {
          await admin.query(
            `UPDATE appointments a SET scheduled_at = (((now() at time zone f.timezone)::date + $2::time)::timestamp at time zone f.timezone) FROM facilities f WHERE f.id = a.facility_id AND a.id = $1`,
            [appt.id, time],
          )
        })
      } catch (e) {
        // Do not leave a stray booking for tomorrow behind.
        await nurse('POST', `/api/appointments/${appt.id}/cancel`, { version: appt.version, reason: 'Seed step failed (synthetic)' }).catch(() => undefined)
        throw e
      }
      if (t.state === 'booked') return true
      if (t.state === 'no_show') {
        await nurse('POST', `/api/appointments/${appt.id}/no-show`, { version: appt.version, reason: 'Did not come (synthetic)' })
        return true
      }
      const checked = await nurse('POST', `/api/appointments/${appt.id}/check-in`, {})
      await advance(checked.visit.id, spec, t)
      return true
    }

    /** Everything about the patient's past that is not there yet; returns how many steps it did. */
    async function ensureHistory(patientId: string, spec: PatientSpec): Promise<number> {
      const doctor = doctors[spec.department]
      let done = 0
      const detail = await nurse('GET', `/api/patients/${patientId}`)
      const have = {
        consents: new Set((detail.consents as { type: string; status: string }[]).filter((c) => c.status === 'granted').map((c) => c.type)),
        allergies: new Set((detail.allergies as { substance: string; status: string }[]).filter((a) => a.status === 'active').map((a) => a.substance.toLowerCase())),
      }
      for (const type of spec.consents) {
        if (have.consents.has(type)) continue
        await nurse('POST', `/api/patients/${patientId}/consents`, { type, method: 'verbal', notes: 'Synthetic consent' })
        done++
      }
      for (const a of spec.allergies) {
        if (have.allergies.has(a.substance.toLowerCase())) continue
        await nurse('POST', `/api/patients/${patientId}/allergies`, a)
        done++
      }
      if (spec.noKnownAllergies && !detail.noKnownAllergies) {
        await nurse('PUT', `/api/patients/${patientId}/no-known-allergies`, { noKnownAllergies: true })
        done++
      }
      const h = await nurse('GET', `/api/patients/${patientId}/history`)
      const names = new Map((h.conditions as { id: string; name: string; status: string }[]).map((c) => [c.name.toLowerCase(), c]))
      for (const c of spec.conditions) {
        const there = names.get(c.name.toLowerCase())
        if (there) {
          // Created by a run that stopped before the second step (its status change): finish it.
          if (c.status && c.status !== 'active' && there.status === 'active') {
            await doctor('POST', `/api/patients/${patientId}/conditions/${there.id}/status`, { status: c.status })
            done++
          }
          continue
        }
        const row = await doctor('POST', `/api/patients/${patientId}/conditions`, { name: c.name, code: c.code, sinceYear: c.sinceYear, sinceMonth: c.sinceMonth ?? null, status: 'active', note: c.note })
        if (c.status && c.status !== 'active') await doctor('POST', `/api/patients/${patientId}/conditions/${row.id}/status`, { status: c.status })
        done++
      }
      const meds = new Map((h.medications as { id: string; drugName: string; strength: string | null; status: string }[]).map((m) => [`${m.drugName}|${m.strength ?? ''}`.toLowerCase(), m]))
      for (const m of spec.medications) {
        const there = meds.get(`${m.drugName}|${m.strength ?? ''}`.toLowerCase())
        if (there) {
          // Created by a run that stopped before it was stopped: finish it.
          if (m.stopped && there.status === 'current') {
            await doctor('POST', `/api/patients/${patientId}/medications/${there.id}/status`, { status: 'stopped', stoppedOn: m.stopped.on, reason: m.stopped.reason })
            done++
          }
          continue
        }
        const row = await doctor('POST', `/api/patients/${patientId}/medications`, { drugName: m.drugName, strength: m.strength, form: m.form, dose: m.dose, route: m.route, frequency: m.frequency, startedOn: m.startedOn ?? null, reason: m.reason })
        if (m.stopped) await doctor('POST', `/api/patients/${patientId}/medications/${row.id}/status`, { status: 'stopped', stoppedOn: m.stopped.on, reason: m.stopped.reason })
        done++
      }
      const results = new Set((h.investigations as { testName: string; collectedOn: string; valueText: string }[]).map((r) => `${r.testName}|${r.collectedOn}|${r.valueText}`.toLowerCase()))
      for (const r of spec.results) {
        const collectedOn = addDays(today, -r.daysAgo)
        if (results.has(`${r.testName}|${collectedOn}|${r.valueText}`.toLowerCase())) continue
        await doctor('POST', `/api/patients/${patientId}/investigations`, {
          testName: r.testName,
          valueText: r.valueText,
          valueNumber: r.valueNumber ?? null,
          unit: r.unit ?? null,
          refLow: r.refLow ?? null,
          refHigh: r.refHigh ?? null,
          refText: r.refText ?? null,
          interpretation: r.interpretation ?? null,
          collectedOn,
          resultedOn: collectedOn,
          note: r.note,
        })
        done++
      }
      // Earlier consultations are made oldest first, so what is missing after a failed run is the newest ones.
      const existing = (h.consultations as unknown[]).length + (h.more.consultations as number)
      for (const c of [...spec.past].sort((a, b) => b.daysAgo - a.daysAgo).slice(existing)) {
        await pastConsultation(patientId, spec, c)
        done++
      }
      return done
    }

    let created = 0
    let completed = 0
    let activity = 0
    for (const spec of specs) {
      const found = (await nurse('GET', `/api/patients?q=${encodeURIComponent(spec.familyName)}&limit=50`)).patients as { id: string; fullName: string; dateOfBirth: string }[]
      let patientId = found.find((p) => p.fullName === `${spec.givenName} ${spec.familyName}` && p.dateOfBirth === spec.dateOfBirth)?.id
      const isNew = !patientId
      if (!patientId) {
        const p = await nurse('POST', '/api/patients', {
          givenName: spec.givenName,
          familyName: spec.familyName,
          dateOfBirth: spec.dateOfBirth,
          sex: spec.sex,
          phone: spec.phone,
          city: spec.city,
          bloodGroup: spec.bloodGroup,
          preferredLanguage: spec.language,
          confirmNotDuplicate: true,
        })
        patientId = p.id as string
      }
      const steps = await ensureHistory(patientId, spec)
      if (isNew) created++
      else if (steps > 0) completed++
      if (await todaysActivity(patientId, spec)) activity++
    }

    log(`${created} patient(s) created, ${completed} completed, today's activity added for ${activity}; ${newStaff} staff account(s) added.`)
    log(`Staff: ${HOSPITAL_STAFF.map((s) => s.username).join(', ')} (and dr.meera, dr.rahul, nurse.anil, admin) use the demo password from .env.`)
    return { created, completed, activity, newStaff }
  } finally {
    await admin.end()
    await app.close()
    await pool.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await seedHospital()
  } catch (e) {
    console.error(`[hospital-seed] ERROR ${(e as Error).message}`)
    process.exitCode = 1
  }
}
