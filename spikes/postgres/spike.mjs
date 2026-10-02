// PostgreSQL feasibility spike for ADAXAI-MVP.
//
// Each phase runs in its own Node process so that "persistence" really means
// data surviving a server stop and a fresh process, not a cached connection.
//
//   node spike.mjs phase1         init (if needed), start, create DB, migrate, write, stop
//   node spike.mjs phase2         restart, verify, re-run migrations (expect no-op), write, stop
//   node spike.mjs pgctl          clean lifecycle via pg_ctl start/stop (twice), verify
//   node spike.mjs crash          start, write, then hard-kill this Node process
//   node spike.mjs recover        detect the orphaned server, stop it cleanly, restart, verify
//   node spike.mjs bad-migration  a failing migration must roll back completely
//   node spike.mjs info           versions and paths

import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

const ROOT = path.dirname(fileURLToPath(import.meta.url))
// SPIKE_PROFILE=final runs every phase against a fresh cluster initialised
// with the configuration recommended for the app (UTF-8, builtin C.UTF-8).
const FINAL = process.env.SPIKE_PROFILE === 'final'
const DATA_DIR = path.join(ROOT, '.data', FINAL ? 'pg-final' : 'pg')
const LOG_DIR = path.join(ROOT, '.data', FINAL ? 'logs-final' : 'logs')
const INITDB_FLAGS = FINAL ? ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'] : []
const BIN_DIR = path.join(ROOT, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin')
const PG_CTL = path.join(BIN_DIR, 'pg_ctl.exe')

// Local, throwaway spike credentials. The server listens on localhost only.
const PORT = 5433
const USER = 'adaxai_spike'
const PASSWORD = 'spike-local-only'
const DB = 'adaxai_spike'
const BAD_DB = 'adaxai_spike_bad'

fs.mkdirSync(LOG_DIR, { recursive: true })

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args)
}

function serverLogger(phase) {
  const file = path.join(LOG_DIR, `${phase}.server.log`)
  const lines = []
  return {
    lines,
    file,
    onLog: (msg) => {
      lines.push(msg)
      fs.appendFileSync(file, msg)
    },
  }
}

// Servers started through the package in this process. On a failed phase they
// are stopped explicitly; otherwise their stdio pipes keep Node alive forever.
const active = new Set()

function server(logger) {
  const s = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    authMethod: 'scram-sha-256',
    persistent: true,
    initdbFlags: INITDB_FLAGS,
    onLog: logger.onLog,
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e)
      logger.onLog(`[ERROR] ${msg}\n`)
      console.error('[pg error]', msg.trim())
    },
  })
  active.add(s)
  return s
}

function client(database = DB) {
  return new pg.Client({ host: 'localhost', port: PORT, user: USER, password: PASSWORD, database })
}

const isInitialised = () => fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))

async function timed(label, fn) {
  const t = Date.now()
  const out = await fn()
  log(`${label}: ok (${Date.now() - t} ms)`)
  return out
}

async function ensureDatabase(name) {
  const c = client('postgres')
  await c.connect()
  const { rowCount } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
  if (!rowCount) await c.query(`CREATE DATABASE ${name}`)
  await c.end()
  log(`database ${name}: ${rowCount ? 'already exists' : 'created'}`)
}

// Minimal transactional migration runner: one transaction per file, a ledger
// with checksums, and line endings normalised so a git CRLF checkout does not
// change a checksum.
async function migrate(c, dir) {
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
  const done = new Map((await c.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]))
  const result = { applied: [], skipped: [], failed: null }
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n')
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')
    if (done.has(file)) {
      if (done.get(file) !== checksum) throw new Error(`checksum mismatch for already-applied migration ${file}`)
      result.skipped.push(file)
      continue
    }
    try {
      await c.query('BEGIN')
      await c.query(sql)
      await c.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum])
      await c.query('COMMIT')
      result.applied.push(file)
    } catch (e) {
      await c.query('ROLLBACK')
      result.failed = { file, error: e.message }
      break
    }
  }
  return result
}

async function insertPatient(c, mrn, name) {
  await c.query('INSERT INTO spike_patients (mrn, full_name) VALUES ($1, $2)', [mrn, name])
  log(`inserted ${mrn}`)
}

async function listPatients(c) {
  const { rows } = await c.query('SELECT mrn, full_name, created_at FROM spike_patients ORDER BY created_at')
  return rows.map((r) => `${r.mrn} (${r.full_name})`)
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`)
    process.exitCode = 1
    throw new Error(msg)
  }
  log(`PASS: ${msg}`)
}

const recoveryMarkers = (lines) =>
  lines.filter((l) => /not properly shut down|automatic recovery|redo starts|redo done|interrupted/i.test(l)).map((l) => l.trim())

// `pg_ctl start` leaves postgres running, and on Windows postgres inherits
// pg_ctl's stdio handles. With pipes (execFile), Node waits for them to close,
// i.e. forever. So output goes to a file and we wait for pg_ctl's own exit.
async function pgCtl(args) {
  const outFile = path.join(LOG_DIR, 'pg_ctl.out')
  const fd = fs.openSync(outFile, 'w')
  const code = await new Promise((resolve, reject) => {
    const child = spawn(PG_CTL, args, { stdio: ['ignore', fd, fd], windowsHide: true })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  fs.closeSync(fd)
  const out = fs.readFileSync(outFile, 'utf8').trim()
  return code === 0 ? out : `EXIT ${code}: ${out}`
}

// On Windows `pg_ctl start -w` can report "server started" while it is still
// reading a stale postmaster.pid left by an unclean stop (it skips the PID
// check there). Readiness is therefore proven with a real connection.
async function waitReady(port = PORT, timeoutMs = 30000) {
  const t0 = Date.now()
  let attempts = 0
  for (;;) {
    attempts++
    const c = new pg.Client({ host: 'localhost', port, user: USER, password: PASSWORD, database: 'postgres' })
    try {
      await c.connect()
      await c.query('SELECT 1')
      await c.end()
      log(`ready: accepted a connection after ${attempts} attempt(s), ${Date.now() - t0} ms`)
      return
    } catch (e) {
      await c.end().catch(() => undefined)
      if (Date.now() - t0 > timeoutMs) throw new Error(`server not ready after ${timeoutMs} ms: ${e.code ?? e.message}`)
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

async function ctlStart(dir, port, logFile) {
  const stale = fs.existsSync(path.join(dir, 'postmaster.pid'))
  const out = await pgCtl(['start', '-D', dir, '-l', logFile, '-o', `-p ${port}`, '-w', '-t', '60'])
  log(`pg_ctl start (postmaster.pid present beforehand: ${stale}): ${out.replace(/\s+/g, ' ')}`)
  if (!/EXIT/.test(out)) await waitReady(port)
  return out
}

const phases = {
  async info() {
    const { stdout } = await run(path.join(BIN_DIR, 'postgres.exe'), ['--version'])
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'embedded-postgres', 'package.json'), 'utf8'))
    const bin = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@embedded-postgres', 'windows-x64', 'package.json'), 'utf8'))
    const pgPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'pg', 'package.json'), 'utf8'))
    log(`node ${process.version}`)
    log(`embedded-postgres ${pkg.version}; @embedded-postgres/windows-x64 ${bin.version}; pg ${pgPkg.version}`)
    log(`postgres binary: ${stdout.trim()}`)
    log(`bin dir: ${BIN_DIR}`)
    log(`data dir: ${DATA_DIR} (initialised: ${isInitialised()})`)
  },

  async phase1() {
    const lg = serverLogger('phase1')
    const pgs = server(lg)
    if (isInitialised()) log('data dir already initialised; skipping initdb')
    else await timed('initdb', () => pgs.initialise())
    await timed('start', () => pgs.start())
    await ensureDatabase(DB)
    const c = client()
    await c.connect()
    const v = await c.query("SELECT version(), current_setting('listen_addresses') AS listen, current_setting('data_directory') AS dir, current_setting('server_encoding') AS enc")
    log(`server: ${v.rows[0].version}`)
    log(`listen_addresses=${v.rows[0].listen}; data_directory=${v.rows[0].dir}; server_encoding=${v.rows[0].enc}`)
    const m = await migrate(c, path.join(ROOT, 'migrations'))
    log('migration result:', JSON.stringify(m))
    assert(!m.failed, 'migrations applied without error')
    const ext = await c.query("SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto','citext','pg_trgm') ORDER BY 1")
    log('extensions:', ext.rows.map((r) => `${r.extname} ${r.extversion}`).join(', '))
    assert(ext.rowCount === 3, 'pgcrypto, citext and pg_trgm are installed')
    await insertPatient(c, 'MRN-0001', 'Phase One Synthetic')
    await c.end()
    await timed('stop (package stop = taskkill /f /t on Windows)', () => pgs.stop())
  },

  async phase2() {
    const lg = serverLogger('phase2')
    const pgs = server(lg)
    assert(isInitialised(), 'data dir still initialised after stop')
    await timed('restart', () => pgs.start())
    const recovery = recoveryMarkers(lg.lines)
    log(`crash-recovery messages on startup: ${recovery.length ? '\n  ' + recovery.join('\n  ') : 'none'}`)
    const c = client()
    await c.connect()
    const before = await listPatients(c)
    log('rows after restart:', before.join(', '))
    assert(before.some((r) => r.startsWith('MRN-0001')), 'row written in phase1 survived stop + restart')
    const m = await migrate(c, path.join(ROOT, 'migrations'))
    log('migration re-run result:', JSON.stringify(m))
    assert(m.applied.length === 0 && !m.failed && m.skipped.length === 2, 'migration re-run is a no-op (2 skipped, 0 applied)')
    const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'spike_patients' AND column_name = 'phone'")
    assert(cols.rowCount === 1, 'migration 0002 (phone column) is present')
    await insertPatient(c, 'MRN-0002', 'Phase Two Synthetic')
    const dup = await c.query('INSERT INTO spike_patients (mrn, full_name) VALUES ($1, $2)', ['mrn-0002', 'Case variant']).then(() => 'accepted', (e) => e.code)
    assert(dup === '23505', 'citext unique constraint rejects case-variant duplicate MRN (23505)')
    await c.end()
    await timed('stop (package)', () => pgs.stop())
  },

  async pgctl() {
    const logFile = path.join(LOG_DIR, 'pgctl.server.log')
    for (const round of [1, 2]) {
      log(`--- pg_ctl round ${round}`)
      await ctlStart(DATA_DIR, PORT, logFile)
      const c = client()
      await c.connect()
      const rows = await listPatients(c)
      log('rows:', rows.join(', '))
      if (round === 1) {
        assert(rows.length === 2, 'both earlier rows present under pg_ctl-managed server')
        await insertPatient(c, 'MRN-0003', 'pg_ctl Synthetic')
      } else {
        assert(rows.some((r) => r.startsWith('MRN-0003')), 'row written in round 1 survived a clean pg_ctl stop/start')
      }
      await c.end()
      log(await pgCtl(['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60']))
      log(await pgCtl(['status', '-D', DATA_DIR]))
    }
    const text = fs.readFileSync(logFile, 'utf8')
    const shutdowns = (text.match(/database system is shut down/g) ?? []).length
    log(`clean shutdown messages in pgctl log: ${shutdowns}`)
    assert(shutdowns >= 2, 'pg_ctl stop produced clean shutdowns')
    const lastStart = text.split(/database system is shut down/).slice(-2)[0] ?? ''
    log(`recovery messages before 2nd clean shutdown: ${recoveryMarkers(lastStart.split('\n')).length}`)
  },

  async crash() {
    const lg = serverLogger('crash')
    const pgs = server(lg)
    await timed('start', () => pgs.start())
    const c = client()
    await c.connect()
    await insertPatient(c, 'MRN-0004', 'Pre-crash Synthetic')
    await c.end()
    log(`hard-killing Node process ${process.pid} without stopping Postgres`)
    process.kill(process.pid, 'SIGKILL')
  },

  async recover() {
    const status = await pgCtl(['status', '-D', DATA_DIR])
    log(`pg_ctl status after crash: ${status}`)
    const orphaned = /server is running/.test(status)
    log(`orphaned server still running after Node was killed: ${orphaned}`)

    if (orphaned) {
      // What happens if the app simply tries to start again?
      const lg = serverLogger('recover-attempt')
      const pgs = server(lg)
      const outcome = await Promise.race([
        pgs.start().then(() => 'started', (e) => `failed: ${e?.message ?? 'process closed'}`),
        new Promise((r) => setTimeout(() => r('timeout after 20s'), 20000)),
      ])
      log(`package start() with orphan running: ${outcome}`)
      log(`server said: ${lg.lines.map((l) => l.trim()).filter(Boolean).slice(-3).join(' | ')}`)
      log(await pgCtl(['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60']))
    }

    const lg = serverLogger('recover')
    const pgs = server(lg)
    await timed('start after recovery', () => pgs.start())
    log(`crash-recovery messages: ${recoveryMarkers(lg.lines).join(' | ') || 'none'}`)
    const c = client()
    await c.connect()
    const rows = await listPatients(c)
    log('rows:', rows.join(', '))
    assert(rows.some((r) => r.startsWith('MRN-0004')), 'row committed just before the hard kill survived')
    assert(rows.length === 4, 'all 4 rows present after crash + recovery')
    await c.end()
    await pgs.stop()
  },

  // The lifecycle recommended for the app: pg_ctl-managed, detached server.
  async robustness() {
    const logFile = path.join(LOG_DIR, 'robustness.server.log')
    const start = () => ctlStart(DATA_DIR, PORT, logFile)
    const stop = () => pgCtl(['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60'])
    const pgProcs = async () => {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq postgres.exe', '/FO', 'CSV', '/NH'])
      return stdout.split('\n').filter((l) => l.includes('postgres.exe')).length
    }

    const pre = await pgCtl(['status', '-D', DATA_DIR])
    log(`pre-existing server: ${/server is running/.test(pre)}`)
    if (/server is running/.test(pre)) log(`stopping leftover server: ${await stop()}`)

    log(`1. start: ${await start()}`)
    const second = await start()
    log(`2. second start while running: ${second.replace(/\s+/g, ' ')}`)
    assert(/EXIT/.test(second), 'a second start is refused instead of starting a second server')
    assert(/server is running/.test(await pgCtl(['status', '-D', DATA_DIR])), 'original server still running after the refused start')

    const pid = Number(fs.readFileSync(path.join(DATA_DIR, 'postmaster.pid'), 'utf8').split('\n')[0])
    log(`3. force-killing postmaster PID ${pid} (simulated crash / Task Manager kill)`)
    await run('taskkill', ['/PID', String(pid), '/F', '/T']).catch((e) => log(`taskkill: ${e.message}`))
    await new Promise((r) => setTimeout(r, 1500))
    log(`postmaster.pid left behind: ${fs.existsSync(path.join(DATA_DIR, 'postmaster.pid'))}; postgres processes: ${await pgProcs()}`)

    const restart = await start()
    log(`4. start over stale postmaster.pid: ${restart.replace(/\s+/g, ' ')}`)
    assert(!/EXIT/.test(restart), 'server starts despite a stale postmaster.pid')
    const tail = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /lock file|not properly shut down|redo done/.test(l))
    log(`log evidence: ${tail.map((l) => l.trim()).join(' | ') || 'none'}`)

    const bad = new pg.Client({ host: 'localhost', port: PORT, user: USER, password: 'wrong-password', database: DB })
    const badResult = await bad.connect().then(() => 'ACCEPTED', (e) => e.code)
    assert(badResult === '28P01', `wrong password rejected (${badResult})`)

    const c = client()
    await c.connect()
    const rows = await listPatients(c)
    assert(rows.length === 4, `all 4 rows present after force-kill recovery (${rows.length})`)
    const hba = await c.query('SELECT type, address, auth_method FROM pg_hba_file_rules ORDER BY line_number')
    log('pg_hba rules:', JSON.stringify(hba.rows))
    await c.end()

    log(`5. clean stop: ${await stop()}`)
    assert((await pgProcs()) === 0, 'no postgres processes left after clean stop')
  },

  // initdb inherits the Windows locale (WIN1252) unless told otherwise.
  // Show the failure on the default cluster, then prove the UTF-8 fix.
  async utf8() {
    const names = ["राम कुमार", "முருகன்", "Zoë Fernandes"]
    const defaultLog = path.join(LOG_DIR, 'utf8-default.server.log')

    log('--- default cluster (as initialised by the package)')
    await ctlStart(DATA_DIR, PORT, defaultLog)
    let c = client()
    await c.connect()
    log(`server_encoding=${(await c.query('SHOW server_encoding')).rows[0].server_encoding}`)
    const failure = await c.query('INSERT INTO spike_patients (mrn, full_name) VALUES ($1, $2)', ['MRN-HI', names[0]]).then(() => 'accepted', (e) => `${e.code} ${e.message}`)
    log(`insert Devanagari into default cluster: ${failure}`)
    await c.end()
    log(await pgCtl(['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60']))

    log('--- UTF-8 cluster')
    const dir = path.join(ROOT, '.data', 'pg-utf8-c')
    const port = 5434
    const lg = serverLogger('utf8-initdb')
    if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
      const init = new EmbeddedPostgres({
        databaseDir: dir, port, user: USER, password: PASSWORD, authMethod: 'scram-sha-256', persistent: true,
        initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'],
        onLog: lg.onLog, onError: lg.onLog,
      })
      await timed('initdb (UTF8, builtin C.UTF-8)', () => init.initialise())
    }
    log(lg.lines.join('').split('\n').filter((l) => /locale|encoding/i.test(l)).map((l) => l.trim()).join(' | '))
    const utfLog = path.join(LOG_DIR, 'utf8.server.log')
    await ctlStart(dir, port, utfLog)
    const admin = new pg.Client({ host: 'localhost', port, user: USER, password: PASSWORD, database: 'postgres' })
    await admin.connect()
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB])).rowCount) await admin.query(`CREATE DATABASE ${DB}`)
    await admin.end()
    c = new pg.Client({ host: 'localhost', port, user: USER, password: PASSWORD, database: DB })
    await c.connect()
    const enc = (await c.query("SELECT current_setting('server_encoding') e, datcollate, datlocprovider FROM pg_database WHERE datname = current_database()")).rows[0]
    log(`server_encoding=${enc.e}; datcollate=${enc.datcollate}; provider=${enc.datlocprovider}`)
    assert(enc.e === 'UTF8', 'UTF-8 cluster reports server_encoding UTF8')
    const m = await migrate(c, path.join(ROOT, 'migrations'))
    assert(!m.failed, `migrations apply on UTF-8 cluster (${m.applied.length} applied, ${m.skipped.length} skipped)`)
    await c.query("DELETE FROM spike_patients WHERE mrn LIKE 'MRN-U%'")
    for (const [i, n] of names.entries()) await insertPatient(c, `MRN-U${i}`, n)
    const back = (await c.query("SELECT full_name FROM spike_patients WHERE mrn LIKE 'MRN-U%' ORDER BY mrn")).rows.map((r) => r.full_name)
    log(`read back: ${back.join(' / ')}`)
    assert(JSON.stringify(back) === JSON.stringify(names), 'Devanagari, Tamil and accented Latin names round-trip byte-exact')
    const fold = (await c.query("SELECT upper('zoë') AS u, 'MRN-ü'::citext = 'mrn-Ü'::citext AS ci, datctype FROM pg_database WHERE datname = current_database()")).rows[0]
    log(`upper(zoë)=${fold.u}; citext MRN-ü = mrn-Ü -> ${fold.ci}; datctype=${fold.datctype}`)
    assert(fold.u === "ZOË" && fold.ci === true, "Unicode-aware case folding for upper() and citext")
    const search = await c.query("SELECT full_name FROM spike_patients WHERE full_name ILIKE '%कुमार%'")
    assert(search.rowCount === 1, 'substring search on a Devanagari name works')
    await c.end()
    log(await pgCtl(['stop', '-D', dir, '-m', 'fast', '-w', '-t', '60']))
  },

  async ['bad-migration']() {
    const lg = serverLogger('bad-migration')
    const pgs = server(lg)
    await timed('start', () => pgs.start())
    await ensureDatabase(BAD_DB)
    const c = client(BAD_DB)
    await c.connect()
    const m = await migrate(c, path.join(ROOT, 'bad-migrations'))
    log('migration result:', JSON.stringify(m))
    assert(m.applied.length === 1 && m.failed?.file === '0002_broken.sql', '0001 applied, 0002 failed')
    const t = await c.query("SELECT to_regclass('spike_should_not_exist') AS t, to_regclass('spike_rollback_probe') AS ok")
    assert(t.rows[0].t === null, 'partial DDL from the failed migration was rolled back')
    assert(t.rows[0].ok !== null, 'earlier successful migration is kept')
    const ledger = await c.query('SELECT version FROM schema_migrations ORDER BY 1')
    assert(ledger.rowCount === 1, 'ledger records only the successful migration')
    await c.end()
    await pgs.stop()
  },
}

const phase = process.argv[2]
if (!phases[phase]) {
  console.error(`usage: node spike.mjs <${Object.keys(phases).join('|')}>`)
  process.exit(2)
}
log(`=== phase: ${phase} (pid ${process.pid})`)
phases[phase]().then(
  () => log(`=== ${phase} finished${process.exitCode ? ' WITH FAILURES' : ''}`),
  async (e) => {
    console.error(`=== ${phase} FAILED:`, e?.stack ?? e)
    process.exitCode = 1
    await Promise.all([...active].map((s) => s.stop().catch(() => undefined)))
    // Open sockets or the package's exit hook can otherwise hang the process
    // or mask the exit code.
    process.exit(1)
  },
)
