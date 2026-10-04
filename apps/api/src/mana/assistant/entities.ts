import type { ManaEntity } from '@adaxai/contracts'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { DbOrTx } from '../../db/client.ts'
import { patients } from '../../db/schema.ts'
import { ageOn, fullName, getPatientOr404, type PatientRow } from '../../patients/service.ts'
import type { ManaCtx } from './types.ts'

/**
 * The patients a conversation has shown, by the handle the model uses (P1, P2 ...). The model is given handles, never names, MRNs or telephone
 * numbers: it cannot misspell a name, be steered by one, or leak one, and the screen puts the name back from this list. A handle belongs to one
 * conversation: P1 here is not P1 anywhere else.
 */
export const MAX_ENTITIES = 60

export interface EntityRef {
  alias: string
  patientId: string
}

export class EntityBook {
  private refs: EntityRef[]

  constructor(initial: EntityRef[] = []) {
    this.refs = initial.map((r) => ({ alias: r.alias, patientId: r.patientId }))
  }

  /** The handle of a patient, giving one the first time the patient is shown. */
  aliasFor(patientId: string): string {
    const known = this.refs.find((r) => r.patientId === patientId)
    if (known) return known.alias
    if (this.refs.length >= MAX_ENTITIES) throw new TooManyPatients()
    const alias = `P${this.refs.length + 1}`
    this.refs.push({ alias, patientId })
    return alias
  }

  patientIdOf(alias: string): string | null {
    return this.refs.find((r) => r.alias === alias)?.patientId ?? null
  }

  aliasOf(patientId: string): string | null {
    return this.refs.find((r) => r.patientId === patientId)?.alias ?? null
  }

  all(): EntityRef[] {
    return this.refs.map((r) => ({ ...r }))
  }
}

export class TooManyPatients extends Error {
  constructor() {
    super(`A conversation can show at most ${MAX_ENTITIES} different patients. Start a new conversation.`)
  }
}

const ageSex = (p: Pick<PatientRow, 'dateOfBirth' | 'sex'>, today: string) => `${ageOn(String(p.dateOfBirth), today)} y · ${p.sex === 'female' ? 'Female' : p.sex === 'male' ? 'Male' : 'Sex not recorded'}`

/** What the doctor's screen shows for each handle: name, MRN, age and sex, and the date of the last visit (enough to tell patients apart, no more). */
export async function describePatients(db: DbOrTx, facilityId: string, today: string, book: EntityBook, patientIds: string[]): Promise<ManaEntity[]> {
  const ids = [...new Set(patientIds)]
  if (!ids.length) return []
  const lastVisit = sql<string | null>`(select max(v.visit_date)::text from visits v where v.patient_id = ${patients.id})`
  const rows = await db
    .select({ p: patients, lastVisit })
    .from(patients)
    .where(and(eq(patients.facilityId, facilityId), inArray(patients.id, ids)))
  return rows
    .map(({ p, lastVisit: lv }) => ({ alias: book.aliasOf(p.id) ?? '', displayName: fullName(p), mrn: p.mrn, ageSex: ageSex(p, today), lastVisit: lv }))
    .filter((e) => e.alias)
    .sort((a, b) => Number(a.alias.slice(1)) - Number(b.alias.slice(1)))
}

/** How many handles the planner is shown: the newest ones (a follow-up means a patient discussed lately), so that a long conversation does not fill its prompt. */
const PLANNER_HANDLES = 10

/** What the model may be told about a handle: sex and age in ten-year bands (the same band the consultation draft uses). */
export async function modelDescriptions(db: DbOrTx, facilityId: string, today: string, book: EntityBook): Promise<{ alias: string; line: string }[]> {
  const refs = book.all().slice(-PLANNER_HANDLES)
  if (!refs.length) return []
  const rows = await db
    .select({ id: patients.id, dob: patients.dateOfBirth, sex: patients.sex })
    .from(patients)
    .where(and(eq(patients.facilityId, facilityId), inArray(patients.id, refs.map((r) => r.patientId))))
  return refs.flatMap((r) => {
    const p = rows.find((x) => x.id === r.patientId)
    if (!p) return []
    const years = ageOn(String(p.dob), today)
    const band = years >= 90 ? '90+' : `${Math.floor(years / 10) * 10}-${Math.floor(years / 10) * 10 + 9}`
    return [{ alias: r.alias, line: `${p.sex}, ${band} years` }]
  })
}

const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The patients of the clinic whose name has EVERY word the doctor gave as a whole word ("Meena Kumar" is not "Meena Kumari", "Mary" is not "Maryam"), and,
 * only when `mrnPrefix` / `phone` say so (finding a patient, not answering about one), an MRN that starts with it or telephone digits that are in the
 * number. Stricter than the patient list's search, which tolerates typing mistakes: what comes back is shown as "these are the patients you may mean" or
 * is read as the patient meant, and a patient who only looks like the name must not be taken for it.
 */
export async function searchPatients(db: DbOrTx, facilityId: string, query: string, limit: number, opts: { mrnPrefix?: boolean; phone?: boolean } = {}): Promise<PatientRow[]> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (q.length < 2) return []
  const digits = q.replace(/\D/g, '')
  const term = q.toLowerCase()
  const words = term.split(' ').filter((w) => w.length >= 2)
  const conds: ReturnType<typeof sql>[] = []
  if (opts.mrnPrefix) conds.push(sql`${patients.mrn} ilike ${`${escapeLike(q)}%`}`)
  if (words.length) conds.push(and(...words.map((w) => sql`${patients.searchName} ~* ${`\\m${escapeRegex(w)}\\M`}`))!)
  if (opts.phone && digits.length >= 4) conds.push(sql`${patients.phone} like ${`%${digits}%`}`)
  if (!conds.length) return []
  return db
    .select()
    .from(patients)
    .where(and(eq(patients.facilityId, facilityId), or(...conds)))
    .orderBy(sql`(${patients.mrn} = ${q}) desc`, sql`similarity(${patients.searchName}, ${term}) desc`, desc(patients.updatedAt))
    .limit(limit)
}

export type Handle =
  | { kind: 'one'; patientId: string; alias: string }
  | { kind: 'ambiguous'; candidates: { patientId: string; alias: string }[] }
  | { kind: 'none'; reason: string }

/** Words that mean "the patient we are talking about", which is the open consultation's patient. */
const CURRENT = /^(?:current|this patient|the patient|current patient|open patient)$/i

/**
 * Turns the model's patient handle into one patient of THIS clinic, or says why not. It is the only way a tool gets a patient: "current" (the
 * consultation the conversation was opened in), "P3" (a patient this conversation already showed), "mrn:..." or "name:...". Anything else is not
 * a patient. A name that fits several patients is never resolved by guessing.
 */
export async function resolveHandle(ctx: ManaCtx, handle: string | null): Promise<Handle> {
  const h = (handle ?? '').trim()
  if (!h) return { kind: 'none', reason: 'No patient was named.' }
  if (CURRENT.test(h)) {
    if (!ctx.scope.patientId) return { kind: 'none', reason: 'This conversation is not about a particular patient, so there is no current patient.' }
    const p = await getPatientOr404(ctx.db, ctx.me.facilityId, ctx.scope.patientId)
    return { kind: 'one', patientId: p.id, alias: ctx.book.aliasFor(p.id) }
  }
  const alias = /^P(\d{1,2})$/i.exec(h)
  if (alias) {
    const id = ctx.book.patientIdOf(`P${alias[1]}`)
    if (!id) return { kind: 'none', reason: `${h.toUpperCase()} is not a patient shown in this conversation.` }
    const p = await getPatientOr404(ctx.db, ctx.me.facilityId, id)
    return { kind: 'one', patientId: p.id, alias: ctx.book.aliasFor(p.id) }
  }
  const mrn = /^mrn\s*:\s*(.{3,40})$/i.exec(h)
  if (mrn) {
    const [p] = await ctx.db
      .select()
      .from(patients)
      .where(and(eq(patients.facilityId, ctx.me.facilityId), sql`lower(${patients.mrn}) = ${mrn[1]!.trim().toLowerCase()}`))
      .limit(1)
    if (p) return { kind: 'one', patientId: p.id, alias: ctx.book.aliasFor(p.id) }
    // The same answer whether the MRN belongs to another clinic or to no one; the audit log tells them apart (as the patient pages do).
    const [elsewhere] = await ctx.db.select({ id: patients.id }).from(patients).where(sql`lower(${patients.mrn}) = ${mrn[1]!.trim().toLowerCase()}`).limit(1)
    if (elsewhere) ctx.denials.push({ entityType: 'patient', entityId: elsewhere.id, reason: 'other_facility' })
    return { kind: 'none', reason: 'No patient with that MRN was found in this clinic.' }
  }
  const name = /^name\s*:\s*(.{2,80})$/i.exec(h)
  if (name) {
    const query = name[1]!.trim()
    const rows = await searchPatients(ctx.db, ctx.me.facilityId, query, 6)
    if (!rows.length) return { kind: 'none', reason: 'No patient matching that name was found in this clinic.' }
    // One match, or one that fits the whole name written out: the patient. Otherwise the doctor chooses.
    const exact = rows.filter((r) => norm(fullName(r)) === norm(query))
    const only = rows.length === 1 ? rows[0]! : exact.length === 1 && norm(query).includes(' ') ? exact[0]! : null
    if (only) return { kind: 'one', patientId: only.id, alias: ctx.book.aliasFor(only.id) }
    return { kind: 'ambiguous', candidates: rows.slice(0, 5).map((r) => ({ patientId: r.id, alias: ctx.book.aliasFor(r.id) })) }
  }
  return { kind: 'none', reason: 'That is not a way to name a patient (a handle like P1, "current", "mrn:..." or "name:...").' }
}
