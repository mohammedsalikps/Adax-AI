# PostgreSQL feasibility spike — results

Date: 2026-10-02 · Machine: Windows 11 Home 10.0.26200, user `saali` · Scope: this folder only.
No application code was written. `doctor-app` was not touched.

## Verdict

**Feasible, with conditions.** `embedded-postgres` gives a real PostgreSQL 17.10 server on this
machine with no Docker, no installer and no admin rights. Data persists across stop/restart and
across hard crashes, and transactional migrations work. Two defaults must **not** be used as-is
(non-UTF-8 encoding, forced-kill shutdown), and Windows needs three process-handling rules. The
portable-zip fallback was not needed.

## Versions

| Item | Version |
| --- | --- |
| Node / npm | v24.13.1 / 11.8.0 |
| `embedded-postgres` | 17.10.0-beta.17 (exact pin; "beta" is the wrapper's label) |
| `@embedded-postgres/windows-x64` | 17.10.0-beta.17 |
| PostgreSQL | 17.10, "x86_64-windows, compiled by msvc-19.44.35226, 64-bit" |
| `pg` (node client) | 8.23.1 |
| Extensions verified | pgcrypto 1.3, citext 1.6, pg_trgm 1.6 |

Bundled binaries: `initdb.exe`, `pg_ctl.exe`, `postgres.exe`. **Not bundled: `pg_dump`, `pg_restore`, `psql`.**

## Admin rights

**Not required.** All commands ran in a non-elevated shell (Medium integrity level). The account is
a member of the Administrators group, but UAC elevation was never used or requested.

## Where files live

| What | Path | Size |
| --- | --- | --- |
| Binaries | `spikes/postgres/node_modules/@embedded-postgres/windows-x64/native/` | ~100 MB |
| Final cluster (recommended config) | `spikes/postgres/.data/pg-final/` | ~56 MB |
| Earlier clusters (default config, UTF-8 trial) | `.data/pg/`, `.data/pg-utf8/`, `.data/pg-utf8-c/` | evidence only, deletable |
| Server logs / phase output | `.data/logs*/`, `.data/run-final/*.txt` | |

`.data/` and `node_modules/` are git-ignored. Server listens on `localhost` only (127.0.0.1 and ::1),
port 5433, `scram-sha-256` auth (wrong password rejected with `28P01`).

## Results (final run, fresh cluster, recommended config)

Each phase is a separate Node process. 22/22 assertions passed.

| Check | Result |
| --- | --- |
| install (`npm install`) | OK, 17 packages, 0 vulnerabilities reported |
| initdb | OK, ~6–9 s |
| start / stop / restart | OK; start 0.1–1 s |
| persistence across stop + restart (new process) | **PASS** |
| persistence across clean `pg_ctl` stop/start ×2 | **PASS**, no crash recovery needed |
| row committed immediately before a hard kill of Node | **PASS**, survived via WAL recovery |
| force-kill of the postmaster (stale `postmaster.pid`) then restart | **PASS**, automatic recovery, all rows present |
| second start while already running | refused (no second server), but slow (~32 s) and noisy |
| migrations: 2 files applied in order | **PASS** |
| migrations: re-run | **PASS**, no-op (2 skipped, 0 applied) |
| migrations: failing file | **PASS**, partial DDL rolled back, ledger records only the good file |
| citext case-insensitive unique MRN | **PASS** (`23505` on `mrn-0002` vs `MRN-0002`) |
| UTF-8 names (Devanagari, Tamil, accented Latin) | **PASS** round-trip, `ILIKE` search, Unicode `upper()` |

## Errors found and how each was resolved

1. **Default cluster encoding is WIN1252, not UTF-8.** `initdb` inherits the Windows locale.
   Inserting `राम कुमार` failed: `22P05 character with byte sequence 0xe0 0xa4 0xb0 in encoding "UTF8"
   has no equivalent in encoding "WIN1252"`. **Fix (verified):** initialise with
   `--encoding=UTF8 --locale=C --locale-provider=builtin --builtin-locale=C.UTF-8`.
2. **The package's `stop()` on Windows is `taskkill /f /t`**, a forced kill, so every restart does
   crash recovery (log: "database system was not properly shut down; automatic recovery in
   progress"). Data survived, but this is not a clean shutdown. **Fix:** stop with
   `pg_ctl stop -m fast`; clean shutdowns were confirmed in the log.
3. **`pg_ctl start` hung the calling process** (Node `execFile`, and PowerShell `*> $null`): the
   server inherits the caller's stdout/stderr pipe, so the caller waits for EOF forever. **Fix
   (verified):** give `pg_ctl` a file for stdout/stderr, not a pipe, and wait for its exit event.
4. **`pg_ctl start -w` can report "server started" before the server accepts connections** when a
   stale `postmaster.pid` exists after an unclean stop (Windows `pg_ctl` skips the PID check while
   waiting). Observed: first connection succeeded only on attempt 3, ~590 ms later (twice). Without a
   stale file: attempt 1. **Fix (verified):** treat the server as ready only after a real connection.
5. **A second `pg_ctl start` on a running cluster** is refused but takes ~32 s and fails on a locked
   log file. **Fix:** check `pg_ctl status` first and do nothing if running.
6. **Package-managed server kept Node alive after a failed phase** (its stdio pipes), and the
   package's exit hook could mask exit codes. Spike harness bug; fixed by explicit stop + `exit(1)`.
7. **Orphan behaviour after hard-killing Node** was not consistent between shells (once the server
   exited by itself, once it kept running). Under the recommended `pg_ctl` lifecycle the server is
   detached by design, so this no longer matters; the startup check in (5) and stale-pid handling
   in (4) cover both outcomes.
8. **My own tooling mistake, not a Postgres issue:** rewriting `spike.mjs` with Windows PowerShell 5.1
   `Get-Content`/`Set-Content` corrupted the UTF-8 test strings (PS 5.1 reads files as ANSI by
   default). Repaired; the final run used the corrected file. Rule for the project: never round-trip
   source files through PS 5.1 text cmdlets.

## Exact commands executed

All from `C:\Users\saali\ADAXAI-MVP\spikes\postgres`, non-elevated.

```
npm install --save-exact embedded-postgres@17.10.0-beta.17 pg
node spike.mjs info
node spike.mjs phase1          # initdb (default config) → start → migrate → insert → package stop
node spike.mjs phase2          # restart → verify → re-run migrations → insert → package stop
node spike.mjs pgctl           # first attempt hung (error 3); fixed, then re-run
pg_ctl.exe stop -D .data\pg -m fast -w -t 60       # cleanup after the hang
node spike.mjs crash           # start → insert → hard-kill own Node process
node spike.mjs recover         # status → restart → verify
node spike.mjs bad-migration
node spike.mjs robustness      # double start, force-kill postmaster, stale pid, auth, clean stop
node spike.mjs utf8            # WIN1252 failure shown; UTF-8 cluster verified

# Final run: fresh cluster with recommended flags, each phase a new process
SPIKE_PROFILE=final  node spike.mjs info|phase1|phase2|pgctl|crash|recover|robustness|bad-migration
```

(One earlier final-profile attempt failed because of error 4 above and is superseded by the run
recorded here. Interrupted helper shells were stopped and every server shut down; `postgres`
process count was 0 at the end.)

## Recommendation for the application (Step 1)

Use the PostgreSQL 17.10 binaries delivered by `embedded-postgres`, but drive them with a small
script of our own:

1. `initdb` once with the UTF-8 flags above, `scram-sha-256`, a generated local password (from `.env`,
   never committed), and the password file deleted afterwards.
2. `db:start`: `pg_ctl status` → if not running, `pg_ctl start` with output to a log **file**, then
   poll a real connection until ready (30 s limit). Idempotent.
3. `db:stop`: `pg_ctl stop -m fast`. Never use the package's `start()`/`stop()` for the app.
4. The server runs detached, so API/web restarts do not restart the database.
5. Localhost only, port 5433, data in git-ignored `.data/pg`.
6. **Open item for Step 10 (backups):** `pg_dump` is not bundled. Get it from the official
   PostgreSQL 17 portable zip binaries (no admin rights expected; not yet verified) when we build the
   backup script. It does not block Steps 1–9.

**Fallback (not triggered):** the official portable PostgreSQL zip. The same `initdb`/`pg_ctl`
script would work with only the binary path changed. Hosted Postgres (synthetic data only) remains
the last resort via `DATABASE_URL`.
