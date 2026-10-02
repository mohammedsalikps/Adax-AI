import { Encounter, PatientDetail, Visit } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient, testConfig } from './helpers.ts'

// A tiny upload limit so "too large" can be tested without big payloads.
const ctx = createTestApp({ config: { ...testConfig, maxUploadBytes: 4096 } })
let fx: Fixture
let nurse = ''
let doctor = ''
afterAll(() => ctx.close())
beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
  doctor = await login(ctx.app, 't.doctor')
})

/** Every endpoint that accepts a file, with the patient set up so the upload itself is what is tested. */
async function uploadTargets() {
  const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient() })).json())
  for (const type of ['thermal_imaging', 'clinical_photography', 'device_monitoring', 'ai_recording']) await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type, method: 'verbal' } })
  const v = Visit.parse((await call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId: p.id, departmentId: fx.departments.gen } })).json())
  const e = Encounter.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/encounter`, { cookie: doctor })).json())
  return [
    { url: `/api/patients/${p.id}/thermal`, cookie: nurse },
    { url: `/api/patients/${p.id}/images`, cookie: nurse },
    { url: `/api/patients/${p.id}/auscultations`, cookie: nurse },
    { url: `/api/encounters/${e.id}/audio`, cookie: doctor },
  ]
}

describe('upload hardening', () => {
  it('malformed, non-multipart, empty and oversized uploads get client errors, never 500', async () => {
    for (const t of await uploadTargets()) {
      const send = (headers: Record<string, string>, payload: string | Buffer) => ctx.app.inject({ method: 'POST', url: t.url, headers: { cookie: t.cookie, 'x-adaxai-csrf': '1', ...headers }, payload })
      // Line endings without CR: an invalid multipart body (this used to return 500).
      const malformed = await send({ 'content-type': 'multipart/form-data; boundary=----x' }, '------x\nContent-Disposition: form-data; name="file"; filename="a.wav"\n\nabc\n------x--\n')
      expect([t.url, malformed.statusCode, malformed.json().error]).toEqual([t.url, 400, expect.stringMatching(/malformed_upload|bad_request/)])
      const truncated = await send({ 'content-type': 'multipart/form-data; boundary=----x' }, '------x\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\nabc')
      expect([t.url, truncated.statusCode]).toEqual([t.url, 400])
      const json = await send({ 'content-type': 'application/json' }, '{"file":"x"}')
      expect([t.url, json.statusCode < 500 && json.statusCode >= 400]).toEqual([t.url, true])
      const noFile = await send({ 'content-type': 'multipart/form-data; boundary=----x' }, '------x\r\nContent-Disposition: form-data; name="site"\r\n\r\nmitral\r\n------x--\r\n')
      expect([t.url, noFile.statusCode]).toEqual([t.url, 400])
      const big = Buffer.concat([Buffer.from('------x\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'), Buffer.alloc(10_000, 1), Buffer.from('\r\n------x--\r\n')])
      const tooLarge = await send({ 'content-type': 'multipart/form-data; boundary=----x' }, big)
      expect([t.url, tooLarge.statusCode]).toEqual([t.url, 413])
    }
  })

  it('error and not-found responses carry the security headers and are not cacheable', async () => {
    const res = await call(ctx.app, 'GET', '/api/does-not-exist', { cookie: nurse })
    expect(res.statusCode).toBe(404)
    expect(res.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' })
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/patients', headers: { cookie: nurse, 'x-adaxai-csrf': '1', 'content-type': 'application/json' }, payload: '{not json' })
    expect(bad.statusCode).toBe(400)
    expect(bad.body).not.toMatch(/stack|at .*\.ts/)
  })
})
