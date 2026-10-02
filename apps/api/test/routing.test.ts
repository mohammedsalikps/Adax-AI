import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PatientDetail, RoutingResponse, Visit } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { suggestRouting, type RoutingInput } from '../src/routing/engine.ts'
import { CONFIG_DIR, loadAppSettings, RoutingRulesSource } from '../src/settings/load.ts'
import { AppSettings, RoutingRules } from '../src/settings/schema.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient } from './helpers.ts'

const rules = new RoutingRulesSource().current()
const base: RoutingInput = {
  ageYears: 40,
  reasonForVisit: 'Fever for two days',
  phone: '9840012345',
  currentPriority: 'normal',
  vitals: [
    { kind: 'temperature', value: 38 },
    { kind: 'heart_rate', value: 90 },
    { kind: 'systolic_bp', value: 120 },
    { kind: 'spo2', value: 97 },
  ],
  departments: [
    { id: '00000000-0000-4000-8000-000000000001', code: 'GEN', name: 'General Medicine' },
    { id: '00000000-0000-4000-8000-000000000002', code: 'PED', name: 'Paediatrics' },
  ],
  doctors: [
    { id: '00000000-0000-4000-8000-0000000000a1', fullName: 'Dr B', departmentId: '00000000-0000-4000-8000-000000000001', load: 3 },
    { id: '00000000-0000-4000-8000-0000000000a2', fullName: 'Dr A', departmentId: '00000000-0000-4000-8000-000000000001', load: 1 },
  ],
}

describe('settings files', () => {
  it('the committed YAML files are valid and contain no secrets', () => {
    expect(() => loadAppSettings()).not.toThrow()
    expect(RoutingRules.safeParse(rules).success).toBe(true)
    for (const f of ['adaxai.yaml', 'routing.yaml']) expect(fs.readFileSync(path.join(CONFIG_DIR, f), 'utf8')).not.toMatch(/sk-ant-|api[_-]?key\s*:/i)
  })

  it('rejects unknown or invalid settings with a message naming them', () => {
    const good = loadAppSettings()
    expect(AppSettings.safeParse({ ...good, extra: 1 }).success).toBe(false)
    const bad = AppSettings.safeParse({ ...good, ai: { ...good.ai, stt: { ...good.ai.stt, liveChunkSeconds: 1 } } })
    expect(bad.success).toBe(false)
    expect(bad.error!.issues[0]!.path.join('.')).toBe('ai.stt.liveChunkSeconds')
  })

  it('routing rules reload at runtime; an invalid edit keeps the last valid rules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaxai-routing-'))
    const file = path.join(dir, 'routing.yaml')
    const text = fs.readFileSync(path.join(CONFIG_DIR, 'routing.yaml'), 'utf8')
    fs.writeFileSync(file, text)
    const errors: string[] = []
    const src = new RoutingRulesSource(file, (m) => errors.push(m))
    expect(src.current().version).toBe('routing-rules-v1')
    const later = new Date(Date.now() + 5000)
    fs.writeFileSync(file, text.replace('version: routing-rules-v1', 'version: routing-rules-v2'))
    fs.utimesSync(file, later, later)
    expect(src.current().version).toBe('routing-rules-v2')
    fs.writeFileSync(file, 'version: [broken')
    const evenLater = new Date(Date.now() + 10000)
    fs.utimesSync(file, evenLater, evenLater)
    expect(src.current().version).toBe('routing-rules-v2')
    expect(src.lastError).toMatch(/routing\.yaml/)
    expect(errors).toHaveLength(1)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('routing engine (deterministic rules)', () => {
  it('suggests the default department and the least busy doctor, with a reason for each part', () => {
    const out = suggestRouting(rules, base)
    expect(out).toMatchObject({ departmentCode: 'GEN', priority: 'normal', doctorName: 'Dr A', redFlags: [], missingIntake: [] })
    expect(out.reasons.map((r) => r.rule)).toEqual(['default', 'priority', 'clinician'])
  })

  it('routes children to paediatrics and musculoskeletal complaints to orthopaedics (missing department reported)', () => {
    expect(suggestRouting(rules, { ...base, ageYears: 7 }).departmentCode).toBe('PED')
    const ortho = suggestRouting(rules, { ...base, reasonForVisit: 'Knee pain after a fall' })
    expect(ortho).toMatchObject({ departmentCode: 'ORTH', departmentId: null, doctorId: null })
    expect(ortho.reasons[0]!.text).toMatch(/not available/)
  })

  it('red flags from the reason for visit or critical vitals suggest urgent review with the configured instruction', () => {
    const chest = suggestRouting(rules, { ...base, reasonForVisit: 'Chest pain since morning' })
    expect(chest.priority).toBe('urgent')
    expect(chest.redFlags).toEqual([{ id: 'chest-pain', source: 'reason', matched: '“chest pain” in the reason for visit', instruction: expect.stringContaining('duty doctor') }])
    expect(suggestRouting(rules, { ...base, reasonForVisit: 'Cough, no chest pain' }).redFlags).toEqual([])
    const spo2 = suggestRouting(rules, { ...base, vitals: [...base.vitals.filter((v) => v.kind !== 'spo2'), { kind: 'spo2', value: 85 }] })
    expect(spo2.redFlags[0]).toMatchObject({ id: 'critical-spo2', source: 'vitals' })
    // Adult limits only: no vital-sign red flag for a child.
    expect(suggestRouting(rules, { ...base, ageYears: 5, vitals: [{ kind: 'spo2', value: 85 }] }).redFlags).toEqual([])
  })

  it('lists missing intake items', () => {
    expect(suggestRouting(rules, { ...base, reasonForVisit: '', vitals: [{ kind: 'temperature', value: 37 }], phone: '' }).missingIntake).toEqual(['Reason for visit', 'Heart rate', 'Systolic BP', 'SpO₂', 'Phone number'])
  })
})

describe('routing API', () => {
  const ctx = createTestApp()
  let fx: Fixture
  beforeEach(async () => {
    await resetDatabase()
    fx = await createFixture(ctx.db)
  })
  afterAll(() => ctx.close())

  async function visit(reason: string) {
    const nurse = await login(ctx.app, 't.nurse')
    const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient() })).json())
    const v = Visit.parse((await call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId: p.id, departmentId: fx.departments.ped, chiefComplaint: reason } })).json())
    return { nurse, p, v }
  }

  it('suggests, applies to the visit and records the review; a suggestion is reviewed once and never changed', async () => {
    const { nurse, v } = await visit('Chest pain and sweating')
    expect((await call(ctx.app, 'GET', `/api/visits/${v.id}/routing-suggestion`, { cookie: nurse })).json()).toEqual({ suggestion: null, rulesError: null })
    const res = await call(ctx.app, 'POST', `/api/visits/${v.id}/routing-suggestion`, { cookie: nurse })
    expect(res.statusCode).toBe(201)
    const s = RoutingResponse.parse(res.json()).suggestion!
    expect(s).toMatchObject({ status: 'pending', rulesVersion: 'routing-rules-v1', suggestion: { departmentCode: 'GEN', departmentId: fx.departments.gen, priority: 'urgent', doctorId: fx.users.doctor } })
    expect(s.suggestion.missingIntake).toContain('Temperature')

    const applied = RoutingResponse.parse((await call(ctx.app, 'POST', `/api/routing-suggestions/${s.id}/apply`, { cookie: nurse })).json()).suggestion!
    expect(applied).toMatchObject({ status: 'applied', reviewedByName: 'Test t.nurse' })
    const after = Visit.parse((await call(ctx.app, 'GET', `/api/visits/${v.id}`, { cookie: nurse })).json())
    expect(after).toMatchObject({ departmentId: fx.departments.gen, assignedDoctorId: fx.users.doctor, priority: 'urgent' })
    expect((await call(ctx.app, 'POST', `/api/routing-suggestions/${s.id}/apply`, { cookie: nurse })).json().error).toBe('already_reviewed')
    expect((await adminQuery("SELECT action FROM ai_review_actions WHERE subject_type = 'routing_suggestion'")).rows).toEqual([{ action: 'accepted' }])
    await expect(ctx.pool.query("UPDATE routing_suggestions SET suggestion = '{}'")).rejects.toMatchObject({ code: '42501' })
  })

  it('override needs a reason and leaves the visit unchanged; a new suggestion supersedes a pending one', async () => {
    const { nurse, v } = await visit('Follow-up')
    const first = RoutingResponse.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/routing-suggestion`, { cookie: nurse })).json()).suggestion!
    const second = RoutingResponse.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/routing-suggestion`, { cookie: nurse })).json()).suggestion!
    expect((await adminQuery('SELECT status FROM routing_suggestions WHERE id = $1', [first.id])).rows[0].status).toBe('superseded')
    expect((await call(ctx.app, 'POST', `/api/routing-suggestions/${second.id}/override`, { cookie: nurse, body: {} })).statusCode).toBe(400)
    const o = RoutingResponse.parse((await call(ctx.app, 'POST', `/api/routing-suggestions/${second.id}/override`, { cookie: nurse, body: { reason: 'Patient asked to see the paediatrician' } })).json()).suggestion!
    expect(o).toMatchObject({ status: 'overridden', reviewReason: 'Patient asked to see the paediatrician' })
    expect(Visit.parse((await call(ctx.app, 'GET', `/api/visits/${v.id}`, { cookie: nurse })).json()).departmentId).toBe(fx.departments.ped)
  })

  it('administrators cannot read or act on routing', async () => {
    const { v } = await visit('Fever')
    const admin = await login(ctx.app, 't.admin')
    expect((await call(ctx.app, 'POST', `/api/visits/${v.id}/routing-suggestion`, { cookie: admin })).statusCode).toBe(403)
    expect((await call(ctx.app, 'GET', `/api/visits/${v.id}/routing-suggestion`, { cookie: admin })).statusCode).toBe(403)
  })
})
