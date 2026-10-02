// Synthetic seed data only. Never put real patient or staff data here.
// Idempotent: re-running inserts nothing new.
import { pathToFileURL } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { hashPassword } from '../auth/password.ts'
import { loadConfig, loadDotEnv } from '../config.ts'
import { createDb, type Db } from './client.ts'
import { createAppPool } from './pool.ts'
import { departments, facilities, users } from './schema.ts'

export const SEED_FACILITIES = [{ code: 'DEMO-OPD-01', name: 'ADAXAI Demo OPD (synthetic)', timezone: 'Asia/Kolkata' }]

export const SEED_DEPARTMENTS = [
  { code: 'GEN', name: 'General Medicine' },
  { code: 'PED', name: 'Paediatrics' },
  { code: 'ORTH', name: 'Orthopaedics' },
]

/** Demo staff accounts. All names are fictional. Passwords come from SEED_DEMO_PASSWORD. */
export const SEED_USERS = [
  { username: 'admin', fullName: 'Asha Admin (synthetic)', role: 'admin', department: null, registrationNumber: null },
  { username: 'dr.meera', fullName: 'Dr. Meera Iyer (synthetic)', role: 'doctor', department: 'GEN', registrationNumber: 'DEMO-REG-0001' },
  { username: 'dr.rahul', fullName: 'Dr. Rahul Menon (synthetic)', role: 'doctor', department: 'PED', registrationNumber: 'DEMO-REG-0002' },
  { username: 'nurse.anil', fullName: 'Anil Kumar (synthetic)', role: 'nurse', department: 'GEN', registrationNumber: null },
] as const

export interface SeedResult {
  facilities: number
  departments: number
  users: number
  skippedUsers?: string
}

export async function seed(db: Db, demoPassword: string | undefined): Promise<SeedResult> {
  const insertedFacilities = await db.insert(facilities).values(SEED_FACILITIES).onConflictDoNothing({ target: facilities.code }).returning({ id: facilities.id })
  const facility = await db.query.facilities.findFirst({ where: eq(facilities.code, SEED_FACILITIES[0]!.code) })
  if (!facility) throw new Error('seed facility missing')

  let deptInserted = 0
  for (const d of SEED_DEPARTMENTS) {
    const r = await db.insert(departments).values({ facilityId: facility.id, ...d }).onConflictDoNothing().returning({ id: departments.id })
    deptInserted += r.length
  }

  if (!demoPassword) return { facilities: insertedFacilities.length, departments: deptInserted, users: 0, skippedUsers: 'SEED_DEMO_PASSWORD not set' }
  const passwordHash = await hashPassword(demoPassword)
  let usersInserted = 0
  for (const u of SEED_USERS) {
    const dept = u.department ? await db.query.departments.findFirst({ where: and(eq(departments.facilityId, facility.id), eq(departments.code, u.department)) }) : null
    const r = await db
      .insert(users)
      .values({ facilityId: facility.id, username: u.username, fullName: u.fullName, role: u.role, departmentId: dept?.id ?? null, registrationNumber: u.registrationNumber, passwordHash })
      .onConflictDoNothing({ target: users.username })
      .returning({ id: users.id })
    usersInserted += r.length
  }
  return { facilities: insertedFacilities.length, departments: deptInserted, users: usersInserted }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadDotEnv()
  const config = loadConfig()
  const pool = createAppPool(config.db)
  try {
    const r = await seed(createDb(pool), process.env.SEED_DEMO_PASSWORD || undefined)
    console.log(`[seed] ${config.db.name}: inserted ${r.facilities} facility, ${r.departments} department(s), ${r.users} demo user(s)${r.skippedUsers ? ` (users skipped: ${r.skippedUsers})` : ''}`)
  } catch (e) {
    console.error(`[seed] ERROR ${(e as Error).message}`)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
