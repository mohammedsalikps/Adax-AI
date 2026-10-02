#!/usr/bin/env node
// Lists (or with --delete removes) files in STORAGE_DIR that the development
// database does not reference. Useful after test runs that, before
// test storage was separated, wrote into the development store.
//
//   node scripts/storage-orphans.mjs            list only
//   node scripts/storage-orphans.mjs --delete   delete unreferenced files

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ROOT, loadEnv, requireSecrets } from './lib/env.mjs'

const cfg = loadEnv()
requireSecrets(cfg)
const c = new pg.Client({ host: cfg.db.host, port: cfg.db.port, user: cfg.db.adminUser, password: cfg.db.adminPassword, database: cfg.db.name })
await c.connect()
// Deleting is allowed only against the database that identifies as the development one,
// so a leftover DB_NAME pointing at a test database cannot empty the development store.
const marked = (await c.query("select to_regclass('meta.database_identity') is not null as ok")).rows[0].ok
const identity = marked ? (await c.query('select role from meta.database_identity')).rows[0]?.role : undefined
const referenced = new Set((await c.query('select storage_key from files')).rows.map((r) => path.normalize(r.storage_key)))
await c.end()
if (process.argv.includes('--delete') && identity !== 'development') {
  console.error(`[storage] Refusing to delete: database ${cfg.db.name} does not identify as the development database (run "npm run db:migrate" to mark it).`)
  process.exit(2)
}

const files = []
if (fs.existsSync(cfg.storageDir)) for (const e of fs.readdirSync(cfg.storageDir, { withFileTypes: true, recursive: true })) if (e.isFile()) files.push(path.join(e.parentPath, e.name))
const orphans = files.filter((f) => !referenced.has(path.normalize(path.relative(cfg.storageDir, f))))
const bytes = orphans.reduce((n, f) => n + fs.statSync(f).size, 0)
console.log(`[storage] ${path.relative(ROOT, cfg.storageDir)}: ${files.length} file(s), ${referenced.size} referenced by database ${cfg.db.name}, ${orphans.length} unreferenced (${(bytes / 1e6).toFixed(1)} MB)`)
if (process.argv.includes('--delete')) {
  for (const f of orphans) fs.rmSync(f)
  console.log(`[storage] deleted ${orphans.length} unreferenced file(s)`)
} else if (orphans.length) console.log('[storage] run with --delete to remove them')
