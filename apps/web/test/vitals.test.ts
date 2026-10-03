// Unit tests (node --test) of the pure logic behind the consultation banner: which reading of each kind counts as the latest (a visit can
// hold a re-check), what is "outside the reference range" from that, and the facility's clock for walk-in times. No browser, no server.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Observation } from '@adaxai/contracts'
import { clockHHMM } from '../src/lib/appointments.ts'
import { latestPerKind, vitalsStatus } from '../src/lib/vitals.ts'

let n = 0
const reading = (kind: Observation['kind'], value: number, minutesAgo: number, over: Partial<Observation> = {}): Observation =>
  ({ id: `o${n++}`, kind, value, unit: '', flag: 'normal', source: 'manual', validationStatus: 'manual_entry', measuredAt: new Date(Date.UTC(2026, 9, 3, 10, 0) - minutesAgo * 60_000).toISOString(), ...over }) as Observation

test('only the newest reading of each kind counts, however the list is ordered', () => {
  const list = [reading('systolic_bp', 128, 10), reading('systolic_bp', 170, 40, { flag: 'high' }), reading('heart_rate', 72, 40)]
  for (const ordered of [list, [...list].reverse()]) {
    const latest = latestPerKind(ordered)
    assert.equal(latest.length, 2)
    assert.equal(latest.find((o) => o.kind === 'systolic_bp')!.value, 128)
  }
})

test('a re-check that is normal clears an earlier high reading from the status; a high latest reading is named once', () => {
  const rechecked = vitalsStatus([reading('systolic_bp', 170, 40, { flag: 'high' }), reading('diastolic_bp', 100, 40, { flag: 'high' }), reading('systolic_bp', 122, 10), reading('diastolic_bp', 80, 10)])
  assert.deepEqual({ total: rechecked.total, outside: rechecked.outside.length, flagged: rechecked.flagged }, { total: 2, outside: 0, flagged: true })
  const high = vitalsStatus([reading('systolic_bp', 182, 5, { flag: 'high' }), reading('systolic_bp', 150, 30, { flag: 'high' }), reading('spo2', 97, 5)])
  assert.deepEqual(high.outside.map((o) => o.value), [182])
})

test('readings without a reference range are not flagged, and device readings are counted', () => {
  const children = vitalsStatus([reading('heart_rate', 110, 5, { flag: null }), reading('temperature', 37.1, 5, { flag: null, source: 'device' })])
  assert.deepEqual({ total: children.total, flagged: children.flagged, fromDevice: children.fromDevice }, { total: 2, flagged: false, fromDevice: 1 })
  assert.deepEqual(vitalsStatus([]), { total: 0, outside: [], flagged: false, fromDevice: 0 })
})

test('walk-in times are read on the facility clock, not the browser’s', () => {
  const instant = '2026-10-03T04:00:00.000Z'
  assert.equal(clockHHMM(instant, 'Asia/Kolkata'), '09:30')
  assert.equal(clockHHMM(instant, 'UTC'), '04:00')
  assert.equal(clockHHMM(instant, 'America/New_York'), '00:00')
})
