#!/usr/bin/env node
// One-time (and re-runnable) local setup. Safe to run repeatedly.
//
//   1. check Node version
//   2. create .env from .env.example with generated local passwords (if missing)
//   3. create the storage directory
//   4. initialise, start and provision PostgreSQL; migrate dev + test databases; seed dev
//   5. create the thermal service virtualenv
//   6. install the Playwright Chromium browser (skip with --skip-browsers)

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ENV_EXAMPLE, ENV_FILE, ROOT, loadEnv } from './lib/env.mjs'

const say = (msg) => console.log(`[setup] ${msg}`)
const skipBrowsers = process.argv.includes('--skip-browsers')

function step(title) {
  console.log(`\n[setup] === ${title}`)
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    // npm/npx are .cmd shims on Windows and need a shell. The command line is
    // built from fixed strings in this file, never from user input.
    const child =
      process.platform === 'win32'
        ? spawn([cmd, ...args].join(' '), { cwd: ROOT, stdio: 'inherit', shell: true })
        : spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))))
  })
}

function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj < 22 || (maj === 22 && min < 12)) throw new Error(`Node >= 22.12 required (found ${process.versions.node})`)
  say(`Node ${process.versions.node}`)
}

const fillPassword = (line) => (/^[A-Z_]+_PASSWORD=$/.test(line) ? `${line}${crypto.randomBytes(24).toString('base64url')}` : line)

function ensureEnvFile() {
  const exampleLines = fs.readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/)
  if (!fs.existsSync(ENV_FILE)) {
    fs.writeFileSync(ENV_FILE, exampleLines.map(fillPassword).join('\n'), { mode: 0o600 })
    say('.env created from .env.example with generated local passwords (git-ignored, not printed)')
    return
  }
  // Existing .env: keep every value, and append variables added to
  // .env.example since it was created (generating any new passwords).
  const current = fs.readFileSync(ENV_FILE, 'utf8')
  const present = new Set([...current.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]))
  const missing = exampleLines.filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l) && !present.has(l.split('=')[0]))
  if (!missing.length) {
    say('.env exists and has every variable from .env.example')
    return
  }
  fs.appendFileSync(ENV_FILE, `${current.endsWith('\n') ? '' : '\n'}\n# Added by setup\n${missing.map(fillPassword).join('\n')}\n`)
  say(`.env updated with new variables: ${missing.map((l) => l.split('=')[0]).join(', ')} (values not printed)`)
}

try {
  step('Node')
  checkNode()

  step('Environment')
  ensureEnvFile()
  const cfg = loadEnv()

  step('Storage')
  fs.mkdirSync(cfg.storageDir, { recursive: true })
  say(`storage directory ready (git-ignored)`)

  step('PostgreSQL')
  await run('node', ['scripts/db.mjs', 'init'])
  await run('node', ['scripts/db.mjs', 'provision'])

  step('Migrations and seed data')
  await run('npm', ['run', 'migrate', '--workspace', '@adaxai/api'])
  await run('npm', ['run', 'migrate', '--workspace', '@adaxai/api', '--', '--target', 'test'])
  await run('npm', ['run', 'migrate', '--workspace', '@adaxai/api', '--', '--target', 'e2e'])
  await run('npm', ['run', 'seed', '--workspace', '@adaxai/api'])

  step('Thermal service virtualenv')
  await run('node', ['scripts/thermal.mjs', 'venv'])

  step('Local speech service virtualenv (the model is a separate, explicit download: npm run speech:model)')
  // Optional: the Doctor App says "local transcription unavailable" without it; setup continues.
  await run('node', ['scripts/speech.mjs', 'venv']).catch((e) => say(`speech runtime not installed: ${e.message}`))

  step('Thermal sample images (third-party, MIT)')
  // Optional: without network the thermal sample tests are skipped, setup continues.
  await run('node', ['scripts/fetch-thermal-samples.mjs']).catch((e) => say(`samples not fetched: ${e.message}`))

  if (skipBrowsers) say('skipping Playwright browser install (--skip-browsers)')
  else {
    step('Playwright browser (Chromium)')
    await run('npx', ['playwright', 'install', 'chromium'])
  }

  console.log('\n[setup] done. Next: `npm run dev`, then open http://127.0.0.1:5173')
  console.log('[setup] PostgreSQL keeps running in the background; stop it with `npm run db:stop`.')
} catch (e) {
  console.error(`\n[setup] FAILED: ${e.message}`)
  process.exitCode = 1
}
