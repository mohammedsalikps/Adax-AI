/**
 * Database identity: a one-row marker in each database saying what it is for
 * (development, test or e2e), claimed when the database is migrated for that
 * purpose. Destructive test setup (emptying tables, reseeding) refuses to run
 * unless the configured names are unambiguous AND the database it is about to
 * empty identifies itself as the expected disposable database. Anything
 * ambiguous fails closed. Nothing here prints connection details.
 */

export type DbRole = 'development' | 'test' | 'e2e'

/** Minimal client surface (pg.Client or pg.PoolClient). */
export interface QueryClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}

export interface DbNames {
  name: string
  testName: string
  e2eName: string
}

export class UnsafeDatabaseError extends Error {
  constructor(message: string) {
    super(`Refusing to continue: ${message}`)
    this.name = 'UnsafeDatabaseError'
  }
}

/** The three databases must be different, and disposable ones must look disposable. */
export function assertDistinctNames(n: DbNames): void {
  if (n.name === n.testName || n.name === n.e2eName || n.testName === n.e2eName) {
    throw new UnsafeDatabaseError('DB_NAME, DB_TEST_NAME and DB_E2E_NAME must all be different (a test run could otherwise empty the development database).')
  }
  if (!n.testName.endsWith('_test')) throw new UnsafeDatabaseError('DB_TEST_NAME must end with "_test".')
  if (!n.e2eName.endsWith('_e2e')) throw new UnsafeDatabaseError('DB_E2E_NAME must end with "_e2e".')
  if (n.name.endsWith('_test') || n.name.endsWith('_e2e')) throw new UnsafeDatabaseError('DB_NAME must not end with "_test" or "_e2e".')
}

export const roleForName = (n: DbNames, database: string): DbRole | null => (database === n.name ? 'development' : database === n.testName ? 'test' : database === n.e2eName ? 'e2e' : null)

const CREATE = `CREATE TABLE IF NOT EXISTS meta.database_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  role text NOT NULL CHECK (role IN ('development', 'test', 'e2e')),
  claimed_at timestamptz NOT NULL DEFAULT now()
)`

export async function readIdentity(c: QueryClient): Promise<DbRole | null> {
  const exists = await c.query("SELECT to_regclass('meta.database_identity') IS NOT NULL AS ok")
  if (!exists.rows[0]?.ok) return null
  const r = await c.query('SELECT role FROM meta.database_identity')
  return (r.rows[0]?.role as DbRole | undefined) ?? null
}

/** True when the database already holds application data (users or patients). */
export async function holdsData(c: QueryClient): Promise<boolean> {
  for (const t of ['public.users', 'public.patients']) {
    const r = await c.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [t])
    if (r.rows[0]?.ok && (await c.query(`SELECT EXISTS (SELECT 1 FROM ${t}) AS any`)).rows[0]?.any) return true
  }
  return false
}

/**
 * Records what a database is for, the first time it is migrated for that
 * purpose. A database that already identifies as something else is refused.
 * An unmarked database that already holds data is claimed as disposable
 * (test or e2e) only when `claimExisting` says a person checked it.
 */
export async function claimIdentity(c: QueryClient, role: DbRole, o: { claimExisting?: boolean } = {}): Promise<'claimed' | 'confirmed'> {
  const current = await readIdentity(c)
  if (current && current !== role) throw new UnsafeDatabaseError(`this database identifies as "${current}", not "${role}".`)
  if (current) return 'confirmed'
  if (role !== 'development' && !o.claimExisting && (await holdsData(c))) {
    throw new UnsafeDatabaseError(
      `this database has no identity marker but already holds data, so it is not marked as the ${role} database automatically. If it is a disposable ${role} database, run "npm run db:migrate -- --target ${role} --claim-existing".`,
    )
  }
  await c.query('CREATE SCHEMA IF NOT EXISTS meta')
  await c.query(CREATE)
  await c.query('INSERT INTO meta.database_identity (role) VALUES ($1) ON CONFLICT (singleton) DO NOTHING', [role])
  const after = await readIdentity(c)
  if (after !== role) throw new UnsafeDatabaseError(`this database identifies as "${after}", not "${role}".`)
  return 'claimed'
}

/**
 * Guard before emptying, reseeding or otherwise destroying data in a test or
 * e2e database: names unambiguous, the target is the configured disposable
 * database for that purpose (never DB_NAME), and the database itself says so.
 */
export async function assertDisposable(c: QueryClient, names: DbNames, database: string, expected: 'test' | 'e2e'): Promise<void> {
  assertDistinctNames(names)
  if (database === names.name) throw new UnsafeDatabaseError('the target is the development database.')
  if (roleForName(names, database) !== expected) throw new UnsafeDatabaseError(`the target is not the configured ${expected} database.`)
  const identity = await readIdentity(c)
  if (identity !== expected) {
    throw new UnsafeDatabaseError(
      identity
        ? `the target database identifies as "${identity}", not "${expected}".`
        : `the target database has no identity marker. Run "npm run db:migrate -- --target ${expected}" to mark it, then try again.`,
    )
  }
}
