import type { ChildProcess } from 'node:child_process'
import { PatientDetail, ThermalCapture } from '@adaxai/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { httpThermalService } from '../src/thermal/client.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient, type TestContext } from './helpers.ts'
import { haveThermal as haveSamples, startThermalService, uploadThermal } from './thermal-support.ts'

// Integration test: the API talks to the REAL Python thermal service, started here.
let service: ChildProcess | null = null
let ctx: TestContext
let fx: Fixture
let nurse = ''
let doctor = ''

beforeAll(async () => {
  if (!haveSamples) return
  const s = await startThermalService()
  service = s.proc
  ctx = createTestApp({ thermal: httpThermalService(s.url) })
}, 60_000)

afterAll(async () => {
  service?.kill()
  await ctx?.close()
})

beforeEach(async () => {
  if (!haveSamples) return
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
  doctor = await login(ctx.app, 't.doctor')
})

const upload = (patientId: string, name: string, cookie = nurse, data?: Buffer) => uploadThermal(ctx.app, patientId, name, cookie, data)
async function patientWithConsent() {
  const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient() })).json())
  await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'thermal_imaging', method: 'verbal' } })
  return p
}

describe.skipIf(!haveSamples)('thermal imaging (API + real thermal service)', () => {
  it('requires consent to thermal imaging', async () => {
    const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient() })).json())
    const res = await upload(p.id, 'flir_example.jpg')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('consent_required')
  })

  it('extracts and stores a radiometric image with its matrix, settings and protocol', async () => {
    const p = await patientWithConsent()
    const res = await upload(p.id, 'flir_example.jpg')
    expect(res.statusCode).toBe(201)
    const c = ThermalCapture.parse(res.json())
    expect(c).toMatchObject({ width: 240, height: 320, status: 'draft', protocol: { bodyRegion: 'Knees', roomTempC: 22 }, extractor: { name: 'flyr' }, camera: { make: 'FLIR Systems AB' } })
    expect(c.minC).toBeLessThan(c.maxC)
    expect(c.parameters.emissivity).toBeCloseTo(0.95, 2)
    const matrix = await call(ctx.app, 'GET', `/api/files/${c.matrixFileId}`, { cookie: doctor })
    expect(matrix.headers['content-type']).toBe('application/octet-stream')
    expect(matrix.rawPayload.length).toBe(240 * 320 * 4)
    const values = new Float32Array(matrix.rawPayload.buffer, matrix.rawPayload.byteOffset, 240 * 320)
    expect(Math.min(...values)).toBeCloseTo(c.minC, 1)
    expect(c.visibleFileId).not.toBeNull()
  })

  it('rejects unsupported and non-radiometric files without storing anything', async () => {
    const p = await patientWithConsent()
    const unsupported = await upload(p.id, 'zenmuse_xtr.jpg')
    expect(unsupported.statusCode).toBe(422)
    expect(unsupported.json().error).toBe('unsupported_format')
    // A JPEG with no FLIR segment (here: the start of a valid JPEG header followed by filler).
    const plain = await upload(p.id, 'photo.jpg', nurse, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]))
    expect(plain.statusCode).toBe(422)
    expect(plain.json().error).toBe('not_radiometric')
    expect((await adminQuery('SELECT count(*)::int AS n FROM files')).rows[0].n).toBe(0)
  })

  it('computes region statistics and paired differences in the thermal service', async () => {
    const p = await patientWithConsent()
    const c = ThermalCapture.parse((await upload(p.id, 'flir_example.jpg')).json())
    const rois = [
      { label: 'Left', shape: 'rect', x: 10, y: 10, width: 60, height: 60, pairWith: 'Right' },
      { label: 'Right', shape: 'ellipse', x: 150, y: 10, width: 60, height: 60 },
    ]
    const res = await call(ctx.app, 'PUT', `/api/thermal/${c.id}/rois`, { cookie: nurse, body: { rois } })
    expect(res.statusCode).toBe(200)
    const saved = ThermalCapture.parse(res.json())
    const [l, r] = saved.rois
    expect(l!.stats.pixelCount).toBe(3600)
    expect(r!.stats.pixelCount).toBeGreaterThan(2700)
    expect(r!.stats.pixelCount).toBeLessThan(2900)
    expect(saved.pairs).toEqual([{ a: 'Left', b: 'Right', meanDiff: Number((l!.stats.mean! - r!.stats.mean!).toFixed(2)), maxDiff: Number((l!.stats.max! - r!.stats.max!).toFixed(2)) }])
    const outside = await call(ctx.app, 'PUT', `/api/thermal/${c.id}/rois`, { cookie: nurse, body: { rois: [{ label: 'X', shape: 'rect', x: 200, y: 0, width: 100, height: 10 }] } })
    expect(outside.statusCode).toBe(400)
    const dup = await call(ctx.app, 'PUT', `/api/thermal/${c.id}/rois`, { cookie: nurse, body: { rois: [rois[1], rois[1]] } })
    expect(dup.statusCode).toBe(400)
  })

  it('only doctors review; a reviewed capture is frozen, also in the database', async () => {
    const p = await patientWithConsent()
    const c = ThermalCapture.parse((await upload(p.id, 'ax8.jpg')).json())
    expect((await call(ctx.app, 'POST', `/api/thermal/${c.id}/review`, { cookie: nurse, body: { decision: 'approved' } })).statusCode).toBe(403)
    expect((await call(ctx.app, 'POST', `/api/thermal/${c.id}/review`, { cookie: doctor, body: { decision: 'rejected' } })).statusCode).toBe(400)
    const approved = ThermalCapture.parse((await call(ctx.app, 'POST', `/api/thermal/${c.id}/review`, { cookie: doctor, body: { decision: 'approved', note: 'Adequate image' } })).json())
    expect(approved).toMatchObject({ status: 'approved', review: { byName: 'Test t.doctor', note: 'Adequate image' } })
    expect((await call(ctx.app, 'PUT', `/api/thermal/${c.id}/rois`, { cookie: nurse, body: { rois: [] } })).statusCode).toBe(409)
    await expect(ctx.pool.query("UPDATE thermal_captures SET status = 'draft' WHERE id = $1", [c.id])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query("INSERT INTO thermal_rois (capture_id, label, shape, x, y, width, height, stats) VALUES ($1, 'z', 'rect', 0, 0, 1, 1, '{}')", [c.id])).rejects.toMatchObject({ code: '42501' })
  })

  it('administrators cannot upload or view thermal images', async () => {
    const p = await patientWithConsent()
    const admin = await login(ctx.app, 't.admin')
    expect((await upload(p.id, 'ax8.jpg', admin)).statusCode).toBe(403)
    expect((await call(ctx.app, 'GET', `/api/patients/${p.id}/thermal`, { cookie: admin })).statusCode).toBe(403)
    void fx
  })
})
