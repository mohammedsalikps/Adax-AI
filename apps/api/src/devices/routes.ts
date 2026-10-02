import crypto from 'node:crypto'
import path from 'node:path'
import { AssignDeviceRequest, type AuscultationRecording, AuscultationSite, type Device, DeviceInput, DeviceReadingsRequest, EndAssignmentRequest, OptionalText, UpdateDeviceRequest, VITALS } from '@adaxai/contracts'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { SessionUser } from '../auth/sessions.ts'
import type { Config } from '../config.ts'
import { type Db, pgCode } from '../db/client.ts'
import { auscultationRecordings, deviceAssignments, devices, encounters, files, observations, patients, users, visits } from '../db/schema.ts'
import { storeBytes } from '../files/storage.ts'
import { readUpload } from '../files/upload.ts'
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { activeConsent, getPatientOr404 } from '../patients/service.ts'
import type { AppSettings } from '../settings/schema.ts'

const IdParams = z.object({ id: z.uuid() })
const AUDIO_EXT: Record<string, string> = { 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/ogg': '.ogg', 'audio/webm': '.webm' }
const tokenHash = (t: string) => crypto.createHash('sha256').update(t).digest('hex')

/**
 * Device integration BOUNDARY. No wearable band or smart stethoscope has been
 * connected or tested in this build: the registry, assignment, gateway
 * ingestion API and file upload are the documented interfaces a real device
 * integration would use (docs/DEVICES.md). Device readings are stored as
 * source = device, validation = device_unverified.
 */
export function registerDeviceRoutes(app: FastifyInstance, deps: { db: Db; config: Config; settings: AppSettings }) {
  const { db, config, settings } = deps

  async function deviceOr404(me: SessionUser, id: string) {
    const d = await db.query.devices.findFirst({ where: and(eq(devices.id, id), eq(devices.facilityId, me.facilityId)) })
    if (!d) throw notFound('Device')
    return d
  }

  async function toDevices(rows: (typeof devices.$inferSelect)[]): Promise<Device[]> {
    const ids = rows.map((r) => r.id)
    const assigner = alias(users, 'assigner')
    const open = ids.length
      ? await db
          .select({ a: deviceAssignments, given: patients.givenName, family: patients.familyName, mrn: patients.mrn, by: assigner.fullName })
          .from(deviceAssignments)
          .innerJoin(patients, eq(patients.id, deviceAssignments.patientId))
          .leftJoin(assigner, eq(assigner.id, deviceAssignments.assignedBy))
          .where(and(inArray(deviceAssignments.deviceId, ids), isNull(deviceAssignments.endedAt)))
      : []
    return rows.map((d) => {
      const a = open.find((x) => x.a.deviceId === d.id)
      return {
        id: d.id,
        kind: d.kind as Device['kind'],
        label: d.label,
        manufacturer: d.manufacturer,
        model: d.model,
        serialNumber: d.serialNumber,
        status: d.status as Device['status'],
        integration: d.integration as Device['integration'],
        notes: d.notes,
        hasToken: !!d.ingestTokenHash,
        tokenCreatedAt: d.tokenCreatedAt?.toISOString() ?? null,
        assignment: a ? { id: a.a.id, patientId: a.a.patientId, patientName: [a.given, a.family].filter(Boolean).join(' '), mrn: a.mrn, assignedAt: a.a.assignedAt.toISOString(), assignedByName: a.by } : null,
        createdAt: d.createdAt.toISOString(),
      }
    })
  }

  // ---- Registry (admin) ----
  app.get('/api/devices', { config: { permission: 'devices:read' } }, async (req) => {
    const me = currentUser(req)
    const rows = await db.select().from(devices).where(eq(devices.facilityId, me.facilityId)).orderBy(devices.label)
    return { devices: await toDevices(rows) }
  })

  app.post('/api/admin/devices', { config: { permission: 'devices:manage' } }, async (req, reply) => {
    const me = currentUser(req)
    const body = parse(DeviceInput, req.body)
    try {
      const [d] = await db.insert(devices).values({ ...body, manufacturer: body.manufacturer ?? null, model: body.model ?? null, notes: body.notes ?? null, facilityId: me.facilityId, createdBy: me.id }).returning()
      await audit(db, req, { action: 'device.register', entityType: 'device', entityId: d!.id, details: { kind: body.kind, integration: body.integration } })
      return reply.code(201).send((await toDevices([d!]))[0])
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('A device with that serial number is already registered', 'serial_taken')
      throw e
    }
  })

  app.patch('/api/admin/devices/:id', { config: { permission: 'devices:manage' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(UpdateDeviceRequest, req.body)
    await deviceOr404(me, id)
    if (body.status === 'retired') {
      const open = await db.query.deviceAssignments.findFirst({ where: and(eq(deviceAssignments.deviceId, id), isNull(deviceAssignments.endedAt)) })
      if (open) throw conflict('End the device’s current assignment before retiring it', 'device_assigned')
    }
    // A retired device can no longer post readings.
    const tokenReset = body.status === 'retired' ? { ingestTokenHash: null, tokenCreatedAt: null } : {}
    const [d] = await db.update(devices).set({ ...body, ...tokenReset, updatedAt: new Date() }).where(eq(devices.id, id)).returning()
    await audit(db, req, { action: 'device.update', entityType: 'device', entityId: id, details: { changed: Object.keys(body) } })
    return (await toDevices([d!]))[0]
  })

  /** Issues a new gateway token (shown once; only its hash is stored). Replaces any previous token. */
  app.post('/api/admin/devices/:id/token', { config: { permission: 'devices:manage' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const d = await deviceOr404(me, id)
    if (d.status !== 'active' || d.integration !== 'gateway_api') throw conflict('Only active devices integrated through a gateway get a token', 'device_not_gateway')
    const token = `adxdev_${crypto.randomBytes(32).toString('base64url')}`
    await db.update(devices).set({ ingestTokenHash: tokenHash(token), tokenCreatedAt: new Date(), updatedAt: new Date() }).where(eq(devices.id, id))
    await audit(db, req, { action: 'device.token_issue', entityType: 'device', entityId: id })
    return reply.code(201).send({ token, note: 'Shown once. Store it in the gateway configuration; it cannot be retrieved later.' })
  })

  app.delete('/api/admin/devices/:id/token', { config: { permission: 'devices:manage' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await deviceOr404(me, id)
    await db.update(devices).set({ ingestTokenHash: null, tokenCreatedAt: null, updatedAt: new Date() }).where(eq(devices.id, id))
    await audit(db, req, { action: 'device.token_revoke', entityType: 'device', entityId: id })
    return { revoked: true }
  })

  // ---- Assignment (nurse, doctor) ----
  app.post('/api/devices/:id/assignments', { config: { permission: 'devices:assign' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(AssignDeviceRequest, req.body)
    const d = await deviceOr404(me, id)
    if (d.status !== 'active') throw conflict('This device is retired', 'device_retired')
    await getPatientOr404(db, me.facilityId, body.patientId)
    if (!(await activeConsent(db, body.patientId, 'device_monitoring'))) throw new HttpError(409, 'consent_required', 'Record the patient’s consent to device readings first')
    if (body.visitId) {
      const v = await db.query.visits.findFirst({ where: and(eq(visits.id, body.visitId), eq(visits.patientId, body.patientId)) })
      if (!v) throw badRequest('Some fields are invalid', [{ path: 'visitId', message: 'Not a visit of this patient' }])
    }
    try {
      const [a] = await db.insert(deviceAssignments).values({ deviceId: id, patientId: body.patientId, visitId: body.visitId ?? null, assignedBy: me.id }).returning({ id: deviceAssignments.id })
      await audit(db, req, { action: 'device.assign', entityType: 'device_assignment', entityId: a!.id, patientId: body.patientId, details: { deviceId: id } })
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('This device is already assigned. End that assignment first.', 'device_assigned')
      throw e
    }
    return reply.code(201).send((await toDevices([d]))[0])
  })

  app.post('/api/device-assignments/:id/end', { config: { permission: 'devices:assign' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const { reason } = parse(EndAssignmentRequest, req.body)
    const a = await db.query.deviceAssignments.findFirst({ where: eq(deviceAssignments.id, id) })
    if (!a) throw notFound('Assignment')
    const d = await deviceOr404(me, a.deviceId)
    if (a.endedAt) throw conflict('This assignment has already ended', 'assignment_ended')
    await db.update(deviceAssignments).set({ endedAt: new Date(), endedBy: me.id, endReason: reason }).where(and(eq(deviceAssignments.id, id), isNull(deviceAssignments.endedAt)))
    await audit(db, req, { action: 'device.unassign', entityType: 'device_assignment', entityId: id, patientId: a.patientId, details: { deviceId: d.id } })
    return (await toDevices([d]))[0]
  })

  // ---- Gateway ingestion (device token, no user session) ----
  app.post('/api/device-ingest/readings', { config: { public: true } }, async (req, reply) => {
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token) throw unauthorized('Device token required')
    const d = await db.query.devices.findFirst({ where: eq(devices.ingestTokenHash, tokenHash(token)) })
    if (!d) {
      await audit(db, req, { action: 'device.ingest', outcome: 'denied', actorUserId: null, actorRole: 'device', details: { reason: 'unknown_token' } })
      throw unauthorized('Unknown device token')
    }
    if (d.status !== 'active' || d.integration !== 'gateway_api') throw forbidden('This device may not post readings')
    const body = parse(DeviceReadingsRequest, req.body)
    const measuredAt = new Date(body.measuredAt)
    if (measuredAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('Some fields are invalid', [{ path: 'measuredAt', message: 'In the future' }])
    const a = await db.query.deviceAssignments.findFirst({ where: and(eq(deviceAssignments.deviceId, d.id), isNull(deviceAssignments.endedAt)) })
    if (!a) throw conflict('The device is not assigned to a patient; readings were not stored', 'device_unassigned')
    if (!(await activeConsent(db, a.patientId, 'device_monitoring'))) throw conflict('The patient has not consented to device readings; readings were not stored', 'consent_required')
    const ids = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(observations)
        .values(body.readings.map((r) => ({ patientId: a.patientId, visitId: a.visitId, kind: r.kind, value: r.value, unit: VITALS[r.kind].unit, measuredAt, source: 'device' as const, validationStatus: 'device_unverified', deviceId: d.id })))
        .returning({ id: observations.id })
      await audit(tx, req, { action: 'device.ingest', actorUserId: null, actorRole: 'device', entityType: 'device', entityId: d.id, patientId: a.patientId, details: { readings: body.readings.map((r) => r.kind), assignmentId: a.id } })
      return rows.map((r) => r.id)
    })
    return reply.code(201).send({ stored: ids.length, validationStatus: 'device_unverified' })
  })

  // ---- Stethoscope recordings (uploaded files) ----
  const AuscultationFields = z.object({ site: AuscultationSite, note: OptionalText(300), encounterId: z.uuid().optional(), deviceId: z.uuid().optional() })

  app.post('/api/patients/:id/auscultations', { config: { permission: 'observations:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    if (!(await activeConsent(db, id, 'device_monitoring'))) throw new HttpError(409, 'consent_required', 'Record the patient’s consent to device readings first')
    const up = await readUpload(req, 'a stethoscope recording')
    const ext = AUDIO_EXT[up.mimetype]
    if (!ext || !settings.uploads.audio.types.includes(up.mimetype)) throw badRequest('Unsupported audio format', [{ path: 'file', message: 'Use WAV, MP3, M4A, OGG or WebM audio' }])
    if (up.data.length > settings.uploads.audio.maxMb * 1024 * 1024) throw new HttpError(413, 'too_large', `Audio is larger than ${settings.uploads.audio.maxMb} MB`)
    const fields = parse(AuscultationFields, Object.fromEntries(Object.entries(up.fields).map(([k, v]) => [k, v || undefined])))
    if (fields.encounterId && !(await db.query.encounters.findFirst({ where: and(eq(encounters.id, fields.encounterId), eq(encounters.patientId, id)) }))) throw badRequest('Some fields are invalid', [{ path: 'encounterId', message: 'Not a consultation of this patient' }])
    if (fields.deviceId) {
      const d = await deviceOr404(me, fields.deviceId)
      if (d.kind !== 'smart_stethoscope') throw badRequest('Some fields are invalid', [{ path: 'deviceId', message: 'Not a stethoscope' }])
    }
    const stored = await storeBytes(config.storageDir, up.data, ext)
    const rec = await db.transaction(async (tx) => {
      const [f] = await tx
        .insert(files)
        .values({ facilityId: me.facilityId, patientId: id, encounterId: fields.encounterId ?? null, kind: 'stethoscope_audio', storageKey: stored.storageKey, originalName: path.basename(up.filename || `recording${ext}`).slice(0, 120), mimeType: up.mimetype, sizeBytes: stored.sizeBytes, sha256: stored.sha256, uploadedBy: me.id })
        .returning({ id: files.id })
      const [r] = await tx
        .insert(auscultationRecordings)
        .values({ facilityId: me.facilityId, patientId: id, encounterId: fields.encounterId ?? null, fileId: f!.id, deviceId: fields.deviceId ?? null, site: fields.site, note: fields.note ?? null, dataOrigin: config.dataOrigin, createdBy: me.id })
        .returning({ id: auscultationRecordings.id })
      await audit(tx, req, { action: 'auscultation.upload', entityType: 'auscultation_recording', entityId: r!.id, patientId: id, details: { site: fields.site, mimeType: up.mimetype, sizeBytes: stored.sizeBytes } })
      return r!.id
    })
    return reply.code(201).send((await listAuscultations(me.facilityId, id)).find((x) => x.id === rec))
  })

  async function listAuscultations(facilityId: string, patientId: string): Promise<AuscultationRecording[]> {
    const rows = await db
      .select({ r: auscultationRecordings, f: files, by: users.fullName, dev: devices.label })
      .from(auscultationRecordings)
      .innerJoin(files, eq(files.id, auscultationRecordings.fileId))
      .leftJoin(users, eq(users.id, auscultationRecordings.createdBy))
      .leftJoin(devices, eq(devices.id, auscultationRecordings.deviceId))
      .where(and(eq(auscultationRecordings.patientId, patientId), eq(auscultationRecordings.facilityId, facilityId)))
      .orderBy(desc(auscultationRecordings.createdAt))
    return rows.map(({ r, f, by, dev }) => ({
      id: r.id,
      patientId: r.patientId,
      encounterId: r.encounterId,
      fileId: r.fileId,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      site: r.site as AuscultationRecording['site'],
      note: r.note,
      device: r.deviceId && dev ? { id: r.deviceId, label: dev } : null,
      dataOrigin: r.dataOrigin,
      createdAt: r.createdAt.toISOString(),
      createdByName: by,
    }))
  }

  app.get('/api/patients/:id/auscultations', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    await audit(db, req, { action: 'auscultation.list', entityType: 'patient', entityId: id, patientId: id })
    return { recordings: await listAuscultations(me.facilityId, id) }
  })
}
