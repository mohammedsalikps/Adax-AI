import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clinicInstant, EARLIEST_CLINIC_MINUTE, LATEST_CLINIC_MINUTE, MIDDAY_MINUTE, seedHospital } from '../src/db/hospital-seed.ts'
import { PATIENTS } from '../src/db/hospital-seed-data.ts'
import { seed } from '../src/db/seed.ts'
import { adminQuery, createTestApp, resetDatabase, TEST_PASSWORD, testConfig } from './helpers.ts'

// The synthetic hospital dataset must not depend on the time of day it is made at. Today's appointments sit at offsets from the clinic's clock,
// down to 150 minutes ago; just after midnight there is not enough of the day behind to hold them, and the seed used to fail there
// (`appointments_doctor_no_overlap`, or a "no-show" that had not started). These tests make the seed at chosen clinic times, whatever the real
// clock says, and check what it made against that time.

const TZ = 'Asia/Kolkata'
const ctx = createTestApp()
afterAll(() => ctx.close())
beforeEach(async () => {
  await resetDatabase()
  await seed(ctx.db, TEST_PASSWORD)
})
afterEach(() => vi.useRealTimers())

const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const seedQuietly = (extra: { clinicMinute?: number } = {}) => seedHospital({ config: testConfig, password: TEST_PASSWORD, log: () => undefined, ...extra })

/** What the seed made, judged against the instant it treated as "now". */
async function checkSchedule(now: Date) {
  const rows = (await adminQuery('SELECT status, scheduled_at FROM appointments')).rows as { status: string; scheduled_at: Date }[]
  expect(rows).toHaveLength(PATIENTS.filter((p) => p.today?.atOffsetMin !== undefined).length)
  expect([...new Set(rows.map((r) => r.status))].sort()).toEqual(['booked', 'checked_in', 'completed', 'no_show'])
  for (const r of rows) {
    // Anything that has happened (did not come, arrived, was seen) was booked for a time that had already come; a booking is still to come.
    if (r.status === 'booked') expect(r.scheduled_at.getTime(), 'a booking is in the future').toBeGreaterThan(now.getTime())
    else expect(r.scheduled_at.getTime(), `${r.status} had started`).toBeLessThanOrEqual(now.getTime())
  }
}

describe('the clinic’s clock', () => {
  it('finds the instant at which the clinic’s wall clock reads a given time', () => {
    expect(clinicInstant('2026-10-04', 12 * 60, 'Asia/Kolkata').toISOString()).toBe('2026-10-04T06:30:00.000Z')
    expect(clinicInstant('2026-10-04', 0, 'Asia/Kolkata').toISOString()).toBe('2026-10-03T18:30:00.000Z')
    expect(clinicInstant('2026-10-04', 23 * 60 + 55, 'UTC').toISOString()).toBe('2026-10-04T23:55:00.000Z')
    expect(clinicInstant('2026-01-15', 9 * 60, 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z')
  })
})

describe('the seed at any clinic time', () => {
  // Each time is made explicitly, so the result does not depend on when this runs. The first and the last are the ends of the range the real clock is used for.
  it.each([
    ['03:20 (the earliest time with room for every past appointment)', EARLIEST_CLINIC_MINUTE + 40],
    ['midday', MIDDAY_MINUTE],
    ['22:25 (the latest time with room for every booking)', LATEST_CLINIC_MINUTE],
    ['late in the evening (23:00)', 23 * 60],
  ])('made at %s it puts every appointment on the right side of that time', async (_label, minute) => {
    const result = await seedQuietly({ clinicMinute: minute })
    expect(result.created).toBe(PATIENTS.length)
    await checkSchedule(clinicInstant(localDate(), minute, TZ))
  }, 120_000)

  // Whatever the real clock says outside the range with room for the schedule, the run is made as if it were midday (the held clock is the one
  // the API reads, so every check it makes agrees), and it runs.
  async function seedAsIfRealClockSays(minutes: number[]) {
    for (const minute of minutes) {
      await resetDatabase()
      await seed(ctx.db, TEST_PASSWORD)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(clinicInstant(localDate(), minute, TZ))
      try {
        const result = await seedQuietly()
        expect(result.created, `at ${minute} minutes after midnight`).toBe(PATIENTS.length)
      } finally {
        vi.useRealTimers()
      }
      await checkSchedule(clinicInstant(localDate(), MIDDAY_MINUTE, TZ))
    }
  }

  it('in the first hours of the day, when the real clock leaves no room for the day behind, it is made as if it were midday, and runs', async () => {
    await seedAsIfRealClockSays([0, 30, 55, 120, EARLIEST_CLINIC_MINUTE - 1])
  }, 240_000)

  it('in the last hours of the day, when the real clock leaves no room for the bookings ahead, it is made as if it were midday, and runs', async () => {
    // 22:26 is the first minute past the range; 23:15, 23:30 and 23:55 are the times at which a booking 90 minutes ahead cannot be placed after "now".
    await seedAsIfRealClockSays([LATEST_CLINIC_MINUTE + 1, 23 * 60 + 15, 23 * 60 + 30, 23 * 60 + 55])
  }, 240_000)

  it('refuses, rather than make a booking that has already started, when it is asked for a clinic time with no room for the bookings', async () => {
    await expect(seedQuietly({ clinicMinute: 23 * 60 + 30 })).rejects.toThrow(/No free appointment slot after the clinic time \(23:30\)/)
  }, 120_000)

  it('a session made while the clock is held starts at the held time (set by the seed itself: the application’s sign-in is not changed for it)', async () => {
    await seedQuietly({ clinicMinute: MIDDAY_MINUTE })
    const rows = (await adminQuery("SELECT s.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'nurse.anil'")).rows as { last_seen_at: Date; expires_at: Date }[]
    expect(rows.length).toBeGreaterThan(0)
    // Held at 12:00 of today's clinic date, not at the real time the run took place.
    const held = clinicInstant(localDate(), MIDDAY_MINUTE, TZ).getTime()
    expect(rows.every((r) => Math.abs(r.last_seen_at.getTime() - held) < 120_000)).toBe(true)
  }, 120_000)

  it('leaves the clock alone when the run is over: the real time is back, and a second run only completes what is missing', async () => {
    const before = Date.now()
    await seedQuietly({ clinicMinute: MIDDAY_MINUTE })
    expect(Math.abs(Date.now() - before)).toBeLessThan(60_000)
    expect(await seedQuietly({ clinicMinute: MIDDAY_MINUTE })).toEqual({ created: 0, completed: 0, activity: 0, newStaff: 0 })
  }, 120_000)
})
