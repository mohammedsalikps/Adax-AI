#!/usr/bin/env node
// Python thermal service helper (cross-platform, no global installs).
//
//   node scripts/thermal.mjs venv   create services/thermal/.venv and install pinned requirements
//   node scripts/thermal.mjs dev    run the FastAPI service (uvicorn, auto-reload)
//   node scripts/thermal.mjs test   pytest
//   node scripts/thermal.mjs lint   ruff check + ruff format --check

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT, loadEnv } from './lib/env.mjs'

const cfg = loadEnv()
const SERVICE_DIR = path.join(ROOT, 'services', 'thermal')
const VENV = path.join(SERVICE_DIR, '.venv')
const VENV_PY = os.platform() === 'win32' ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python')
const REQUIREMENTS = ['requirements.txt', 'requirements-dev.txt'].map((f) => path.join(SERVICE_DIR, f))
const STAMP = path.join(VENV, '.requirements.sha256')
const MIN = [3, 11]

const say = (msg) => console.log(`[thermal] ${msg}`)

function findPython() {
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON, []]]
    : os.platform() === 'win32'
      ? [['py', ['-3']], ['python', []]]
      : [['python3', []], ['python', []]]
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' })
    if (r.status !== 0) continue
    const [maj, min] = r.stdout.trim().split('.').map(Number)
    if (maj > MIN[0] || (maj === MIN[0] && min >= MIN[1])) return { cmd, pre, version: `${maj}.${min}` }
  }
  throw new Error(`Python ${MIN.join('.')}+ not found. Install it or set PYTHON to its path.`)
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: SERVICE_DIR, stdio: 'inherit', ...opts })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

function requirementsHash() {
  const h = crypto.createHash('sha256')
  for (const f of REQUIREMENTS) h.update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))
  return h.digest('hex')
}

function requireVenv() {
  if (!fs.existsSync(VENV_PY)) throw new Error('Thermal virtualenv missing. Run `npm run setup` (or `node scripts/thermal.mjs venv`).')
}

const commands = {
  async venv() {
    if (!fs.existsSync(VENV_PY)) {
      const py = findPython()
      say(`creating virtualenv with Python ${py.version} (${py.cmd})`)
      const code = await run(py.cmd, [...py.pre, '-m', 'venv', VENV])
      if (code !== 0) throw new Error(`venv creation failed (exit ${code})`)
    }
    const hash = requirementsHash()
    if (fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8') === hash) {
      say('requirements already installed')
      return 0
    }
    say('installing pinned requirements')
    const code = await run(VENV_PY, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-r', 'requirements-dev.txt'])
    if (code !== 0) throw new Error(`pip install failed (exit ${code})`)
    fs.writeFileSync(STAMP, hash)
    say('requirements installed')
    return 0
  },

  async dev() {
    requireVenv()
    return run(VENV_PY, ['-m', 'uvicorn', 'app.main:app', '--host', cfg.thermal.host, '--port', String(cfg.thermal.port), '--reload'])
  },

  async test() {
    requireVenv()
    return run(VENV_PY, ['-m', 'pytest'])
  },

  async lint() {
    requireVenv()
    const check = await run(VENV_PY, ['-m', 'ruff', 'check', '.'])
    const format = await run(VENV_PY, ['-m', 'ruff', 'format', '--check', '.'])
    return check || format
  },
}

const cmd = process.argv[2]
if (!commands[cmd]) {
  console.error(`usage: node scripts/thermal.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
try {
  process.exitCode = await commands[cmd]()
} catch (e) {
  console.error(`[thermal] ERROR: ${e.message}`)
  process.exitCode = 1
}
