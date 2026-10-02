import type { ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PatientDetail, ThermalCapture, ThermalDatasetExport, ThermalDataSummary, ThermalFlags } from '@adaxai/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { httpThermalService } from '../src/thermal/client.ts'
import { adminQuery, call, createFixture, createTestApp, login, resetDatabase, samplePatient, type TestContext } from './helpers.ts'
import { haveThermal, PY, SAMPLES, startThermalService, uploadThermal } from './thermal-support.ts'

// Labels, experimental flags, dataset export and evaluation, against the REAL thermal service.
let service: ChildProcess | null = null
let ctx: TestContext
let nurse = ''
let doctor = ''
let doctor2 = ''
let admin = ''

beforeAll(async () => {
  if (!haveThermal) return
  const s = await startThermalService()
  service = s.proc
  ctx = createTestApp({ thermal: httpThermalService(s.url) })
}, 60_000)

afterAll(async () => {
  service?.kill()
  await ctx?.close()
})

beforeEach(async () => {
  if (!haveThermal) return
  await resetDatabase()
  await createFixture(ctx.db)
  ;[nurse, doctor, doctor2, admin] = await Promise.all(['t.nurse', 't.doctor', 't.doctor2', 't.admin'].map((u) => login(ctx.app, u)))
})

const ROIS = [
  { label: 'Left knee', shape: 'rect', x: 20, y: 100, width: 60, height: 60, pairWith: 'Right knee' },
  { label: 'Right knee', shape: 'rect', x: 150, y: 100, width: 60, height: 60 },
]

let seq = 0
async function patient(consents: string[] = ['thermal_imaging']) {
  seq++
  const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: `Lakshmi${'abcdefgh'[seq % 8]}`, phone: `98400 5555${seq % 10}` }) })).json())
  for (const type of consents) await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type, method: 'verbal' } })
  return p
}

/** Upload, regions, and (optionally) a doctor's approval. */
async function capture(patientId: string, { approve = true, data }: { approve?: boolean; data?: Buffer } = {}) {
  const c = ThermalCapture.parse((await uploadThermal(ctx.app, patientId, 'flir_example.jpg', nurse, data)).json())
  await call(ctx.app, 'PUT', `/api/thermal/${c.id}/rois`, { cookie: nurse, body: { rois: ROIS } })
  if (approve) await call(ctx.app, 'POST', `/api/thermal/${c.id}/review`, { cookie: doctor, body: { decision: 'approved' } })
  return c
}

const label = (id: string, cookie: string, body: Record<string, unknown>) => call(ctx.app, 'POST', `/api/thermal/${id}/labels`, { cookie, body: { referenceStandard: 'clinical_impression', certainty: 'probable', ...body } })

function readZip(data: Buffer): { names: string[]; manifest: Record<string, any>; readme: string } {
  const file = path.join(os.tmpdir(), `adaxai-test-${process.pid}.zip`)
  fs.writeFileSync(file, data)
  try {
    const script = 'import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({"names":z.namelist(),"manifest":json.loads(z.read("manifest.json")),"readme":z.read("README.txt").decode()}))'
    return JSON.parse(execFileSync(PY, ['-c', script, file], { encoding: 'utf8' }))
  } finally {
    fs.rmSync(file, { force: true })
  }
}

describe.skipIf(!haveThermal)('thermal data workflow (API + real thermal service)', () => {
  it('records the data origin: public sample files are recognised, other uploads take the deployment setting', async () => {
    const p = await patient()
    const sample = await capture(p.id, { approve: false })
    expect(sample.dataOrigin).toBe('public_sample')
    // Same image with trailing bytes: no longer the published sample file.
    const altered = await capture(p.id, { approve: false, data: Buffer.concat([fs.readFileSync(path.join(SAMPLES, 'flir_example.jpg')), Buffer.from('x')]) })
    expect(altered.dataOrigin).toBe('synthetic')
  })

  it('computes experimental flags on request, clearly marked as not validated', async () => {
    const p = await patient()
    const c = await capture(p.id, { approve: false })
    const res = await call(ctx.app, 'GET', `/api/thermal/${c.id}/flags`, { cookie: nurse })
    expect(res.statusCode).toBe(200)
    const f = ThermalFlags.parse(res.json())
    expect(f.validated).toBe(false)
    expect(f.disclaimer).toMatch(/Not validated/)
    expect(f.asymmetry).toHaveLength(1)
    expect(f.asymmetry[0]).toMatchObject({ a: 'Left knee', b: 'Right knee' })
    expect((await call(ctx.app, 'GET', `/api/thermal/${c.id}/flags`, { cookie: admin })).statusCode).toBe(403)
    const audit = await adminQuery("SELECT count(*)::int AS n FROM audit_events WHERE action = 'thermal.flags'")
    expect(audit.rows[0].n).toBe(1)
  })

  it('only doctors label, only approved images, one active label per doctor; labels are withdrawn, never changed', async () => {
    const p = await patient()
    const draft = await capture(p.id, { approve: false })
    expect((await label(draft.id, doctor, { scope: 'capture', code: 'no_significant_finding' })).statusCode).toBe(409)

    const c = await capture(p.id)
    expect((await label(c.id, nurse, { scope: 'capture', code: 'no_significant_finding' })).statusCode).toBe(403)
    expect((await label(c.id, doctor, { scope: 'capture', code: 'warmer_than_expected' })).statusCode).toBe(400)
    expect((await label(c.id, doctor, { scope: 'roi', roiLabel: 'Elbow', code: 'warmer_than_expected' })).statusCode).toBe(400)

    const first = await label(c.id, doctor, { scope: 'capture', code: 'inflammatory_pattern', note: 'Warm left knee' })
    expect(first.statusCode).toBe(201)
    expect((await label(c.id, doctor, { scope: 'capture', code: 'no_significant_finding' })).json().error).toBe('label_exists')
    expect((await label(c.id, doctor, { scope: 'roi', roiLabel: 'left KNEE', code: 'warmer_than_expected' })).statusCode).toBe(201)
    expect((await label(c.id, doctor2, { scope: 'capture', code: 'no_significant_finding' })).statusCode).toBe(201)

    const labelled = ThermalCapture.parse((await call(ctx.app, 'GET', `/api/thermal/${c.id}`, { cookie: nurse })).json())
    expect(labelled.labels.map((l) => [l.scope, l.roiLabel, l.code, l.labelledByName])).toEqual([
      ['capture', null, 'inflammatory_pattern', 'Test t.doctor'],
      ['roi', 'Left knee', 'warmer_than_expected', 'Test t.doctor'],
      ['capture', null, 'no_significant_finding', 'Test t.doctor2'],
    ])
    const mine = labelled.labels[0]!
    const withdraw = (cookie: string, body: object = { reason: 'Reconsidered after follow-up' }) => call(ctx.app, 'POST', `/api/thermal/${c.id}/labels/${mine.id}/withdraw`, { cookie, body })
    expect((await withdraw(doctor2)).statusCode).toBe(403)
    expect((await withdraw(doctor, {})).statusCode).toBe(400)
    const after = ThermalCapture.parse((await withdraw(doctor)).json())
    expect(after.labels[0]!.withdrawn).toMatchObject({ byName: 'Test t.doctor', reason: 'Reconsidered after follow-up' })
    expect((await withdraw(doctor)).statusCode).toBe(409)
    expect((await label(c.id, doctor, { scope: 'capture', code: 'no_significant_finding' })).statusCode).toBe(201)

    // The database enforces the same rules for the application role.
    await expect(ctx.pool.query('DELETE FROM thermal_labels WHERE id = $1', [mine.id])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query("UPDATE thermal_labels SET code = 'other_finding' WHERE id = $1", [labelled.labels[1]!.id])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query("UPDATE thermal_labels SET withdraw_reason = 'changed' WHERE id = $1", [mine.id])).rejects.toMatchObject({ code: '42501' })
    const docId = (await adminQuery("SELECT id FROM users WHERE username = 't.doctor'")).rows[0].id
    await expect(
      ctx.pool.query("INSERT INTO thermal_labels (capture_id, scope, code, reference_standard, certainty, taxonomy_version, labelled_by) VALUES ($1, 'capture', 'other_finding', 'clinical_impression', 'certain', 'v', $2)", [draft.id, docId]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('exports only approved, research-consented captures, de-identified, as a valid ZIP', async () => {
    const consenting = await patient(['thermal_imaging', 'research_use'])
    const other = await patient()
    expect((await call(ctx.app, 'POST', '/api/thermal-data/exports', { cookie: doctor })).json().error).toBe('nothing_to_export')

    const a = await capture(consenting.id)
    await capture(consenting.id)
    await capture(consenting.id, { approve: false })
    await capture(other.id)
    await label(a.id, doctor, { scope: 'capture', code: 'inflammatory_pattern', note: 'Lakshmi says it hurts' })
    await label(a.id, doctor2, { scope: 'capture', code: 'inflammatory_pattern' })
    const withdrawn = ThermalCapture.parse((await call(ctx.app, 'GET', `/api/thermal/${a.id}`, { cookie: doctor })).json()).labels[1]!
    await call(ctx.app, 'POST', `/api/thermal/${a.id}/labels/${withdrawn.id}/withdraw`, { cookie: doctor2, body: { reason: 'Wrong image' } })

    const summary = ThermalDataSummary.parse((await call(ctx.app, 'GET', '/api/thermal-data/summary', { cookie: admin })).json())
    expect(summary).toMatchObject({ captures: { draft: 1, approved: 3, rejected: 0 }, approvedWithResearchConsent: 2, labelledCaptures: 1, activeLabels: 1, labelCounts: { inflammatory_pattern: 1 }, dataOrigins: { public_sample: 4 } })

    expect((await call(ctx.app, 'POST', '/api/thermal-data/exports', { cookie: nurse })).statusCode).toBe(403)
    const res = await call(ctx.app, 'POST', '/api/thermal-data/exports', { cookie: admin })
    expect(res.statusCode).toBe(201)
    const exp = ThermalDatasetExport.parse(res.json())
    expect(exp.summary).toEqual({ captures: 2, subjects: 1, labelledCaptures: 1, dataOrigins: { public_sample: 2 }, excludedNoResearchConsent: 1 })
    expect(exp.evaluation).toBeNull()

    const dl = await call(ctx.app, 'GET', `/api/thermal-data/exports/${exp.id}/download`, { cookie: doctor })
    expect(dl.statusCode).toBe(200)
    expect(dl.headers['content-type']).toBe('application/zip')
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="adaxai-thermal-dataset-\d{4}-\d\d-\d\d\.zip"$/)
    const zip = readZip(dl.rawPayload)
    expect(zip.names).toEqual(['manifest.json', 'README.txt', 'matrices/C0001.f32', 'matrices/C0002.f32'])
    const m = zip.manifest
    expect(m).toMatchObject({ schema: 'adaxai-thermal-dataset/1', taxonomyVersion: 'thermal-labels-v1', validated: false, nonClinical: true, excluded: { approvedWithoutResearchConsent: 1 } })
    expect(m.captures.map((c: any) => [c.id, c.subject, c.ageBand, c.sex, c.dataOrigin])).toEqual([
      ['C0001', 'S001', '40-49', 'female', 'public_sample'],
      ['C0002', 'S001', '40-49', 'female', 'public_sample'],
    ])
    expect(m.captures[0].labels).toEqual([{ rater: 'R001', scope: 'capture', roi: null, code: 'inflammatory_pattern', referenceStandard: 'clinical_impression', certainty: 'probable', taxonomyVersion: 'thermal-labels-v1' }])
    expect(m.captures[0].rois.map((r: any) => r.label)).toEqual(['Left knee', 'Right knee'])
    expect(m.captures[0].protocol).toEqual({ bodyRegion: 'Knees', view: 'anterior', roomTempC: 22, acclimatisationMin: 15, distanceM: 1 })
    // No direct identifiers, internal ids, dates of birth or free text anywhere in the manifest.
    const text = JSON.stringify(m)
    for (const s of ['Lakshmi', 'Narayanan', '98400', 'ADX-', '1985', 'hurts', consenting.id, a.id, 'Test t.doctor']) expect(text).not.toContain(s)
    expect(zip.readme).toMatch(/not a validated\s+clinical dataset/i)

    // The ZIP is not reachable through the general file route.
    const fileId = (await adminQuery('SELECT file_id FROM thermal_dataset_exports WHERE id = $1', [exp.id])).rows[0].file_id
    expect((await call(ctx.app, 'GET', `/api/files/${fileId}`, { cookie: doctor })).statusCode).toBe(404)
    expect((await call(ctx.app, 'GET', `/api/thermal-data/exports/${exp.id}/download`, { cookie: nurse })).statusCode).toBe(403)
    const actions = (await adminQuery("SELECT action FROM audit_events WHERE action LIKE 'thermal.dataset%' ORDER BY occurred_at")).rows.map((r) => r.action)
    expect(actions).toEqual(['thermal.dataset_export', 'thermal.dataset_download'])
  })

  it('evaluates an export in the thermal service and stores the report, which says the data is non-clinical', async () => {
    const p = await patient(['thermal_imaging', 'research_use'])
    const c = await capture(p.id)
    await label(c.id, doctor, { scope: 'capture', code: 'no_significant_finding' })
    const exp = ThermalDatasetExport.parse((await call(ctx.app, 'POST', '/api/thermal-data/exports', { cookie: admin })).json())
    const res = await call(ctx.app, 'POST', `/api/thermal-data/exports/${exp.id}/evaluate`, { cookie: admin })
    expect(res.statusCode).toBe(200)
    const evaluated = ThermalDatasetExport.parse(res.json())
    const report = evaluated.evaluation!.report as Record<string, any>
    expect(report).toMatchObject({ validated: false, nonClinical: true, dataset: { captures: 1, reference: { negative: 1, positive: 0 } }, model: { status: 'skipped' } })
    expect(report.statements[0]).toMatch(/non-clinical/)
    expect(evaluated.evaluation!.markdown).toMatch(/^# Thermal dataset evaluation/)
    const list = (await call(ctx.app, 'GET', '/api/thermal-data/exports', { cookie: admin })).json().exports
    expect(list[0].evaluation.report.pipelineVersion).toBe('thermal-eval-v1')
    // Export records are kept: no deletion, no change except the evaluation.
    await expect(ctx.pool.query('DELETE FROM thermal_dataset_exports WHERE id = $1', [exp.id])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query("UPDATE thermal_dataset_exports SET summary = '{}' WHERE id = $1", [exp.id])).rejects.toMatchObject({ code: '42501' })
  })
})
