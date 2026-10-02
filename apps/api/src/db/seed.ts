// Synthetic seed data only. Never put real patient or staff data here.
// Idempotent: re-running inserts nothing new.
import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import { loadConfig, loadDotEnv } from '../config.ts'
import { createAppPool } from './pool.ts'
import { facilities } from './schema.ts'

export const SEED_FACILITIES = [{ code: 'DEMO-OPD-01', name: 'ADAXAI Demo OPD (synthetic)', timezone: 'Asia/Kolkata' }]

/** Inserts missing seed facilities; returns how many were inserted. */
export async function seedFacilities(pool: pg.Pool): Promise<number> {
  const db = drizzle(pool)
  const inserted = await db
    .insert(facilities)
    .values(SEED_FACILITIES)
    .onConflictDoNothing({ target: facilities.code })
    .returning({ code: facilities.code })
  return inserted.length
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadDotEnv()
  const config = loadConfig()
  const pool = createAppPool(config.db)
  try {
    const n = await seedFacilities(pool)
    console.log(`[seed] ${config.db.name}: ${n} facility row(s) inserted, ${SEED_FACILITIES.length - n} already present`)
  } catch (e) {
    console.error(`[seed] ERROR ${(e as Error).message}`)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
