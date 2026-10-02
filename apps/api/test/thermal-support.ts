import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { REPO_ROOT } from '../src/config.ts'
import { closedPort } from './helpers.ts'

export const SAMPLES = path.join(REPO_ROOT, 'samples', 'thermal')
export const THERMAL_DIR = path.join(REPO_ROOT, 'services', 'thermal')
export const PY = path.join(THERMAL_DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
export const haveThermal = fs.existsSync(path.join(SAMPLES, 'flir_example.jpg')) && fs.existsSync(PY)

/** Starts the REAL Python thermal service on a free port. */
export async function startThermalService(): Promise<{ url: string; proc: ChildProcess }> {
  const port = await closedPort()
  const proc = spawn(PY, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)], { cwd: THERMAL_DIR, stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${url}/health`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 200))
  }
  return { url, proc }
}

export function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = '----adaxaithermal'
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

export const sampleProtocol = { bodyRegion: 'Knees', view: 'anterior', roomTempC: 22, acclimatisationMin: 15, distanceM: 1 }

export function uploadThermal(app: FastifyInstance, patientId: string, name: string, cookie: string, data = fs.readFileSync(path.join(SAMPLES, name)), protocol: object = sampleProtocol) {
  const m = multipart({ protocol: JSON.stringify(protocol) }, { name, type: 'image/jpeg', data })
  return app.inject({ method: 'POST', url: `/api/patients/${patientId}/thermal`, headers: { ...m.headers, cookie, 'x-adaxai-csrf': '1' }, payload: m.payload })
}
