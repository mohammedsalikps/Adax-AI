import crypto from 'node:crypto'
import type { AuditChainProblem, AuditChainReport } from '@adaxai/contracts'
import { sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'

/**
 * Verifies the audit log's hash chain (chain version 1, migration 0019).
 *
 * The database links every new event: chain_seq is the next number, prev_hash
 * the previous event's row_hash (64 zeros for the first), and row_hash the
 * SHA-256 of the event's canonical text: the jsonb array [chain_version,
 * chain_seq, prev_hash, id, occurred_at (UTC, microseconds), actor_user_id,
 * actor_role, action, outcome, entity_type, entity_id, patient_id,
 * request_id, ip, user_agent, details, facility_id] as PostgreSQL prints it.
 * This verifier rebuilds that text itself from the column values (it does not
 * call the database's canonical function), so a changed trigger function is
 * caught as well as changed rows.
 *
 * Found: a changed event (its hash no longer matches), a removed event (a gap
 * in the numbering), events reordered or inserted (a link that does not
 * follow), events written without a link after the chain began, and changes
 * to the events from before the chain (their digest, recorded in the
 * audit.chain_start event, no longer matches). Not found without an anchor
 * recorded outside the system: removal of the newest events, or a complete
 * rewrite of the chain by someone with full database access.
 */
const ZERO = '0'.repeat(64)
const BATCH = 2000
const MAX_PROBLEMS = 20
const UTC_MICROS = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

export interface AuditRowText {
  seq: string | null
  ver: number | null
  prev: string | null
  hash: string | null
  id: string
  at: string
  actor: string | null
  role: string | null
  action: string
  outcome: string
  etype: string | null
  eid: string | null
  patient: string | null
  request: string | null
  ip: string | null
  ua: string | null
  details: string
  facility: string | null
}

const COLUMNS = sql.raw(`chain_seq::text as seq, chain_version as ver, prev_hash as prev, row_hash as hash, id::text as id,
  to_char(occurred_at at time zone 'UTC', '${UTC_MICROS}') as at, actor_user_id::text as actor, actor_role as role, action, outcome,
  entity_type as etype, entity_id as eid, patient_id::text as patient, request_id as request, ip, user_agent as ua, details::text as details,
  facility_id::text as facility`)

const js = (v: string | null) => (v === null ? 'null' : JSON.stringify(v))
const num = (v: string | number | null) => (v === null ? 'null' : String(v))

/** The event's canonical text, rebuilt from its column values. */
export function auditCanonical(r: AuditRowText): string {
  return `[${[num(r.ver), num(r.seq), js(r.prev), num(r.id), js(r.at), js(r.actor), js(r.role), js(r.action), js(r.outcome), js(r.etype), js(r.eid), js(r.patient), js(r.request), js(r.ip), js(r.ua), r.details, js(r.facility)].join(', ')}]`
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

async function rows(db: DbOrTx, query: ReturnType<typeof sql>): Promise<AuditRowText[]> {
  return (await db.execute(query)).rows as unknown as AuditRowText[]
}

export async function verifyAuditChain(db: DbOrTx, anchor?: { seq: number; hash: string }): Promise<AuditChainReport> {
  const checkedAt = new Date().toISOString()
  const problems: AuditChainProblem[] = []
  let problemCount = 0
  // Whether any problem other than an unsupported version was found (independent of the listing cap).
  let otherProblem = false
  const problem = (p: AuditChainProblem) => {
    problemCount++
    if (p.kind !== 'unsupported_version') otherProblem = true
    if (problems.length < MAX_PROBLEMS) problems.push(p)
  }

  const cols = (await db.execute(sql`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'audit_events' and column_name in ('chain_seq', 'prev_hash', 'row_hash', 'chain_version')`)).rows[0] as { n: number }
  const [counts] = (await db.execute(sql`select count(*)::int as total, ${cols.n === 4 ? sql.raw('count(chain_seq)::int') : sql.raw('0')} as chained from audit_events`)).rows as { total: number; chained: number }[]
  const events = { total: counts!.total, chained: counts!.chained, beforeChain: 0 }
  if (cols.n !== 4) {
    return { status: 'unverifiable', checkedAt, events, head: null, chainStart: null, anchor: null, problems: [{ kind: 'unchained_event', seq: null, detail: 'This database has no audit hash chain (migration 0019 is not applied).' }], problemCount: 1 }
  }

  // Walk the chain in order.
  let expected = 1
  let prevHash = ZERO
  let head: AuditChainReport['head'] = null
  let after = 0
  let prevVersion = 1
  for (;;) {
    const batch = await rows(db, sql`select ${COLUMNS} from audit_events where chain_seq > ${after} order by audit_events.chain_seq limit ${BATCH}`)
    if (!batch.length) break
    for (const r of batch) {
      const seq = Number(r.seq)
      // Numbering and links compare stored values, so they are checked whatever the event's version.
      if (seq !== expected) problem({ kind: 'gap', seq: expected, detail: seq === expected + 1 ? `Event ${expected} is missing.` : `Events ${expected} to ${seq - 1} are missing.` })
      else if (r.prev !== prevHash) problem({ kind: 'broken_link', seq, detail: `Event ${seq} does not follow event ${seq - 1}: events were reordered, inserted or changed.` })
      // Versions never decrease along the chain: an older version after a newer one means it was altered.
      if ((r.ver ?? 0) < prevVersion) problem({ kind: 'broken_link', seq, detail: `Event ${seq} uses chain version ${r.ver} after an event with version ${prevVersion}: the chain was altered.` })
      if (r.ver === 1) {
        if (sha256(auditCanonical(r)) !== r.hash) problem({ kind: 'altered', seq, detail: `Event ${seq} was changed after it was written.` })
      } else problem({ kind: 'unsupported_version', seq, detail: `Event ${seq} uses chain version ${r.ver}, which this version of ADAXAI cannot check.` })
      prevVersion = r.ver ?? 0
      prevHash = r.hash ?? ''
      expected = seq + 1
      head = { seq, hash: r.hash ?? '', occurredAt: r.at }
      after = seq
    }
  }

  // The events from before the chain, as summarised when it began.
  const [start] = await rows(db, sql`select ${COLUMNS} from audit_events where action = 'audit.chain_start' and chain_seq is not null order by chain_seq limit 1`)
  let chainStart: AuditChainReport['chainStart'] = null
  const startDetails = start ? (JSON.parse(start.details) as { legacyEvents?: number; legacyLastId?: number | null; legacyDigest?: string }) : null
  const legacyLastId = startDetails?.legacyLastId ?? null
  if (start && startDetails) {
    const digest = crypto.createHash('sha256')
    let n = 0
    let lastId = '0'
    for (;;) {
      if (legacyLastId === null) break
      // Ordered by the bigint column, not the text alias "id" of the select list.
      const batch = await rows(db, sql`select ${COLUMNS} from audit_events where chain_seq is null and id > ${lastId}::bigint and id <= ${legacyLastId}::bigint order by audit_events.id limit ${BATCH}`)
      if (!batch.length) break
      for (const r of batch) {
        digest.update(n ? `\n${auditCanonical(r)}` : auditCanonical(r), 'utf8')
        n++
        lastId = r.id
      }
    }
    const matches = n === (startDetails.legacyEvents ?? 0) && digest.digest('hex') === startDetails.legacyDigest
    if (!matches) problem({ kind: 'legacy_changed', seq: Number(start.seq), detail: 'Events from before the chain began were changed or removed since the chain started.' })
    chainStart = { seq: Number(start.seq), occurredAt: start.at, legacyEvents: startDetails.legacyEvents ?? 0, legacyDigestMatches: matches }
    events.beforeChain = n
  }

  // Events without a link written after the chain began (only possible by bypassing its trigger).
  const [unchained] = (await db.execute(sql`select count(*)::int as n, min(id)::text as first from audit_events where chain_seq is null ${legacyLastId === null ? sql`` : sql`and id > ${legacyLastId}::bigint`}`)).rows as { n: number; first: string | null }[]
  if (unchained!.n) problem({ kind: 'unchained_event', seq: null, detail: `${unchained!.n} event(s) were written without a link to the chain (first id ${unchained!.first}).` })

  // An anchor recorded earlier, outside the system.
  let anchorResult: AuditChainReport['anchor'] = null
  if (anchor) {
    const [r] = (await db.execute(sql`select row_hash from audit_events where chain_seq = ${anchor.seq}`)).rows as { row_hash: string }[]
    const result = !r ? 'missing' : r.row_hash === anchor.hash ? 'match' : 'mismatch'
    anchorResult = { ...anchor, result }
    if (result === 'missing') problem({ kind: 'anchor_missing', seq: anchor.seq, detail: `Event ${anchor.seq}, recorded as an anchor, is no longer in the log: newer events were removed.` })
    if (result === 'mismatch') problem({ kind: 'anchor_mismatch', seq: anchor.seq, detail: `Event ${anchor.seq} no longer has the hash recorded as an anchor: the chain was rewritten.` })
  }

  const status = !problemCount ? 'valid' : otherProblem ? 'invalid' : 'unsupported_version'
  return { status, checkedAt, events, head, chainStart, anchor: anchorResult, problems, problemCount }
}
