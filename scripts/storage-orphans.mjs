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
const referenced = new Set((await c.query('select storage_key from files')).rows.map((r) => path.normalize(r.storage_key)))
await c.end()

const files = []
if (fs.existsSync(cfg.storageDir)) for (const e of fs.readdirSync(cfg.storageDir, { withFileTypes: true, recursive: true })) if (e.isFile()) files.push(path.join(e.parentPath, e.name))
const orphans = files.filter((f) => !referenced.has(path.normalize(path.relative(cfg.storageDir, f))))
const bytes = orphans.reduce((n, f) => n + fs.statSync(f).size, 0)
console.log(`[storage] ${path.relative(ROOT, cfg.storageDir)}: ${files.length} file(s), ${referenced.size} referenced by database ${cfg.db.name}, ${orphans.length} unreferenced (${(bytes / 1e6).toFixed(1)} MB)`)
if (process.argv.includes('--delete')) {
  for (const f of orphans) fs.rmSync(f)
  console.log(`[storage] deleted ${orphans.length} unreferenced file(s)`)
} else if (orphans.length) console.log('[storage] run with --delete to remove them')
