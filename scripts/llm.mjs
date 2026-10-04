#!/usr/bin/env node
// Local language-model runtime helper (cross-platform, no global installs).
//
//   node scripts/llm.mjs setup [--yes]   download the pinned llama.cpp runtime and model into .data/llm (asks first; every file is hash-checked)
//   node scripts/llm.mjs dev             run llama-server on loopback with a per-install secret (--dry-run: print what would be run, start nothing)
//   node scripts/llm.mjs status          what is installed and verified
//   node scripts/llm.mjs verify          re-check the hashes of what is installed
//
// Nothing here runs unless a person runs it. The runtime and the model are the only things downloaded, only by `setup`, only after the
// person has seen what, from where and how large. The pinned names, sizes and SHA-256 hashes are in services/llm/*.lock.json: a file
// that does not match is deleted and refused. The server itself never uses the network (no download flag is ever passed to it).

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ROOT, loadEnv } from './lib/env.mjs'

loadEnv()
const e = process.env
const LLM_DIR = path.resolve(ROOT, e.LLM_DIR || '.data/llm')
const LOCK_DIR = path.join(ROOT, 'services', 'llm')
const RUNTIME_LOCK = JSON.parse(fs.readFileSync(path.join(LOCK_DIR, 'runtime.lock.json'), 'utf8'))
const MODEL_LOCK = JSON.parse(fs.readFileSync(path.join(LOCK_DIR, 'models.lock.json'), 'utf8'))
const PLATFORM = `${os.platform()}-${os.arch()}`
const RUNTIME_DIR = path.join(LLM_DIR, 'runtime', RUNTIME_LOCK.release)
const MODEL_FILE = path.join(LLM_DIR, 'models', MODEL_LOCK.file.name)
const KEY_FILE = path.resolve(ROOT, e.LLM_API_KEY_FILE || path.join(LLM_DIR, 'api-key'))
const STAMP = path.join(LLM_DIR, 'verified.json')
const HOST = e.LLM_HOST || '127.0.0.1'
const PORT = Number.parseInt(e.LLM_PORT || '8081', 10)
const CTX = Number.parseInt(e.LLM_CTX || '8192', 10)
const THREADS = e.LLM_THREADS ? Number.parseInt(e.LLM_THREADS, 10) : null
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

const say = (msg) => console.log(`[llm] ${msg}`)
const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`)

// The server answers requests that carry patients' records: it is not given the application's secrets (database passwords, provider keys)
// that loadEnv() put into this process, only what a program needs to run, the LLM settings and the secret it must check requests against.
const ENV_ALLOW = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|PROGRAMDATA|PROGRAMFILES.*|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_.*|LLM_(HOST|PORT|CTX|THREADS|DIR))$/i
const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => ENV_ALLOW.test(k))), ...extra })

function runtimeAsset() {
  const asset = RUNTIME_LOCK.assets[PLATFORM]
  if (!asset) throw new Error(`No pinned llama.cpp runtime for ${PLATFORM}. Pinned: ${Object.keys(RUNTIME_LOCK.assets).join(', ')}. To add one, download it, check its hash against the release page and add it to services/llm/runtime.lock.json.`)
  return asset
}

const serverExe = () => path.join(RUNTIME_DIR, runtimeAsset().server)

async function sha256File(file) {
  const h = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), h)
  return h.digest('hex')
}

/** Streams `url` to `dest` (resuming a partial download), verifies size and SHA-256, and deletes the file if either is wrong. */
async function download(url, dest, { bytes, sha256 }, label) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0
  say(`downloading ${label} (${mb(bytes)}) from ${new URL(url).host}${have ? `, resuming at ${mb(have)}` : ''}`)
  const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow' })
  if (!(res.ok && res.body)) throw new Error(`download failed: HTTP ${res.status}`)
  const resumed = res.status === 206 && have > 0
  const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' })
  let done = resumed ? have : 0
  let lastShown = Date.now()
  const source = Readable.fromWeb(res.body)
  source.on('data', (chunk) => {
    done += chunk.length
    if (Date.now() - lastShown > 10_000) {
      lastShown = Date.now()
      say(`  ${((done / bytes) * 100).toFixed(0)} % (${mb(done)})`)
    }
  })
  await pipeline(source, out)
  const size = fs.statSync(part).size
  if (size !== bytes) {
    fs.rmSync(part, { force: true })
    throw new Error(`${label}: expected ${bytes} bytes, got ${size}; the partial file was removed`)
  }
  const digest = await sha256File(part)
  if (digest !== sha256) {
    fs.rmSync(part, { force: true })
    throw new Error(`${label}: SHA-256 mismatch (expected ${sha256}, got ${digest}); the file was removed and not used`)
  }
  fs.renameSync(part, dest)
  say(`${label}: size and SHA-256 verified`)
}

function unzip(archive, dest) {
  fs.mkdirSync(dest, { recursive: true })
  // bsdtar (Windows 10+, macOS) reads zip as well as tar. On Windows the one in System32 is used by its full path: a GNU tar found first on PATH
  // (Git for Windows) cannot read zip. Expand-Archive is the fallback.
  const bsdtar = os.platform() === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  let r = fs.existsSync(bsdtar) || os.platform() !== 'win32' ? spawnSync(bsdtar, ['-xf', archive, '-C', dest], { stdio: 'inherit' }) : { status: 1 }
  // The paths go in through the environment, not into the command text.
  if (r.status !== 0 && os.platform() === 'win32') r = spawnSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:LLM_ARCHIVE -DestinationPath $env:LLM_DEST -Force'], { stdio: 'inherit', env: { ...process.env, LLM_ARCHIVE: archive, LLM_DEST: dest } })
  if (r.status !== 0) throw new Error('could not extract the runtime archive')
}

function ensureApiKey() {
  if (e.LLM_API_KEY) return e.LLM_API_KEY
  if (!fs.existsSync(KEY_FILE)) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true })
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
    say(`created the per-install secret at ${path.relative(ROOT, KEY_FILE)} (git-ignored; the API reads it from there; it is never printed)`)
  }
  return fs.readFileSync(KEY_FILE, 'utf8').trim()
}

const stampKey = (file) => `${path.basename(file)}:${fs.statSync(file).size}:${Math.floor(fs.statSync(file).mtimeMs)}`

/** Hashes the model once per (size, modification time); the result is remembered so every start does not re-read 2.7 GB. */
async function verifiedModel() {
  if (!fs.existsSync(MODEL_FILE)) return false
  const stamp = fs.existsSync(STAMP) ? JSON.parse(fs.readFileSync(STAMP, 'utf8')) : {}
  const key = stampKey(MODEL_FILE)
  if (stamp.model?.key === key && stamp.model.sha256 === MODEL_LOCK.file.sha256) return true
  say('checking the model file against its pinned SHA-256 (once per file, takes a few seconds)')
  const digest = await sha256File(MODEL_FILE)
  if (digest !== MODEL_LOCK.file.sha256) throw new Error(`${path.relative(ROOT, MODEL_FILE)} does not match the pinned SHA-256 (${digest}). Remove it and run \`npm run llm:setup\`.`)
  fs.mkdirSync(LLM_DIR, { recursive: true })
  fs.writeFileSync(STAMP, JSON.stringify({ ...stamp, model: { key, sha256: digest } }))
  return true
}

const commands = {
  async setup() {
    const asset = runtimeAsset()
    const haveRuntime = fs.existsSync(serverExe())
    const haveModel = fs.existsSync(MODEL_FILE)
    if (haveRuntime && haveModel) {
      say('runtime and model are already installed')
      await verifiedModel()
      ensureApiKey()
      return 0
    }
    const wants = []
    if (!haveRuntime) wants.push(`${asset.name} (${mb(asset.bytes)}) from ${new URL(asset.url).host}, MIT licence`)
    if (!haveModel) wants.push(`${MODEL_LOCK.file.name} (${mb(MODEL_LOCK.file.bytes)}) from ${new URL(MODEL_LOCK.file.url).host}, ${MODEL_LOCK.license} licence`)
    say('about to download:')
    for (const w of wants) say(`  - ${w}`)
    say(`into ${path.relative(ROOT, LLM_DIR)} (git-ignored). Each file is checked against the SHA-256 pinned in services/llm/*.lock.json.`)
    if (!process.argv.includes('--yes')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await rl.question('[llm] continue? (y/N) ')
      rl.close()
      if (!/^y(es)?$/i.test(answer.trim())) {
        say('nothing was downloaded')
        return 1
      }
    }
    if (!haveRuntime) {
      const zip = path.join(LLM_DIR, 'downloads', asset.name)
      await download(asset.url, zip, asset, asset.name)
      unzip(zip, RUNTIME_DIR)
      if (!fs.existsSync(serverExe())) throw new Error(`${asset.server} was not found in the extracted runtime`)
      say(`runtime installed in ${path.relative(ROOT, RUNTIME_DIR)}`)
    }
    if (!haveModel) await download(MODEL_LOCK.file.url, MODEL_FILE, MODEL_LOCK.file, MODEL_LOCK.file.name)
    await verifiedModel()
    ensureApiKey()
    say('done. Start it with `npm run dev:llm` (or `npm run dev`).')
    return 0
  },

  async status() {
    say(`platform ${PLATFORM}; runtime ${RUNTIME_LOCK.release}: ${fs.existsSync(serverExe()) ? 'installed' : 'not installed'}; model ${MODEL_LOCK.file.name}: ${fs.existsSync(MODEL_FILE) ? 'present' : 'not installed'}; secret: ${fs.existsSync(KEY_FILE) || e.LLM_API_KEY ? 'set' : 'not created yet'}`)
    return 0
  },

  async verify() {
    if (!fs.existsSync(MODEL_FILE)) throw new Error('the model is not installed (run `npm run llm:setup`)')
    const digest = await sha256File(MODEL_FILE)
    say(`${MODEL_LOCK.file.name}: ${digest === MODEL_LOCK.file.sha256 ? 'SHA-256 matches the pinned value' : `MISMATCH (got ${digest})`}`)
    return digest === MODEL_LOCK.file.sha256 ? 0 : 1
  },

  async dev() {
    const dry = process.argv.includes('--dry-run')
    // Optional in `npm run dev`: without the runtime the app says "Local AI unavailable." and everything else works.
    if (!dry && (!fs.existsSync(serverExe()) || !fs.existsSync(MODEL_FILE))) {
      say('not installed: run `npm run llm:setup` to enable local consultation intelligence (the app says "Local AI unavailable." until then)')
      return 0
    }
    if (!LOOPBACK.has(HOST) && !['1', 'true'].includes(e.LLM_ALLOW_NON_LOOPBACK ?? '')) throw new Error(`LLM_HOST=${HOST} is not a loopback address. The server answers with a per-install secret but is meant for this computer only: set LLM_ALLOW_NON_LOOPBACK=true on purpose to change that.`)
    if (!dry) await verifiedModel()
    const key = dry ? '<per-install secret>' : ensureApiKey()
    const args = [
      '--model', MODEL_FILE,
      '--alias', MODEL_LOCK.alias,
      '--host', HOST,
      '--port', String(PORT),
      '--ctx-size', String(CTX),
      '--parallel', '1',
      // Every request is processed from scratch and nothing of it is kept for the next one. Measured on this runtime (b11379): with the defaults the server keeps a
      // copy of the state of each earlier prompt in memory (about 160 MB each, up to 8 GiB: the patients' records it was shown, kept for reuse), and an answer then
      // depends on what was asked before (the same prompt, asked after another one, came back with different words at temperature 0). Without it an answer is a
      // function of the prompt alone and the memory stays flat. The price is that the start every prompt shares is read again each time (about 10 seconds here).
      '--no-cache-prompt',
      '--cache-ram', '0',
      '--no-cache-idle-slots',
      '--ctx-checkpoints', '0',
      // Nothing that lets a caller read other requests' prompts or use a web page against the model, and no network access of its own.
      '--offline',
      '--no-webui',
      '--no-slots',
      // No browser page needs to read this server: only the API calls it, with the secret. A browser origin that cannot exist keeps it that way.
      '--cors-origins', 'http://adaxai-no-browser.invalid',
      '--jinja',
      // The consultation draft is a structured answer, not a reasoning trace: thinking is off at the server.
      '--reasoning', 'off',
      ...(THREADS ? ['--threads', String(THREADS)] : []),
      ...(MODEL_LOCK.serverArgs ?? []),
    ]
    if (dry) {
      // What would be run: the program, its arguments and the NAMES of the environment variables it would get (never their values).
      console.log(JSON.stringify({ exe: serverExe(), args, host: HOST, port: PORT, env: Object.keys(cleanEnv({ LLAMA_API_KEY: key })).sort() }))
      return 0
    }
    say(`starting llama-server ${RUNTIME_LOCK.release} on ${HOST}:${PORT} (model ${MODEL_LOCK.alias}, context ${CTX}); requests need the per-install secret`)
    return new Promise((resolve, reject) => {
      const child = spawn(serverExe(), args, { cwd: RUNTIME_DIR, stdio: 'inherit', env: cleanEnv({ LLAMA_API_KEY: key }) })
      child.on('error', reject)
      // The model is optional: a server that stops must not take the whole `npm run dev` stack down with it (concurrently stops everything when one
      // process exits with an error), so this says what happened and ends normally. The app shows "Local AI unavailable." until it is started again.
      child.on('exit', (code) => {
        say(`the model server stopped (exit code ${code ?? 'unknown'}); the app says "Local AI unavailable." until it is started again`)
        resolve(0)
      })
      for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
    })
  },
}

const cmd = process.argv[2]
if (!commands[cmd]) {
  console.error(`usage: node scripts/llm.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
try {
  process.exitCode = await commands[cmd]()
} catch (err) {
  console.error(`[llm] ERROR: ${err.message}`)
  process.exitCode = 1
}
