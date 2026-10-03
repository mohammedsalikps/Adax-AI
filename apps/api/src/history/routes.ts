import {
  type Condition,
  ConditionInput,
  ConditionStatusChange,
  type RecordOrigin,
  type Investigation,
  InvestigationInput,
  InvestigationStatusChange,
  type Medication,
  MedicationInput,
  MedicationStatusChange,
} from '@adaxai/contracts'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import { type Db, pgCode } from '../db/client.ts'
import { investigationResults, patientConditions, patientMedications, users } from '../db/schema.ts'
import { badRequest, conflict, deniedNotFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { facilityToday, getPatientOr404 } from '../patients/service.ts'
import { conditionValues, entryOrigin, investigationValues, loadHistory, medicationValues, recordHistoryEvent, toCondition, toInvestigation, toMedication } from './service.ts'

const PatientParams = z.object({ id: z.uuid() })
const SubParams = z.object({ id: z.uuid(), subId: z.uuid() })

const futureDate = (path: string) => badRequest('Some fields are invalid', [{ path, message: 'Cannot be in the future' }])

/** An entry that is not this patient's (or does not exist) is "not found", and the attempt is audited, as for every other lookup. */
const missing = (what: string, entityType: string, id: string) => deniedNotFound(what, { entityType, entityId: id, reason: 'not_found_or_other_patient' })

/**
 * The patient's longitudinal history (conditions, medicines, results) and the
 * earlier consultations that go with it. Doctors and nurses read; doctors
 * write. Entries are never deleted or edited: a mistake is marked as entered
 * in error with a reason, and the change is recorded and audited. Audit
 * details carry ids and statuses, never the clinical text.
 */
export function registerHistoryRoutes(app: FastifyInstance, { db, dataOrigin }: { db: Db; dataOrigin: RecordOrigin }) {
  const enteredBy = alias(users, 'entered_by_user')
  const byName = async (id: string) => (await db.select({ n: users.fullName }).from(users).where(eq(users.id, id)))[0]?.n ?? null

  app.get('/api/patients/:id/history', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const p = await getPatientOr404(db, me.facilityId, id)
    const history = await loadHistory(db, p)
    await audit(db, req, {
      action: 'patient.history_read',
      entityType: 'patient',
      entityId: id,
      patientId: id,
      details: { conditions: history.conditions.length, medications: history.medications.length, investigations: history.investigations.length, consultations: history.consultations.length },
    })
    return history
  })

  // ---- Conditions ----
  app.post('/api/patients/:id/conditions', { config: { permission: 'history:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const body = parse(ConditionInput, req.body)
    const patient = await getPatientOr404(db, me.facilityId, id)
    const origin = entryOrigin(patient.dataOrigin, dataOrigin)
    const today = await facilityToday(db, me.facilityId)
    const [year, month] = today.split('-').map(Number) as [number, number]
    if (body.sinceYear > year || (body.sinceYear === year && (body.sinceMonth ?? 1) > month)) throw badRequest('Some fields are invalid', [{ path: 'sinceYear', message: 'Cannot be in the future' }])
    try {
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.insert(patientConditions).values(conditionValues(id, me.id, origin, body)).returning()
        await recordHistoryEvent(tx, { patientId: id, entityType: 'condition', entityId: r!.id, action: 'created', toStatus: r!.status, actorUserId: me.id })
        await audit(tx, req, { action: 'history.condition_add', entityType: 'condition', entityId: r!.id, patientId: id, details: { status: r!.status } })
        return r!
      })
      return reply.code(201).send(toCondition(row, me.fullName) satisfies Condition)
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('This condition is already on the list.', 'already_recorded')
      throw e
    }
  })

  app.post('/api/patients/:id/conditions/:subId/status', { config: { permission: 'history:write' } }, async (req) => {
    const me = currentUser(req)
    const { id, subId } = parse(SubParams, req.params)
    const body = parse(ConditionStatusChange, req.body)
    await getPatientOr404(db, me.facilityId, id)
    const row = await db
      .transaction(async (tx) => {
      const [old] = await tx.select().from(patientConditions).where(and(eq(patientConditions.id, subId), eq(patientConditions.patientId, id))).for('update')
      if (!old) throw missing('Condition', 'condition', subId)
      if (old.status === 'entered_in_error') throw conflict('This entry was marked as entered in error and cannot be changed.', 'history_entry_locked')
      if (old.status === body.status) throw conflict('The condition already has this status.', 'no_change')
      const [r] = await tx
        .update(patientConditions)
        .set({ status: body.status, statusReason: body.status === 'entered_in_error' ? (body.reason ?? '').trim() : null, updatedAt: sql`now()` })
        .where(eq(patientConditions.id, subId))
        .returning()
      await recordHistoryEvent(tx, { patientId: id, entityType: 'condition', entityId: subId, action: 'status_changed', fromStatus: old.status, toStatus: body.status, reason: body.status === 'entered_in_error' ? (body.reason ?? '').trim() : null, actorUserId: me.id })
      await audit(tx, req, { action: 'history.condition_status', entityType: 'condition', entityId: subId, patientId: id, details: { from: old.status, to: body.status } })
      return r!
      })
      .catch((e: unknown) => {
        if (pgCode(e) === '23505') throw conflict('Another entry for this condition is already on the list as open. Resolve or correct that one first.', 'already_recorded')
        throw e
      })
    const [by] = await db.select({ n: enteredBy.fullName }).from(enteredBy).where(eq(enteredBy.id, row.enteredBy))
    return toCondition(row, by?.n ?? null)
  })

  // ---- Medicines ----
  app.post('/api/patients/:id/medications', { config: { permission: 'history:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const body = parse(MedicationInput, req.body)
    const patient = await getPatientOr404(db, me.facilityId, id)
    const origin = entryOrigin(patient.dataOrigin, dataOrigin)
    const today = await facilityToday(db, me.facilityId)
    if (body.startedOn && body.startedOn > today) throw futureDate('startedOn')
    try {
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.insert(patientMedications).values(medicationValues(id, me.id, origin, body)).returning()
        await recordHistoryEvent(tx, { patientId: id, entityType: 'medication', entityId: r!.id, action: 'created', toStatus: r!.status, actorUserId: me.id })
        await audit(tx, req, { action: 'history.medication_add', entityType: 'medication', entityId: r!.id, patientId: id, details: { status: r!.status } })
        return r!
      })
      return reply.code(201).send(toMedication(row, me.fullName) satisfies Medication)
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('This medicine, with the same dose and frequency, is already on the current list.', 'already_recorded')
      throw e
    }
  })

  app.post('/api/patients/:id/medications/:subId/status', { config: { permission: 'history:write' } }, async (req) => {
    const me = currentUser(req)
    const { id, subId } = parse(SubParams, req.params)
    const body = parse(MedicationStatusChange, req.body)
    await getPatientOr404(db, me.facilityId, id)
    const today = await facilityToday(db, me.facilityId)
    if (body.stoppedOn && body.stoppedOn > today) throw futureDate('stoppedOn')
    const row = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(patientMedications).where(and(eq(patientMedications.id, subId), eq(patientMedications.patientId, id))).for('update')
      if (!old) throw missing('Medicine', 'medication', subId)
      if (old.status === 'entered_in_error') throw conflict('This entry was marked as entered in error and cannot be changed.', 'history_entry_locked')
      if (old.status === 'stopped' && body.status === 'stopped') throw conflict('The medicine is already stopped.', 'no_change')
      if (body.status === 'stopped' && old.startedOn && body.stoppedOn && body.stoppedOn < old.startedOn) throw badRequest('Some fields are invalid', [{ path: 'stoppedOn', message: 'Cannot be before it was started' }])
      const [r] = await tx
        .update(patientMedications)
        .set({ status: body.status, statusReason: body.reason.trim(), stoppedOn: body.status === 'stopped' ? (body.stoppedOn ?? today) : old.stoppedOn, updatedAt: sql`now()` })
        .where(eq(patientMedications.id, subId))
        .returning()
      await recordHistoryEvent(tx, { patientId: id, entityType: 'medication', entityId: subId, action: 'status_changed', fromStatus: old.status, toStatus: body.status, reason: body.reason.trim(), actorUserId: me.id })
      await audit(tx, req, { action: 'history.medication_status', entityType: 'medication', entityId: subId, patientId: id, details: { from: old.status, to: body.status } })
      return r!
    })
    const [by] = await db.select({ n: enteredBy.fullName }).from(enteredBy).where(eq(enteredBy.id, row.enteredBy))
    return toMedication(row, by?.n ?? null)
  })

  // ---- Investigation results ----
  app.post('/api/patients/:id/investigations', { config: { permission: 'history:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const body = parse(InvestigationInput, req.body)
    const patient = await getPatientOr404(db, me.facilityId, id)
    const origin = entryOrigin(patient.dataOrigin, dataOrigin)
    const today = await facilityToday(db, me.facilityId)
    if (body.collectedOn > today) throw futureDate('collectedOn')
    if (body.resultedOn && body.resultedOn > today) throw futureDate('resultedOn')
    try {
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.insert(investigationResults).values(investigationValues(id, me.id, origin, body)).returning()
        await recordHistoryEvent(tx, { patientId: id, entityType: 'investigation', entityId: r!.id, action: 'created', toStatus: r!.status, actorUserId: me.id })
        await audit(tx, req, { action: 'history.investigation_add', entityType: 'investigation', entityId: r!.id, patientId: id, details: { status: r!.status } })
        return r!
      })
      return reply.code(201).send(toInvestigation(row, me.fullName) satisfies Investigation)
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('This result is already recorded.', 'already_recorded')
      throw e
    }
  })

  app.post('/api/patients/:id/investigations/:subId/status', { config: { permission: 'history:write' } }, async (req) => {
    const me = currentUser(req)
    const { id, subId } = parse(SubParams, req.params)
    const body = parse(InvestigationStatusChange, req.body)
    await getPatientOr404(db, me.facilityId, id)
    const row = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(investigationResults).where(and(eq(investigationResults.id, subId), eq(investigationResults.patientId, id))).for('update')
      if (!old) throw missing('Result', 'investigation', subId)
      if (old.status === 'entered_in_error') throw conflict('This entry was marked as entered in error and cannot be changed.', 'history_entry_locked')
      const [r] = await tx.update(investigationResults).set({ status: 'entered_in_error', statusReason: body.reason.trim(), updatedAt: sql`now()` }).where(eq(investigationResults.id, subId)).returning()
      await recordHistoryEvent(tx, { patientId: id, entityType: 'investigation', entityId: subId, action: 'status_changed', fromStatus: old.status, toStatus: 'entered_in_error', reason: body.reason.trim(), actorUserId: me.id })
      await audit(tx, req, { action: 'history.investigation_status', entityType: 'investigation', entityId: subId, patientId: id, details: { from: old.status, to: 'entered_in_error' } })
      return r!
    })
    return toInvestigation(row, await byName(row.enteredBy))
  })
}
