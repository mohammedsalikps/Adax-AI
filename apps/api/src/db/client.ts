import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import * as schema from './schema.ts'

export type Db = NodePgDatabase<typeof schema>
/** A database handle or an open transaction (both expose the same query API). */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema })
}

/** Name of the constraint a driver error is about (unique, check, exclusion), if any. */
export function pgConstraint(e: unknown): string | undefined {
  const err = e as { constraint?: unknown; cause?: { constraint?: unknown } }
  if (typeof err?.constraint === 'string') return err.constraint
  if (typeof err?.cause?.constraint === 'string') return err.cause.constraint
  return undefined
}

/** Postgres error code of a driver error (e.g. '23505' unique violation), if any. */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown } }
  if (typeof err?.code === 'string') return err.code
  if (typeof err?.cause?.code === 'string') return err.cause.code
  return undefined
}
