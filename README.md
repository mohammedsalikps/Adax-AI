# ADAXAI MVP

Role-based clinical web platform (Doctor, Nurse, Admin and Patient portals), a Fastify API on
PostgreSQL, and a Python thermal-imaging service.

> **Status: Step 1 (foundation) only.** There is no sign-in, no patient data, no AI and no
> thermal processing yet. Use synthetic data only. This software is not a medical device and is
> not clinically validated.

## What exists in Step 1

| Part | What is real today |
| --- | --- |
| PostgreSQL 17.10 | Local cluster, UTF-8 (builtin `C.UTF-8` locale), started/stopped with `pg_ctl`, data persisted in `.data/pg` |
| Migrations | Transactional, checksummed runner; extensions (`pgcrypto`, `citext`, `pg_trgm`) and a `facilities` table |
| Seed data | One synthetic facility (`DEMO-OPD-01`) |
| API (`apps/api`) | `GET /api/health`, `GET /api/ready`, `GET /api/system/status` |
| Thermal service (`services/thermal`) | `GET /health` only; reports `capabilities: []` |
| Web (`apps/web`) | App shell with portal placeholders and a live system-status panel |

## Requirements

- **Node.js 22.12+** (developed on Node 24.13) and npm
- **Python 3.11+** (developed on 3.12; on Windows found through the `py` launcher, or set `PYTHON`)
- No Docker, no PostgreSQL install and no admin rights are needed. PostgreSQL binaries come from
  the `embedded-postgres` npm package.
- Verified on Windows 11 (x64). macOS/Linux binaries exist in the same package but are **not yet
  verified** with these scripts.

## Quick start

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

Then open <http://127.0.0.1:5173>.

`npm run setup` is safe to re-run. It creates `.env` from `.env.example` with generated local
passwords, initialises and starts PostgreSQL, creates the app role and the dev/test databases,
runs migrations, seeds synthetic data, creates the thermal virtualenv and installs Playwright's
Chromium. (`npm run setup -- --skip-browsers` skips the browser download.)

PostgreSQL runs in the background and keeps running after `npm run dev` exits:

```bash
npm run db:stop
```

## Services and ports

All services listen on localhost only.

| Service | URL |
| --- | --- |
| Web app | <http://127.0.0.1:5173> |
| API | <http://127.0.0.1:4000/api/health> (proxied by the web app under `/api`) |
| Thermal service | <http://127.0.0.1:8001/health> (OpenAPI docs at `/docs`) |
| PostgreSQL | `127.0.0.1:5433` |

Ports are set in `.env` (`API_PORT`, `WEB_PORT`, `THERMAL_PORT`, `DB_PORT`).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | One-time / repeatable local setup (see above) |
| `npm run dev` | Start PostgreSQL (if needed), API, web and thermal service together |
| `npm run db:start` | Start PostgreSQL; no-op if running; succeeds only after a real connection |
| `npm run db:stop` | Clean shutdown (`pg_ctl stop -m fast`) |
| `npm run db:status` | Running state, encoding, locale, databases, app role |
| `npm run db:selftest` | Persistence check: write → clean stop → start → read, plus UTF-8 round-trip |
| `npm run db:migrate` | Apply migrations to the dev database (`-- --target test` for the test database) |
| `npm run db:seed` | Insert synthetic seed data (idempotent) |
| `npm run db:generate` | Generate a new SQL migration from `apps/api/src/db/schema.ts` |
| `npm run db:provision` | Re-apply roles, databases and grants (idempotent) |
| `npm test` | API tests, thermal tests, then end-to-end tests |
| `npm run test:api` | Vitest against the real test database |
| `npm run test:thermal` | pytest |
| `npm run test:e2e` | Playwright (desktop + mobile Chromium) with axe WCAG 2.2 AA checks |
| `npm run lint` | oxlint (warnings fail) + ruff |
| `npm run typecheck` | TypeScript across all workspaces and the e2e tests |

## Database

- **Encoding:** the cluster is initialised with
  `--encoding=UTF8 --locale=C --locale-provider=builtin --builtin-locale=C.UTF-8`. Without these
  flags `initdb` on Windows picks the system code page (WIN1252) and rejects non-Latin names.
- **Lifecycle:** `scripts/db.mjs` drives `initdb` and `pg_ctl` directly. It does not use the
  `embedded-postgres` package's own start/stop, because its stop is a forced kill on Windows. The
  reasons and evidence are in [`spikes/postgres/RESULTS.md`](spikes/postgres/RESULTS.md).
- **Roles:** `DB_ADMIN_USER` (cluster superuser) is used only by the scripts and migrations.
  The API connects as `DB_APP_USER`, which can read and write data but cannot create tables or
  change the migration ledger.
- **Databases:** `adaxai` (development) and `adaxai_test` (tests).
- **Migrations:** schema in `apps/api/src/db/schema.ts`; `npm run db:generate` writes SQL to
  `apps/api/drizzle/`. Review the SQL before committing. The runner applies each file in its own
  transaction, records it in `meta.schema_migrations` with a checksum, and refuses to run if an
  applied file was edited. Never edit an applied migration; add a new one.
- **Files on disk:** `.data/pg` (cluster), `.data/logs` (server log), `storage/` (uploads, later).
  All are git-ignored.

## Configuration

Copy-and-fill is automatic (`npm run setup`). See [`.env.example`](.env.example) for every
variable. `.env` holds local credentials and is git-ignored. Never commit it, and never put
real patient data in seed files.

## Project layout

```
apps/
  api/            Fastify API, Drizzle schema, migrations (drizzle/), tests
  web/            React + Vite + Tailwind web app (all role portals)
packages/
  contracts/      Zod schemas shared by api and web
services/
  thermal/        FastAPI thermal service (Python)
scripts/          db lifecycle, setup, thermal helpers
e2e/              Playwright end-to-end tests
spikes/postgres/  PostgreSQL feasibility spike and its results (reference only)
```

## Troubleshooting

- **`Port 5433 is served by a different PostgreSQL`**: another server uses that port. Set a
  different `DB_PORT` in `.env`.
- **`PostgreSQL rejected DB_ADMIN_PASSWORD`**: `.env` no longer matches the cluster. Restore the
  original `.env`, or (losing local data) stop the server, delete `.data/pg` and run `npm run setup`.
- **After a crash or a killed process**: `npm run db:start` handles a stale `postmaster.pid`;
  PostgreSQL recovers automatically on start.
- **Ports 4000/5173/8001 still in use after `npm run dev` ended**: stop `npm run dev` with Ctrl+C
  in its terminal. If the terminal was closed or the process killed, Windows can leave the child
  processes running; end them in Task Manager (`node.exe` / `python.exe`).
- **Windows PowerShell 5.1**: do not rewrite source files with `Get-Content`/`Set-Content`; they
  default to ANSI and corrupt non-ASCII text.
- **Backups**: `pg_dump` is not bundled with the embedded binaries. A backup script is planned for
  a later step.
