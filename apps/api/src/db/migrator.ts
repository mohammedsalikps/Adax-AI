import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type pg from 'pg'
import { API_ROOT } from '../config.ts'
import { PREFLIGHTS } from './preflight.ts'

export const MIGRATIONS_DIR = path.join(API_ROOT, 'drizzle')

export interface MigrationResult {
  applied: string[]
  skipped: string[]
}

export interface MigrateOptions {
  /** Role that receives read access to the ledger (the application role). */
  appRole?: string
  log?: (msg: string) => void
  /** Remedies (flags of src/db/preflight.ts) the operator asked for by name: each is applied only if its migration's pre-flight check fails. */
  resolve?: string[]
}

// Fixed key so two migration runs against one database never interleave.
const LOCK_KEY = 4_206_942

const checksum = (sql: string) => crypto.createHash('sha256').update(sql).digest('hex')

/**
 * Applies `*.sql` files from `dir` in filename order (drizzle-kit names them
 * 0000_, 0001_, ...). Each file runs in its own transaction together with its
 * ledger row, so a failing file leaves no partial changes. Files already
 * applied are verified by checksum: editing an applied migration is an error.
 */
export async function migrate(client: pg.Client, dir: string = MIGRATIONS_DIR, opts: MigrateOptions = {}): Promise<MigrationResult> {
  const log = opts.log ?? (() => undefined)
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  // Normalise line endings so a CRLF checkout does not change checksums.
  const migrations = files.map((name) => {
    const sql = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n')
    return { name, sql, checksum: checksum(sql) }
  })

  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS meta')
    await client.query(`CREATE TABLE IF NOT EXISTS meta.schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    if (opts.appRole) {
      await client.query(`GRANT USAGE ON SCHEMA meta TO ${opts.appRole}`)
      await client.query(`GRANT SELECT ON meta.schema_migrations TO ${opts.appRole}`)
    }

    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM meta.schema_migrations')
    const done = new Map(rows.map((r) => [r.name, r.checksum]))

    // Verify the whole history before applying anything new.
    for (const m of migrations) {
      const prev = done.get(m.name)
      if (prev && prev !== m.checksum) throw new Error(`Migration ${m.name} was modified after it was applied (checksum mismatch). Add a new migration instead.`)
    }
    const onDisk = new Set(migrations.map((m) => m.name))
    const missing = [...done.keys()].filter((n) => !onDisk.has(n))
    if (missing.length) throw new Error(`Applied migrations missing from ${dir}: ${missing.join(', ')}`)

    const result: MigrationResult = { applied: [], skipped: [] }
    for (const m of migrations) {
      if (done.has(m.name)) {
        result.skipped.push(m.name)
        continue
      }
      // Data conditions this migration needs: checked first, in words, so a database that does not meet one is told what to do instead of failing inside it.
      for (const pre of PREFLIGHTS.filter((p) => p.migration === m.name)) {
        let problem = await pre.check(client)
        if (problem && opts.resolve?.includes(pre.flag)) {
          log(`${pre.flag}: ${await pre.remedy(client)} row(s) changed`)
          problem = await pre.check(client)
        }
        if (problem) throw new Error(`Migration ${m.name} cannot be applied yet: ${problem}`)
      }
      try {
        await client.query('BEGIN')
        await client.query(m.sql)
        await client.query('INSERT INTO meta.schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${m.name} failed and was rolled back: ${(e as Error).message}`)
      }
      result.applied.push(m.name)
      log(`applied ${m.name}`)
    }
    // Append-only tables: the app role keeps INSERT and SELECT only (migration 0019 lists them).
    if (opts.appRole && (await client.query("SELECT to_regprocedure('meta.enforce_append_only(text)') IS NOT NULL AS ok")).rows[0].ok) {
      await client.query('SELECT meta.enforce_append_only($1)', [opts.appRole])
    }
    return result
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
  }
}
