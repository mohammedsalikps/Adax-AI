#!/usr/bin/env node
// Cold backup and restore of the local ADAXAI installation (database + uploaded files).
//
//   node scripts/backup.mjs backup                 copy PGDATA + storage into backups/<timestamp>/
//   node scripts/backup.mjs verify <backup-dir>    start the copy on a spare port and check it
//   node scripts/backup.mjs restore <backup-dir> --yes
//                                                  replace the current data with the backup;
//                                                  the current data is moved aside, never deleted
//
// Why a cold copy: the bundled PostgreSQL binaries (embedded-postgres) include
// initdb, pg_ctl and postgres but not pg_dump/pg_restore. Copying the data
// directory of a cleanly stopped server is a complete, consistent backup for
// the same PostgreSQL major version and platform. Stop the app first; the
// database is stopped during the copy and started again afterwards.

import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { ROOT, loadEnv, requireSecrets } from './lib/env.mjs'

const cfg = loadEnv()
const DATA_DIR = cfg.db.dataDir
const STORAGE = cfg.storageDir
const BACKUPS = path.join(ROOT, 'backups')
const API_PORT = Number(process.env.API_PORT || 4000)
const say = (m) => console.log(`[backup] ${m}`)
const rel = (p) => path.relative(ROOT, p) || '.'
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

const db = (cmd) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'db.mjs'), cmd], { stdio: 'inherit' })

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => (s.destroy(), resolve(true)))
    s.on('error', () => resolve(false))
  })
}

async function client(port, database) {
  const c = new pg.Client({ host: cfg.db.host, port, user: cfg.db.adminUser, password: cfg.db.adminPassword, database, connectionTimeoutMillis: 3000 })
  await c.connect()
  return c
}

/** Row counts that identify the content of a backup. */
async function counts(port) {
  const c = await client(port, cfg.db.name)
  try {
    const q = async (sql) => (await c.query(sql)).rows[0].n
    return {
      patients: await q('select count(*)::int as n from patients'),
      signedEncounters: await q("select count(*)::int as n from encounters where status = 'signed'"),
      auditEvents: await q('select count(*)::int as n from audit_events'),
      files: await q('select count(*)::int as n from files where deleted_at is null'),
      migrations: await q('select count(*)::int as n from meta.schema_migrations'),
    }
  } finally {
    await c.end()
  }
}

function listFiles(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) out.push(path.join(e.parentPath ?? e.path, e.name))
  return out
}

async function requireAppStopped() {
  if (await portInUse(API_PORT)) throw new Error(`The API is running on port ${API_PORT}. Stop the app (npm run dev) first.`)
}

async function binaries() {
  const key = `${os.platform() === 'win32' ? 'windows' : os.platform()}-${os.arch()}`
  return import(`@embedded-postgres/${key}`)
}

async function pgCtl(args, logFile) {
  const { pg_ctl } = await binaries()
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const fd = fs.openSync(logFile, 'w')
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(pg_ctl, args, { stdio: ['ignore', fd, fd], windowsHide: true })
      child.on('error', reject)
      child.on('exit', (code) => resolve(code ?? 1))
    })
  } finally {
    fs.closeSync(fd)
  }
}

const commands = {
  async backup() {
    requireSecrets(cfg)
    await requireAppStopped()
    db('start')
    const before = await counts(cfg.db.port)
    db('stop')
    const dir = path.join(BACKUPS, `adaxai-${stamp()}`)
    fs.mkdirSync(dir, { recursive: true })
    try {
      fs.cpSync(DATA_DIR, path.join(dir, 'pgdata'), { recursive: true })
      fs.rmSync(path.join(dir, 'pgdata', 'postmaster.pid'), { force: true })
      if (fs.existsSync(STORAGE)) fs.cpSync(STORAGE, path.join(dir, 'storage'), { recursive: true })
    } finally {
      db('start')
    }
    const storageFiles = listFiles(path.join(dir, 'storage'))
    const manifest = {
      createdAt: new Date().toISOString(),
      method: 'cold copy of PGDATA (server stopped) + storage directory',
      postgresVersion: fs.readFileSync(path.join(dir, 'pgdata', 'PG_VERSION'), 'utf8').trim(),
      database: cfg.db.name,
      counts: before,
      storage: { files: storageFiles.length, bytes: storageFiles.reduce((n, f) => n + fs.statSync(f).size, 0) },
      note: 'Contains the database and uploaded files. Treat as sensitive. Restore only with the same PostgreSQL major version.',
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    say(`backup written to ${rel(dir)}: ${JSON.stringify(before)}, ${manifest.storage.files} stored file(s)`)
  },

  /** Starts a copy of the backup on a spare port, checks counts and file presence, then removes the copy. */
  async verify(dir) {
    requireSecrets(cfg)
    if (!dir) throw new Error('Usage: verify <backup-dir>')
    const abs = path.resolve(dir)
    const manifest = JSON.parse(fs.readFileSync(path.join(abs, 'manifest.json'), 'utf8'))
    const tmp = path.join(os.tmpdir(), `adaxai-verify-${crypto.randomBytes(4).toString('hex')}`)
    const port = 5499
    if (await portInUse(port)) throw new Error(`Port ${port} is in use`)
    fs.cpSync(path.join(abs, 'pgdata'), tmp, { recursive: true })
    const log = path.join(tmp, 'verify.log')
    try {
      const code = await pgCtl(['start', '-D', tmp, '-l', log, '-o', `-p ${port}`, '-w', '-t', '60'], path.join(tmp, 'pg_ctl.out'))
      if (code !== 0) throw new Error(`could not start the backup copy (see ${log})`)
      const c = await client(port, 'postgres')
      const dataDir = (await c.query("select current_setting('data_directory') as d")).rows[0].d
      await c.end()
      if (path.resolve(dataDir).toLowerCase() !== path.resolve(tmp).toLowerCase()) throw new Error('connected to the wrong server')
      const got = await counts(port)
      const cc = await client(port, cfg.db.name)
      const keys = (await cc.query('select storage_key from files where deleted_at is null')).rows.map((r) => r.storage_key)
      await cc.end()
      const missing = keys.filter((k) => !fs.existsSync(path.join(abs, 'storage', k)))
      const same = JSON.stringify(got) === JSON.stringify(manifest.counts)
      say(`counts in backup: ${JSON.stringify(got)} (${same ? 'match the manifest' : 'DIFFER from the manifest'})`)
      say(`stored files referenced by the database: ${keys.length}, missing from the backup: ${missing.length}`)
      if (!same || missing.length) throw new Error('verification FAILED')
      say('verification passed')
    } finally {
      await pgCtl(['stop', '-D', tmp, '-m', 'fast', '-w', '-t', '60'], path.join(os.tmpdir(), 'adaxai-verify-stop.out'))
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  },

  async restore(dir) {
    requireSecrets(cfg)
    if (!dir || !process.argv.includes('--yes')) throw new Error('Usage: restore <backup-dir> --yes   (replaces the current database and files; they are moved aside, not deleted)')
    const abs = path.resolve(dir)
    const manifest = JSON.parse(fs.readFileSync(path.join(abs, 'manifest.json'), 'utf8'))
    await requireAppStopped()
    db('stop')
    const ts = stamp()
    const asideData = `${DATA_DIR}.before-restore-${ts}`
    const asideStorage = `${STORAGE}.before-restore-${ts}`
    fs.renameSync(DATA_DIR, asideData)
    fs.cpSync(path.join(abs, 'pgdata'), DATA_DIR, { recursive: true })
    if (fs.existsSync(STORAGE)) fs.renameSync(STORAGE, asideStorage)
    if (fs.existsSync(path.join(abs, 'storage'))) fs.cpSync(path.join(abs, 'storage'), STORAGE, { recursive: true })
    else fs.mkdirSync(STORAGE, { recursive: true })
    db('start')
    const got = await counts(cfg.db.port)
    const same = JSON.stringify(got) === JSON.stringify(manifest.counts)
    say(`restored from ${rel(abs)}: ${JSON.stringify(got)} (${same ? 'matches the backup manifest' : 'DIFFERS from the manifest'})`)
    say(`previous data kept at ${rel(asideData)} and ${fs.existsSync(asideStorage) ? rel(asideStorage) : '(no storage dir)'}; delete them yourself once satisfied`)
    if (!same) process.exitCode = 1
  },
}

const [cmd, arg] = process.argv.slice(2)
if (!commands[cmd]) {
  console.error('Usage: node scripts/backup.mjs backup | verify <dir> | restore <dir> --yes')
  process.exit(2)
}
try {
  await commands[cmd](arg)
} catch (e) {
  console.error(`[backup] ERROR ${e.message}`)
  process.exitCode = 1
}
