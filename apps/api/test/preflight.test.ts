import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Encounter, PatientDetail, Visit } from '@adaxai/contracts'
import type pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdminClient } from '../src/db/pool.ts'
import { migrate } from '../src/db/migrator.ts'
import { duplicateLiveRecordings, endDuplicateLiveRecordings, PREFLIGHTS } from '../src/db/preflight.ts'
import { assertTestDatabase, call, createFixture, createTestApp, login, resetDatabase, samplePatient, testConfig } from './helpers.ts'

// Migration 0025 builds a unique index (one live recording per consultation). A database that an older version of the application left with several
// "live" recordings of one consultation cannot take it. The applied migration is never edited: the condition is checked before the migration runs, in
// words, and the remedy is a named, explicit, counted step. These tests run the real queries on the test database inside a transaction that is
// rolled back, so nothing is changed there.

const ctx = createTestApp()
afterAll(() => ctx.close())
let encounterId: string
let doctorId: string

beforeEach(async () => {
  await resetDatabase()
  const fx = await createFixture(ctx.db)
  const nurse = await login(ctx.app, 't.nurse')
  const doctor = await login(ctx.app, 't.doctor')
  const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: 'Preflight', phone: '9400000001' }) })).json())
  const v = Visit.parse((await call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId: p.id, departmentId: fx.departments.gen, chiefComplaint: 'Fever' } })).json())
  const e = Encounter.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/encounter`, { cookie: doctor })).json())
  encounterId = e.id
  doctorId = e.doctor.id
})

/** Runs `fn` on the test database in a transaction that is always rolled back, with the index of 0025 dropped (as a database from before it would have none). */
async function withOldDatabase<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await assertTestDatabase()
  const c = createAdminClient(testConfig.db, testConfig.db.name)
  await c.connect()
  try {
    await c.query('BEGIN')
    await c.query('DROP INDEX transcripts_one_live_uq')
    return await fn(c)
  } finally {
    await c.query('ROLLBACK').catch(() => undefined)
    await c.end()
  }
}
const addLive = (c: pg.Client, ago: string) =>
  c.query("INSERT INTO transcripts (encounter_id, source, status, created_by, created_at) VALUES ($1, 'browser_recording', 'live', $2, now() - $3::interval) RETURNING id", [encounterId, doctorId, ago])

describe('the live-recording condition of migration 0025', () => {
  it('is met by a database with at most one live recording per consultation', async () => {
    await withOldDatabase(async (c) => {
      expect(await duplicateLiveRecordings(c)).toEqual({ consultations: 0, recordings: 0 })
      await addLive(c, '5 minutes')
      expect(await duplicateLiveRecordings(c)).toEqual({ consultations: 0, recordings: 0 })
      expect(await PREFLIGHTS[0]!.check(c)).toBeNull()
    })
  })

  it('is not met when several recordings of one consultation are still live, and the message says what to do and that nothing was changed', async () => {
    await withOldDatabase(async (c) => {
      await addLive(c, '30 minutes')
      await addLive(c, '20 minutes')
      await addLive(c, '1 minute')
      expect(await duplicateLiveRecordings(c)).toEqual({ consultations: 1, recordings: 2 })
      const message = (await PREFLIGHTS[0]!.check(c))!
      expect(message).toMatch(/1 consultation\(s\) have more than one recording still marked "live" \(2 extra\)/)
      expect(message).toMatch(/Nothing was changed/)
      expect(message).toContain('--end-duplicate-live-recordings')
      // The check only reads.
      expect((await c.query("SELECT count(*)::int AS n FROM transcripts WHERE status = 'live'")).rows[0].n).toBe(3)
    })
  })

  it('is met after the remedy, which ends all but the newest recording and says how many it changed', async () => {
    await withOldDatabase(async (c) => {
      await addLive(c, '30 minutes')
      await addLive(c, '20 minutes')
      const newest = (await addLive(c, '1 minute')).rows[0].id as string
      expect(await endDuplicateLiveRecordings(c)).toBe(2)
      const live = (await c.query("SELECT id FROM transcripts WHERE status = 'live'")).rows
      expect(live).toEqual([{ id: newest }])
      expect((await c.query("SELECT count(*)::int AS n FROM transcripts WHERE status = 'final' AND ended_at IS NOT NULL")).rows[0].n).toBe(2)
      expect(await PREFLIGHTS[0]!.check(c)).toBeNull()
      // The unique index of the migration can now be built.
      await c.query("CREATE UNIQUE INDEX transcripts_one_live_uq ON transcripts USING btree (encounter_id) WHERE status = 'live'")
      expect(await endDuplicateLiveRecordings(c)).toBe(0)
    })
  })

  it('is applied by the real migration: the shipped database has the index and no duplicates (the application of 0025 is recorded)', async () => {
    await assertTestDatabase()
    const c = createAdminClient(testConfig.db, testConfig.db.name)
    await c.connect()
    try {
      expect((await c.query("SELECT 1 FROM meta.schema_migrations WHERE name = '0025_capture_v2.sql'")).rowCount).toBe(1)
      expect((await c.query("SELECT 1 FROM pg_indexes WHERE indexname = 'transcripts_one_live_uq'")).rowCount).toBe(1)
    } finally {
      await c.end()
    }
  })
})

describe('the migration runner', () => {
  /** A client that remembers what it was asked and answers the ledger and the pre-flight query as told; no database is involved. */
  function fakeClient(opts: { duplicates: number }) {
    const log: string[] = []
    let remaining = opts.duplicates
    const client = {
      async query(sql: string) {
        const s = sql.replace(/\s+/g, ' ').trim()
        log.push(s.slice(0, 60))
        if (s.startsWith('SELECT name, checksum FROM meta.schema_migrations')) return { rows: [] }
        if (s.includes('FROM (SELECT encounter_id, count(*) AS n FROM transcripts')) return { rows: [{ consultations: String(remaining ? 1 : 0), recordings: String(remaining) }] }
        if (s.startsWith('UPDATE transcripts SET status')) {
          const n = remaining
          remaining = 0
          return { rows: [], rowCount: n }
        }
        return { rows: [] }
      },
    }
    return { client: client as unknown as pg.Client, log }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaxai-migrations-'))
  fs.writeFileSync(path.join(dir, '0025_capture_v2.sql'), 'SELECT 1;')
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('refuses to apply 0025 to a database that does not meet the condition, applies nothing, and changes no data', async () => {
    const { client, log } = fakeClient({ duplicates: 2 })
    await expect(migrate(client, dir)).rejects.toThrow(/Migration 0025_capture_v2.sql cannot be applied yet: 1 consultation\(s\) have more than one recording/)
    expect(log.some((l) => l.startsWith('BEGIN'))).toBe(false)
    expect(log.some((l) => l.startsWith('UPDATE transcripts'))).toBe(false)
  })

  it('applies the remedy only when asked for it by name, then the migration', async () => {
    const { client, log } = fakeClient({ duplicates: 2 })
    const messages: string[] = []
    const r = await migrate(client, dir, { resolve: ['--end-duplicate-live-recordings'], log: (m) => messages.push(m) })
    expect(r.applied).toEqual(['0025_capture_v2.sql'])
    expect(messages).toContain('--end-duplicate-live-recordings: 2 row(s) changed')
    expect(log.findIndex((l) => l.startsWith('UPDATE transcripts'))).toBeLessThan(log.findIndex((l) => l.startsWith('BEGIN')))
  })

  it('leaves a database that meets the condition alone, with or without the flag', async () => {
    for (const resolve of [[], ['--end-duplicate-live-recordings']]) {
      const { client, log } = fakeClient({ duplicates: 0 })
      expect((await migrate(client, dir, { resolve })).applied).toEqual(['0025_capture_v2.sql'])
      expect(log.some((l) => l.startsWith('UPDATE transcripts'))).toBe(false)
    }
  })
})
