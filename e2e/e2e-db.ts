import pg from 'pg'
import { E2E_DB } from './db-names.ts'

/**
 * Test-only access to the end-to-end database, for the one thing the product
 * (rightly) refuses: an appointment whose time has already come. Booking needs
 * a future time, so a check-in test that must run at any hour of the day moves
 * a booked appointment to a time today. It fails closed: the database must
 * identify itself as the e2e database (marker written by `db:migrate`), and
 * nothing is printed.
 */
async function withE2eDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_ADMIN_USER || 'adaxai_admin',
    password: process.env.DB_ADMIN_PASSWORD || '',
    database: E2E_DB,
  })
  await c.connect()
  try {
    const marker = await c.query("select to_regclass('meta.database_identity') is not null as ok")
    const role = marker.rows[0].ok ? (await c.query('select role from meta.database_identity')).rows[0]?.role : undefined
    if (role !== 'e2e') throw new Error('Refusing: this database does not identify as the end-to-end database.')
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** Moves a booked appointment to `time` (HH:MM) on the clinic's current day. */
export async function moveAppointmentToToday(appointmentId: string, time: string): Promise<void> {
  await withE2eDb(async (c) => {
    await c.query('SET session_replication_role = replica')
    const r = await c.query(
      `UPDATE appointments a SET scheduled_at = (((now() at time zone f.timezone)::date + $2::time)::timestamp at time zone f.timezone)
         FROM facilities f WHERE f.id = a.facility_id AND a.id = $1`,
      [appointmentId, time],
    )
    if (r.rowCount !== 1) throw new Error('appointment not found')
  })
}

/** Ends a user's sessions as time would (their expiry passes), so a test can see what the app does with a session that is gone. */
export async function expireSessionsOf(username: string): Promise<number> {
  return withE2eDb(async (c) => {
    const r = await c.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE username = $1)", [username])
    return r.rowCount ?? 0
  })
}
