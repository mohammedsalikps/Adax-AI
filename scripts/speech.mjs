#!/usr/bin/env node
// Local speech service helper (cross-platform, no global installs).
//
//   node scripts/speech.mjs venv     create services/speech/.venv and install pinned requirements
//   node scripts/speech.mjs model    download the pinned speech model (asks first; --yes to skip the question)
//   node scripts/speech.mjs dev      run the service on loopback (uvicorn)
//   node scripts/speech.mjs test     pytest
//   node scripts/speech.mjs lint     ruff check + ruff format --check
//
// The model is the only thing that is downloaded, only by `model`, only by a person; the service itself never uses the network.

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT, loadEnv } from './lib/env.mjs'

loadEnv()
const SERVICE_DIR = path.join(ROOT, 'services', 'speech')
const VENV = path.join(SERVICE_DIR, '.venv')
const VENV_PY = os.platform() === 'win32' ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python')
const REQUIREMENTS = ['requirements.txt', 'requirements-dev.txt'].map((f) => path.join(SERVICE_DIR, f))
const STAMP = path.join(VENV, '.requirements.sha256')
const MIN = [3, 11]
const e = process.env
const MODEL_DIR = path.resolve(ROOT, e.SPEECH_MODEL_DIR || '.data/models/faster-whisper-small')
const HOST = e.SPEECH_HOST || '127.0.0.1'
const PORT = Number.parseInt(e.SPEECH_PORT || '8002', 10)

const say = (msg) => console.log(`[speech] ${msg}`)

// The service decodes audio from outside and pip runs package build scripts: neither is given the application's secrets (database
// passwords, provider keys) that loadEnv() put into this process. Only what Python and pip need to run, and the speech settings.
const ENV_ALLOW = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|PROGRAMDATA|PROGRAMFILES.*|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_.*|PYTHON.*|PIP_.*|VIRTUAL_ENV|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|HTTPS?_PROXY|NO_PROXY|HF_.*|SPEECH_.*)$/i
const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => ENV_ALLOW.test(k))), ...extra })

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

function findPython() {
  const candidates = e.PYTHON ? [[e.PYTHON, []]] : os.platform() === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]]
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
    const child = spawn(cmd, args, { cwd: SERVICE_DIR, stdio: 'inherit', env: cleanEnv(), ...opts })
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
  if (!fs.existsSync(VENV_PY)) throw new Error('Speech virtualenv missing. Run `npm run speech:setup` (or `node scripts/speech.mjs venv`).')
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
    say('installing pinned requirements (faster-whisper, CTranslate2, PyAV, onnxruntime and their dependencies)')
    const code = await run(VENV_PY, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-r', 'requirements-dev.txt'])
    if (code !== 0) throw new Error(`pip install failed (exit ${code})`)
    fs.writeFileSync(STAMP, hash)
    say('requirements installed')
    return 0
  },

  async model() {
    requireVenv()
    return run(VENV_PY, ['-m', 'app.fetch_model', '--dest', MODEL_DIR, ...process.argv.slice(3)])
  },

  async dev() {
    // Optional in `npm run dev`: without the runtime the app says "local transcription unavailable" and everything else works.
    if (!fs.existsSync(VENV_PY)) {
      say('not installed: run `npm run speech:setup` and `npm run speech:model` to enable local transcription (the app says it is unavailable until then)')
      return 0
    }
    if (!fs.existsSync(path.join(MODEL_DIR, 'model.bin'))) say(`no model at ${path.relative(ROOT, MODEL_DIR)}: the service will report "unavailable" (run \`npm run speech:model\`)`)
    if (!LOOPBACK.has(HOST) && e.SPEECH_ALLOW_NON_LOOPBACK !== '1') throw new Error(`SPEECH_HOST=${HOST} is not a loopback address. The service has no sign-in: it listens on this computer only unless SPEECH_ALLOW_NON_LOOPBACK=1 is set on purpose.`)
    // Loopback only, no access log (a URL or timing line is harmless, but nothing about a consultation is logged anywhere), one process.
    const env = cleanEnv({ SPEECH_MODEL_DIR: MODEL_DIR, HF_HUB_OFFLINE: '1' })
    return run(VENV_PY, ['-m', 'uvicorn', 'app.main:app', '--host', HOST, '--port', String(PORT), '--no-access-log', '--log-level', 'warning'], { env })
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
  console.error(`usage: node scripts/speech.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
try {
  process.exitCode = await commands[cmd]()
} catch (err) {
  console.error(`[speech] ERROR: ${err.message}`)
  process.exitCode = 1
}
