import type { ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ClinicalImage, PatientDetail } from '@adaxai/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AiProviderError, type ImageDescriber, type ImageDescription } from '../src/ai/providers.ts'
import { httpThermalService } from '../src/thermal/client.ts'
import { adminQuery, call, createFixture, createTestApp, login, resetDatabase, samplePatient, type TestContext } from './helpers.ts'
import { haveThermal, multipart, SAMPLES, startThermalService } from './thermal-support.ts'

// The image service is the REAL Python service; the AI describer is a test double.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

class FakeDescriber implements ImageDescriber {
  readonly provider = 'fake'
  readonly model = 'fake-vision'
  readonly promptVersion = 'image-describe-v1'
  seen: Buffer[] = []
  failNext = false
  quality: ImageDescription['quality'] = 'limited'
  async describe(image: Buffer) {
    this.seen.push(image)
    if (this.failNext) {
      this.failNext = false
      throw new AiProviderError('unreachable', 'The AI service could not be reached.', true)
    }
    return { result: { quality: this.quality, qualityReason: 'Test.', observations: [{ text: 'Uniform colour.', location: 'centre', confidence: 'low' as const }], limitations: ['Test double'], summary: 'Test description.' }, model: 'fake-vision', inputTokens: 1, outputTokens: 1, requestId: null }
  }
}

let service: ChildProcess | null = null
let withAi: TestContext
let noKeys: TestContext
const describer = new FakeDescriber()
let nurse = ''
let doctor = ''

beforeAll(async () => {
  if (!haveThermal) return
  const s = await startThermalService()
  service = s.proc
  withAi = createTestApp({ thermal: httpThermalService(s.url), ai: { drafter: null, transcriber: null, describer, reasons: { llm: null, stt: null } } })
  noKeys = createTestApp({ thermal: httpThermalService(s.url) })
}, 60_000)
afterAll(async () => {
  service?.kill()
  await withAi?.close()
  await noKeys?.close()
})
beforeEach(async () => {
  if (!haveThermal) return
  await resetDatabase()
  await createFixture(withAi.db)
  nurse = await login(withAi.app, 't.nurse')
  doctor = await login(withAi.app, 't.doctor')
  describer.seen = []
  describer.failNext = false
  describer.quality = 'limited'
})

let seq = 0
async function patient(consents: string[]) {
  seq++
  const p = PatientDetail.parse((await call(withAi.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: `Image${'abcdefgh'[seq % 8]}`, phone: `98400 6666${seq % 10}` }) })).json())
  for (const type of consents) await call(withAi.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type, method: 'verbal' } })
  return p
}
function upload(ctx: TestContext, patientId: string, cookie: string, data: Buffer, name = 'wound.jpg', fields: Record<string, string> = { imageType: 'wound_photo', bodySite: 'Left shin' }) {
  const m = multipart(fields, { name, type: 'application/octet-stream', data })
  return ctx.app.inject({ method: 'POST', url: `/api/patients/${patientId}/images`, headers: { ...m.headers, cookie, 'x-adaxai-csrf': '1' }, payload: m.payload })
}
const photo = () => fs.readFileSync(path.join(SAMPLES, 'flir_example.jpg'))

describe.skipIf(!haveThermal)('clinical photographs', () => {
  it('needs consent; keeps the original unchanged and serves a metadata-free preview', async () => {
    const none = await patient([])
    expect((await upload(withAi, none.id, nurse, photo())).json().error).toBe('consent_required')
    const p = await patient(['clinical_photography'])
    const res = await upload(withAi, p.id, nurse, photo())
    expect(res.statusCode).toBe(201)
    const img = ClinicalImage.parse(res.json())
    expect(img).toMatchObject({ imageType: 'wound_photo', bodySite: 'Left shin', source: 'upload', dataOrigin: 'synthetic', metadata: { format: 'JPEG', hadExif: true, originalName: 'wound.jpg' } })
    const original = await call(withAi.app, 'GET', `/api/files/${img.fileId}`, { cookie: doctor })
    expect(crypto.createHash('sha256').update(original.rawPayload).digest('hex')).toBe(crypto.createHash('sha256').update(photo()).digest('hex'))
    const preview = await call(withAi.app, 'GET', `/api/files/${img.previewFileId}`, { cookie: doctor })
    expect(preview.headers['content-type']).toBe('image/jpeg')
    expect(preview.rawPayload.includes(Buffer.from('Exif'))).toBe(false)
    const png = await upload(withAi, p.id, nurse, PNG_1PX, 'skin.png', { imageType: 'skin_photo' })
    expect(ClinicalImage.parse(png.json()).metadata.format).toBe('PNG')
    const list = (await call(withAi.app, 'GET', `/api/patients/${p.id}/images`, { cookie: nurse })).json().images
    expect(list).toHaveLength(2)
  })

  it('rejects unsupported formats and invalid fields without storing anything', async () => {
    const p = await patient(['clinical_photography'])
    const gif = await upload(withAi, p.id, nurse, GIF_1PX, 'x.gif')
    expect(gif.statusCode).toBe(422)
    expect(gif.json().error).toBe('unsupported_format')
    const dicom = await upload(withAi, p.id, nurse, Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.alloc(64)]), 'scan.dcm')
    expect(dicom.json().message).toMatch(/DICOM files are not supported/)
    expect((await upload(withAi, p.id, nurse, PNG_1PX, 'a.png', { imageType: 'x-ray' })).statusCode).toBe(400)
    expect((await adminQuery("SELECT count(*)::int AS n FROM files WHERE kind LIKE 'clinical_image%'")).rows[0].n).toBe(0)
  })

  it('AI description: unavailable without a provider; needs its own consent; sends only the preview; review is required', async () => {
    const p = await patient(['clinical_photography'])
    const img = ClinicalImage.parse((await upload(withAi, p.id, nurse, photo())).json())
    const unavailable = await call(noKeys.app, 'POST', `/api/images/${img.id}/analyze`, { cookie: await login(noKeys.app, 't.doctor') })
    expect(unavailable.json().error).toBe('consent_required')
    await call(withAi.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_image_analysis', method: 'verbal' } })
    const noProvider = await call(noKeys.app, 'POST', `/api/images/${img.id}/analyze`, { cookie: await login(noKeys.app, 't.doctor') })
    expect(noProvider.statusCode).toBe(503)
    expect(noProvider.json().message).toMatch(/not configured/)
    expect((await call(withAi.app, 'POST', `/api/images/${img.id}/analyze`, { cookie: nurse })).statusCode).toBe(403)

    const res = await call(withAi.app, 'POST', `/api/images/${img.id}/analyze`, { cookie: doctor, body: {} })
    expect(res.statusCode).toBe(201)
    const a = ClinicalImage.parse(res.json().image).analyses[0]!
    expect(a).toMatchObject({ status: 'pending', producedBy: { provider: 'fake', model: 'fake-vision', version: 'image-describe-v1' }, result: { summary: 'Test description.' } })
    // The provider received the preview (no EXIF), not the original.
    expect(describer.seen[0]!.includes(Buffer.from('Exif'))).toBe(false)
    expect(describer.seen[0]!.equals(photo())).toBe(false)
    const ev = (await adminQuery('SELECT source_type, provenance FROM ai_evidence WHERE subject_id = $1', [a.id])).rows
    expect(ev).toEqual([{ source_type: 'clinical_image', provenance: 'ai_generated' }])

    // Unreviewed AI output is for the doctor who reviews it: nurses do not see it yet.
    const nurseView = (await call(withAi.app, 'GET', `/api/patients/${p.id}/images`, { cookie: nurse })).json().images[0]
    expect(nurseView.analyses).toEqual([])
    const reviewed = await call(withAi.app, 'POST', `/api/ai-review/image_analysis/${a.id}`, { cookie: doctor, body: { action: 'edited', text: 'Shallow wound, clean edges.' } })
    expect((await call(withAi.app, 'GET', `/api/patients/${p.id}/images`, { cookie: nurse })).json().images[0].analyses).toHaveLength(1)
    expect(reviewed.json().item).toMatchObject({ type: 'image_analysis', section: 'examination', finalText: 'Shallow wound, clean edges.' })
    await expect(withAi.pool.query("UPDATE image_analyses SET result = '{}' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: '42501' })
    await expect(withAi.pool.query('DELETE FROM clinical_images')).rejects.toMatchObject({ code: '42501' })
  })

  it('an inadequate image needs confirmation to accept; a failed description can be retried', async () => {
    const p = await patient(['clinical_photography', 'ai_image_analysis'])
    const img = ClinicalImage.parse((await upload(withAi, p.id, nurse, photo())).json())
    describer.failNext = true
    const failed = await call(withAi.app, 'POST', `/api/images/${img.id}/analyze`, { cookie: doctor, body: {} })
    expect(failed.statusCode).toBe(502)
    const jobs = (await call(withAi.app, 'GET', `/api/images/${img.id}/jobs`, { cookie: doctor })).json().jobs
    expect(jobs[0]).toMatchObject({ status: 'failed', retryable: true })
    describer.quality = 'inadequate'
    expect((await call(withAi.app, 'POST', `/api/ai-jobs/${jobs[0].id}/retry`, { cookie: doctor })).json().job.status).toBe('succeeded')
    const a = ClinicalImage.parse((await call(withAi.app, 'GET', `/api/patients/${p.id}/images`, { cookie: doctor })).json().images[0]).analyses[0]!
    expect((await call(withAi.app, 'POST', `/api/ai-review/image_analysis/${a.id}`, { cookie: doctor, body: { action: 'accepted' } })).json().error).toBe('confirmation_required')
    expect((await call(withAi.app, 'POST', `/api/ai-review/image_analysis/${a.id}`, { cookie: doctor, body: { action: 'accepted', confirmFlags: true } })).statusCode).toBe(200)
  })

  it('administrators and patients cannot reach clinical images', async () => {
    const p = await patient(['clinical_photography'])
    const img = ClinicalImage.parse((await upload(withAi, p.id, nurse, photo())).json())
    const admin = await login(withAi.app, 't.admin')
    expect((await call(withAi.app, 'GET', `/api/patients/${p.id}/images`, { cookie: admin })).statusCode).toBe(403)
    expect((await call(withAi.app, 'GET', `/api/files/${img.fileId}`, { cookie: admin })).statusCode).toBe(403)
    expect((await upload(withAi, p.id, admin, photo())).statusCode).toBe(403)
  })
})
