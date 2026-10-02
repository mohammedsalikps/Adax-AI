#!/usr/bin/env node
// Local PostgreSQL 17 lifecycle for development.
//
//   node scripts/db.mjs init       initdb once (UTF-8, builtin C.UTF-8 locale, scram-sha-256)
//   node scripts/db.mjs start      idempotent; succeeds only after a real connection works
//   node scripts/db.mjs stop       clean shutdown (pg_ctl stop -m fast)
//   node scripts/db.mjs status     running state, encoding, locale, databases
//   node scripts/db.mjs provision  app role + dev/test databases + grants (idempotent)
//   node scripts/db.mjs selftest   persistence + encoding check in a scratch database
//
// Why it works this way is recorded in spikes/postgres/RESULTS.md:
// - the embedded-postgres package's stop() force-kills on Windows, so pg_ctl is used instead;
// - pg_ctl must write to a file, not a pipe, or the caller hangs (handle inheritance);
// - `pg_ctl start -w` can report success early after an unclean stop, so readiness is
//   proven with a real connection to *this* cluster's data directory;
// - a second start on a running cluster is slow and noisy, so status is checked first;
// - initdb defaults to the Windows code page (WIN1252), so UTF-8 is set explicitly.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { ROOT, assertIdentifier, loadEnv, requireSecrets } from './lib/env.mjs'

const INITDB_FLAGS = [
  '--encoding=UTF8',
  '--locale=C',
  '--locale-provider=builtin',
  '--builtin-locale=C.UTF-8',
  '--auth=scram-sha-256',
]

const cfg = loadEnv()
const DATA_DIR = cfg.db.dataDir
const LOG_DIR = path.join(path.dirname(DATA_DIR), 'logs')
const SERVER_LOG = path.join(LOG_DIR, 'postgres.log')
const rel = (p) => path.relative(ROOT, p) || '.'

const say = (msg) => console.log(`[db] ${msg}`)

async function binaries() {
  const platform = os.platform() === 'win32' ? 'windows' : os.platform()
  const key = `${platform}-${os.arch()}`
  try {
    return await import(`@embedded-postgres/${key}`)
  } catch {
    throw new Error(`No PostgreSQL binaries installed for ${key}. Run \`npm install\` (package embedded-postgres).`)
  }
}

// Run a PostgreSQL binary with stdout/stderr going to a file. Waits for the
// process's own exit, never for pipes to close (see header).
async function runToFile(bin, args, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const fd = fs.openSync(outFile, 'w')
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', fd, fd], windowsHide: true })
      child.on('error', reject)
      child.on('exit', (c) => resolve(c ?? 1))
    })
    return { code, out: fs.readFileSync(outFile, 'utf8').trim() }
  } finally {
    fs.closeSync(fd)
  }
}

async function pgCtl(args) {
  const { pg_ctl } = await binaries()
  return runToFile(pg_ctl, args, path.join(LOG_DIR, 'pg_ctl.out'))
}

const isInitialised = () => fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))

async function isRunning() {
  if (!isInitialised()) return false
  // pg_ctl status: 0 = running, 3 = not running, 4 = no accessible data dir.
  return (await pgCtl(['status', '-D', DATA_DIR])).code === 0
}

function adminClient(database = 'postgres') {
  return new pg.Client({
    host: cfg.db.host,
    port: cfg.db.port,
    user: cfg.db.adminUser,
    password: cfg.db.adminPassword,
    database,
    connectionTimeoutMillis: 3000,
  })
}

async function withAdmin(database, fn) {
  const c = adminClient(database)
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

const samePath = (a, b) => {
  const n = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')
  return os.platform() === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b)
}

const RETRYABLE = new Set(['ECONNREFUSED', 'ECONNRESET', '57P03', 'ETIMEDOUT'])

// Ready means: we can log in to the server on DB_PORT, and it is *our*
// cluster (not another PostgreSQL that happens to use the same port).
async function waitReady(timeoutMs = 30000) {
  const t0 = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      const info = await withAdmin('postgres', async (c) => {
        const { rows } = await c.query(
          "SELECT current_setting('data_directory') AS dir, current_setting('server_version') AS version, current_setting('server_encoding') AS encoding",
        )
        return rows[0]
      })
      if (!samePath(info.dir, DATA_DIR)) {
        throw Object.assign(new Error(`Port ${cfg.db.port} is served by a different PostgreSQL (data_directory=${info.dir}). Change DB_PORT in .env.`), { fatal: true })
      }
      return { ...info, attempts: attempt, ms: Date.now() - t0 }
    } catch (e) {
      if (e.fatal) throw e
      if (e.code === '28P01') throw new Error('PostgreSQL rejected DB_ADMIN_PASSWORD from .env. The cluster was initialised with a different password.')
      const retryable = RETRYABLE.has(e.code) || /timeout|terminated|ECONNREFUSED/i.test(String(e.message))
      if (!retryable || Date.now() - t0 > timeoutMs) {
        throw new Error(`PostgreSQL did not become ready within ${timeoutMs} ms (${e.code ?? e.message}). See ${rel(SERVER_LOG)}.`)
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

function tail(file, lines = 15) {
  if (!fs.existsSync(file)) return '(no log)'
  return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-lines).join('\n')
}

const commands = {
  async init() {
    requireSecrets(cfg)
    assertIdentifier(cfg.db.adminUser, 'DB_ADMIN_USER')
    if (isInitialised()) {
      say(`cluster already initialised at ${rel(DATA_DIR)}; skipping initdb`)
      return
    }
    const { initdb } = await binaries()
    fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true })
    const pwFile = path.join(os.tmpdir(), `adaxai-pw-${crypto.randomBytes(8).toString('hex')}`)
    fs.writeFileSync(pwFile, `${cfg.db.adminPassword}\n`, { mode: 0o600 })
    try {
      const t0 = Date.now()
      const { code, out } = await runToFile(
        initdb,
        [`--pgdata=${DATA_DIR}`, `--username=${cfg.db.adminUser}`, `--pwfile=${pwFile}`, ...INITDB_FLAGS],
        path.join(LOG_DIR, 'initdb.log'),
      )
      if (code !== 0) throw new Error(`initdb failed (exit ${code}):\n${out}`)
      say(`initdb ok in ${Date.now() - t0} ms (UTF8, builtin C.UTF-8, scram-sha-256) at ${rel(DATA_DIR)}`)
    } finally {
      fs.rmSync(pwFile, { force: true })
    }
    // Local development only: never listen on external interfaces.
    fs.appendFileSync(path.join(DATA_DIR, 'postgresql.conf'), "\n# ADAXAI local development\nlisten_addresses = 'localhost'\n")
  },

  async start() {
    requireSecrets(cfg)
    if (!isInitialised()) throw new Error(`No cluster at ${rel(DATA_DIR)}. Run \`npm run setup\` first.`)
    if (await isRunning()) {
      const r = await waitReady(5000)
      say(`already running: PostgreSQL ${r.version} on ${cfg.db.host}:${cfg.db.port}, encoding ${r.encoding}`)
      return
    }
    const hadStalePid = fs.existsSync(path.join(DATA_DIR, 'postmaster.pid'))
    if (hadStalePid) say('stale postmaster.pid found (previous unclean stop); PostgreSQL will recover automatically')
    const { code, out } = await pgCtl(['start', '-D', DATA_DIR, '-l', SERVER_LOG, '-o', `-p ${cfg.db.port}`, '-w', '-t', '60'])
    if (code !== 0) throw new Error(`pg_ctl start failed (exit ${code}): ${out}\n--- ${rel(SERVER_LOG)} (tail)\n${tail(SERVER_LOG)}`)
    const r = await waitReady()
    say(`ready: PostgreSQL ${r.version} on ${cfg.db.host}:${cfg.db.port}, encoding ${r.encoding} (connection ok after ${r.attempts} attempt(s), ${r.ms} ms)`)
  },

  async stop() {
    if (!isInitialised()) return say('no cluster initialised; nothing to stop')
    if (!(await isRunning())) return say('not running')
    const { code, out } = await pgCtl(['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60'])
    if (code !== 0) throw new Error(`pg_ctl stop failed (exit ${code}): ${out}`)
    if (await isRunning()) throw new Error('pg_ctl reported success but the server is still running')
    say('stopped cleanly')
  },

  async status() {
    say(`data dir: ${rel(DATA_DIR)} (initialised: ${isInitialised()})`)
    const running = await isRunning()
    say(`running: ${running}`)
    if (!running) return
    requireSecrets(cfg)
    await withAdmin('postgres', async (c) => {
      const s = (await c.query("SELECT version() AS v, current_setting('server_encoding') AS enc, current_setting('listen_addresses') AS listen, current_setting('port') AS port")).rows[0]
      say(`server: ${s.v}`)
      say(`server_encoding=${s.enc}; listen_addresses=${s.listen}; port=${s.port}`)
      const dbs = await c.query(
        `SELECT datname, pg_encoding_to_char(encoding) AS enc, datlocprovider AS provider, datlocale AS locale, datcollate
           FROM pg_database WHERE NOT datistemplate ORDER BY datname`,
      )
      for (const d of dbs.rows) say(`database ${d.datname}: encoding=${d.enc}, locale_provider=${d.provider === 'b' ? 'builtin' : d.provider}, locale=${d.locale ?? '-'}, collate=${d.datcollate}`)
      const role = await c.query('SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1', [cfg.db.appUser])
      if (role.rowCount) {
        const r = role.rows[0]
        say(`app role ${r.rolname}: superuser=${r.rolsuper}, createdb=${r.rolcreatedb}, createrole=${r.rolcreaterole}`)
      } else say(`app role ${cfg.db.appUser}: missing (run \`npm run db:provision\`)`)
    })
  },

  async provision() {
    requireSecrets(cfg)
    const admin = assertIdentifier(cfg.db.adminUser, 'DB_ADMIN_USER')
    const app = assertIdentifier(cfg.db.appUser, 'DB_APP_USER')
    const databases = [
      assertIdentifier(cfg.db.name, 'DB_NAME'),
      assertIdentifier(cfg.db.testName, 'DB_TEST_NAME'),
      assertIdentifier(cfg.db.e2eName, 'DB_E2E_NAME'),
    ]
    await commands.start()
    await withAdmin('postgres', async (c) => {
      const pw = c.escapeLiteral(cfg.db.appPassword)
      const exists = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [app])).rowCount
      await c.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${app} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pw}`)
      say(`app role ${app}: ${exists ? 'updated' : 'created'} (password from .env)`)
      for (const db of databases) {
        const has = (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])).rowCount
        if (!has) {
          await c.query(
            `CREATE DATABASE ${db} WITH OWNER ${admin} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER 'builtin' BUILTIN_LOCALE 'C.UTF-8' LOCALE 'C'`,
          )
        }
        await c.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`)
        await c.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${app}`)
        say(`database ${db}: ${has ? 'exists' : 'created'}`)
      }
    })
    // The app role gets data access only. Tables are created by the admin role
    // through migrations; default privileges extend DML grants to them.
    for (const db of databases) {
      await withAdmin(db, async (c) => {
        await c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        await c.query(`GRANT USAGE ON SCHEMA public TO ${app}`)
        await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`)
        await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${admin} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`)
        await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`)
        await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`)
        // ...except on append-only tables (audit log, amendments, status history...), listed by migration 0019.
        const policy = await c.query("SELECT to_regprocedure('meta.enforce_append_only(text)') IS NOT NULL AS ok")
        if (policy.rows[0].ok) await c.query('SELECT meta.enforce_append_only($1)', [app])
      })
    }
    say('grants applied')
  },

  // Empties every application table of the test or e2e database (never the
  // development database). Superuser + session_replication_role = replica is
  // the only way past the append-only audit triggers.
  async reset() {
    requireSecrets(cfg)
    const target = process.argv[3]
    const db = target === 'test' ? cfg.db.testName : target === 'e2e' ? cfg.db.e2eName : null
    if (!db) throw new Error('usage: node scripts/db.mjs reset <test|e2e>  (the development database is never reset)')
    // Fail closed unless the names are unambiguous and the database itself says it is the
    // disposable test/e2e database (marker written by `npm run db:migrate -- --target <test|e2e>`).
    const { name, testName, e2eName } = cfg.db
    if (name === testName || name === e2eName || testName === e2eName) throw new Error('Refusing to reset: DB_NAME, DB_TEST_NAME and DB_E2E_NAME must all be different.')
    if (!testName.endsWith('_test') || !e2eName.endsWith('_e2e')) throw new Error('Refusing to reset: DB_TEST_NAME must end with "_test" and DB_E2E_NAME with "_e2e".')
    if (db === name) throw new Error('Refusing to reset the development database.')
    await withAdmin(assertIdentifier(db, 'database'), async (c) => {
      const marker = await c.query("SELECT to_regclass('meta.database_identity') IS NOT NULL AS ok")
      const identity = marker.rows[0].ok ? (await c.query('SELECT role FROM meta.database_identity')).rows[0]?.role : undefined
      if (identity !== target) {
        throw new Error(
          identity
            ? `Refusing to reset: the database identifies as "${identity}", not "${target}".`
            : `Refusing to reset: the database has no identity marker; run "npm run db:migrate -- --target ${target}" first.`,
        )
      }
      await c.query('SET session_replication_role = replica')
      const { rows } = await c.query("SELECT quote_ident(tablename) AS t FROM pg_tables WHERE schemaname = 'public'")
      if (rows.length) await c.query(`TRUNCATE ${rows.map((r) => r.t).join(', ')} RESTART IDENTITY CASCADE`)
    })
    say(`reset ${db}: all application tables emptied`)
  },

  // Verifies, on this machine: UTF-8 round-trip, a clean stop (no
  // postmaster.pid left behind), restart, and persistence of a committed row.
  async selftest() {
    requireSecrets(cfg)
    const scratch = assertIdentifier(`${cfg.db.name}_selftest`, 'selftest database')
    const wasRunning = await isRunning()
    await commands.start()
    const marker = crypto.randomUUID()
    const text = 'राम कुमार / முருகன் / Zoë'
    let failed = false
    const check = (ok, msg) => {
      say(`${ok ? 'PASS' : 'FAIL'}: ${msg}`)
      if (!ok) failed = true
    }

    await withAdmin('postgres', async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${scratch}`)
      await c.query(`CREATE DATABASE ${scratch}`)
    })
    await withAdmin(scratch, async (c) => {
      const e = (await c.query("SELECT current_setting('server_encoding') AS enc, datlocprovider AS p FROM pg_database WHERE datname = current_database()")).rows[0]
      check(e.enc === 'UTF8' && e.p === 'b', `scratch database is UTF8 with builtin locale provider (got ${e.enc}/${e.p})`)
      await c.query('CREATE TABLE probe (marker uuid PRIMARY KEY, label text NOT NULL)')
      await c.query('INSERT INTO probe VALUES ($1, $2)', [marker, text])
    })
    say(`committed marker ${marker}`)

    await commands.stop()
    check(!fs.existsSync(path.join(DATA_DIR, 'postmaster.pid')), 'clean shutdown: no postmaster.pid left behind')
    check(!(await isRunning()), 'server reported stopped')

    await commands.start()
    await withAdmin(scratch, async (c) => {
      const r = await c.query('SELECT label FROM probe WHERE marker = $1', [marker])
      check(r.rowCount === 1, 'committed row survived stop + start')
      check(r.rows[0]?.label === text, 'Devanagari / Tamil / accented text round-trips byte-exact')
    })
    await withAdmin('postgres', (c) => c.query(`DROP DATABASE ${scratch}`))
    if (!wasRunning) await commands.stop()
    if (failed) throw new Error('selftest failed')
    say('selftest passed')
  },
}

const cmd = process.argv[2]
if (!commands[cmd]) {
  console.error(`usage: node scripts/db.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
try {
  await commands[cmd]()
} catch (e) {
  console.error(`[db] ERROR: ${e.message}`)
  process.exitCode = 1
}
