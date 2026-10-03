# ADAXAI MVP

ADAXAI Connected Clinical Platform: a role-based clinical web platform (Doctor, Nurse, Admin and
Patient portals) with **Mana AI**, the doctor's patient-record companion; a Fastify API on
PostgreSQL; and a Python service for thermal imaging, image validation and dataset evaluation.

Product specification: [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) · design system: [docs/DESIGN.md](docs/DESIGN.md) · audit of the current state:
[docs/AUDIT.md](docs/AUDIT.md) · progress and test results: [docs/STATUS.md](docs/STATUS.md) ·
decisions: [docs/adr/](docs/adr/).

> **Status: MVP in development.** Use synthetic data only. This software is not a medical
> device, is not clinically validated and is **not production-ready** (see
> [Known limitations](#known-limitations)).

## What is implemented

| Area | What is real today |
| --- | --- |
| Foundation | PostgreSQL 17.10 (UTF-8), checksummed migrations, API, web app, Python service, YAML settings validated at start-up |
| Sign-in and access | Session sign-in, roles (admin, doctor, nurse, patient), server-side default-deny permissions, forced temporary-password change, lockout, append-only audit log linked by a SHA-256 hash chain (check from the admin portal or `npm run audit:verify`) |
| Admin portal | Users, departments, audit log viewer, operational overview, system status, devices registry, thermal data, AI operations (counts only) |
| Patients | Registration (auto MRN, duplicate warning), search by name/MRN/phone (incl. non-Latin scripts), profile, allergies with explicit “no known allergies”, consents (grant/withdraw, versioned wording, history kept), patient-portal activation codes |
| OPD queue and nurse workflow | Check-in with atomic daily tokens, one open visit per patient per day, priority, department/doctor assignment, server-enforced status transitions, vitals with plausibility checks and adult reference-range flags (not applied under 18; display aid only), entered-in-error corrections, auto-refresh |
| Routing assistance | Deterministic rules in `config/routing.yaml` (department, red flags with escalation instructions, urgent-for-review priority, missing intake, least-busy clinician); staff apply or override with a reason; rules version stored |
| Doctor consultation | Structured note, diagnoses (ICD-10 format check only), prescription editor, autosave with conflict detection, review-and-sign with attestation, signed records frozen in the database with a SHA-256 content hash, append-only amendments, printable prescription (labelled not valid), patient timeline |
| Mana AI (patient-record companion) | Doctor asks about one patient (suggested questions or free text): pre-consultation briefing, history summary, last prescription, vital signs compared with the previous reading, changes since the previous visit, allergies, diagnoses, record search. Answers come from the record by explicit versioned rules (`mana-record-v1`, no AI key needed): every statement cites the record item (type, consultation, date, field, status, provenance) with a link; absence, conflicts, outdated and amended records are flagged. Optional AI summary (`mana-qa-v1`) only with a provider key **and** the patient's `ai_record_assistant` consent, labelled AI-generated, citations verified on the server. Answers are immutable and audited; doctors mark them reviewed or insert them into the note |
| AI text in notes | AI or rule output enters a note only through a server-recorded insertion of reviewed output, which keeps a reference to the AI artifact (provider, model, prompt or rules version); shown under the note section, in the sign dialog and on the signed record; listed in the signed snapshot |
| AI consultation assistant | Consent, typed/pasted transcript, audio upload and recording, live chunked transcription (needs STT key), note drafting, fact extraction with speaker attribution and transcript evidence, deterministic comparison with the record, rule-based safety checks (no AI needed), history-aware recommendations citing record items, accept/edit/reject/defer for every AI output with confirmation gates, jobs with retry and idempotency, activity and audit trail. See [AI: what is and is not real](#ai-what-is-and-is-not-real) |
| Clinical photographs | Consent-gated JPEG/PNG/WebP upload validated by the Python service (DICOM rejected), original kept unchanged, metadata-free preview, optional AI description marked unverified and reviewed before use |
| FLIR thermal imaging | Consent-gated radiometric JPEG upload with capture protocol, per-pixel °C matrix via `flyr`, viewer, regions with statistics and paired differences, doctor approval (then frozen) |
| Thermal data workflow | Clinician labels (versioned taxonomy, withdraw-only), data origin per image, experimental rule-based flags (not validated), de-identified dataset export (research consent only), evaluation pipeline that refuses to train without enough labelled data |
| AI oversight | Admin AI operations (counts only), doctor review list of rejected/edited AI output, review-outcome snapshots as evaluation runs, checksummed prompt versions, model registry, settings snapshots |
| Patient portal (PWA) | Activation with MRN + one-time code; the patient's own signed records with prescriptions and amendments, visits, vital signs, consents, profile and allergies, approved thermal measurements; installable (manifest, icons, service worker that caches only the app shell, never `/api/`) |
| Devices | **Integration boundary only, no hardware integrated**: registry, assignment to consenting patients, token-authenticated gateway ingestion API (readings stored as *device, unverified*), stethoscope audio upload and playback. See [docs/DEVICES.md](docs/DEVICES.md) |
| Record lifecycle | Visit and consultation state machines enforced by the API and the database, with status history (who, when, how, why); **My consultations** worklist of unsigned drafts from any day and recent signed records; discarding a draft with a reason (kept read-only); versioned signed-record verification including the amendment chain; see [ADR 0008](docs/adr/0008-record-lifecycle-and-signed-record-verification.md) |
| Appointments and notifications | Booking and rescheduling by staff on the facility's clock, with no double booking for a doctor or a patient (database constraints), cancel and did-not-attend with reasons, status history, **check-in that creates or joins exactly one visit** (idempotent, race-safe) and starts no consultation, schedule pages for doctors, nurses and administrators (administrators see no patient identity or free text), the patient's own appointments in the portal. Messages go through an outbox with recorded attempts and safe retries; **the only channel is the patient portal: no SMS, email or push is sent**. See [ADR 0010](docs/adr/0010-appointments-visit-linkage-and-notification-outbox.md) |
| Operations | Cold backup / verify / restore, audio retention, orphan-file check, synthetic demo seed, audit-chain verification, database identity guard for test tooling |

## Accounts and security model

- **Demo staff accounts** (synthetic): `admin`, `dr.meera`, `dr.rahul`, `nurse.anil`. Sign in
  with the **username** (not an email address; not case-sensitive). The password for all four is
  the value of `SEED_DEMO_PASSWORD` in your local `.env` (a random 32-character value generated by
  `npm run setup`; copy it exactly, without spaces). Seeded accounts are not asked to change it.
  To see it in PowerShell: `Select-String -Path .env -Pattern '^SEED_DEMO_PASSWORD='`.
- **Demo patient account**: none is pre-created. A nurse records portal consent and issues an
  activation code on the patient's record; the patient activates at `/activate` with their MRN,
  the code and a password of their choice (see [docs/DEMO.md](docs/DEMO.md)).
- **Passwords** are hashed with Argon2id. Staff created by an administrator get a temporary
  password and must change it at first sign-in.
  Five failed attempts lock an account for 15 minutes:
  - the lockout is atomic, so concurrent guesses count;
  - unknown usernames get the same locked answer;
  - wrong current passwords at a password change count too.
  Sign-in, activation, password change and device ingestion are also rate limited per address,
  account, user or token (`config/adaxai.yaml` → `security.rateLimits`; kept in memory).
  Unknown usernames are never written to the audit log.
- **Sessions** are server-side: an `httpOnly`, `SameSite=Lax` cookie with a random token; the
  database stores only its SHA-256 hash. 60 minutes idle / 12 hours absolute.
- **Authorization is enforced by the API on every route** (default deny;
  `apps/api/src/auth/permissions.ts`).
  - Every `/api` route must declare `public`, a permission or `anySession`, or the API refuses to
    start. A test checks the full route-by-role matrix.
  - Staff and admin data are limited to the caller's facility; a patient or consultation of
    another facility is "not found", and the attempt is audited.
  - The web app hides controls too, but that is convenience only.
  - Denied requests are audited, including refusals inside routes.
  - Administrators cannot read clinical records. They see that a device is in use, not by whom.
  - Only the doctor who signed a consultation can amend it.
  See [ADR 0007](docs/adr/0007-default-deny-routes-facility-scope-and-denial-audit.md).
- **Patient isolation:** portal routes take the patient from the session and never accept a
  patient id; patients cannot reach any staff, file, AI, image, thermal or device endpoint.
  Tests probe every route family as patient A with patient B's ids.
- **Consent** is enforced by the API for every purpose:
  - recording and AI;
  - Mana AI summaries;
  - photographs and their AI description;
  - thermal images;
  - device readings;
  - portal access;
  - research datasets.
  States are granted, granted under an earlier wording (renew), withdrawn, and not recorded.
  Withdrawal takes effect at once:
  - portal access: the account is switched off and the patient signed out;
  - device consent: device assignments end;
  - research consent: datasets that include the patient are blocked.
  Patients can withdraw their own consents in the portal. Refusals are audited. See
  [ADR 0006](docs/adr/0006-consent-lifecycle-and-enforcement.md).
- **CSRF:** state-changing requests must carry `x-adaxai-csrf: 1`.
- **Responses:** every API response is `Cache-Control: no-store` with `nosniff`, `no-referrer`
  and `X-Frame-Options: DENY`.
- **Audit log:**
  - sign-ins and permission denials;
  - every read of a patient's record, files, AI artifacts, images, thermal data and portal pages;
  - the patients each list or search disclosed;
  - every change and every AI review decision;
  - consent grants, renewals, withdrawals and refusals.
  Each row carries its facility. Database triggers make the log append-only, and the API's
  database role has no UPDATE or DELETE on it (or on any other append-only table).
  Since migration 0019 every event is linked into a SHA-256 hash chain by the database. Events
  from before that are summarised by a digest in the chain's first event.
  - Changed, removed, reordered or unlinked events are reported by the check.
  - Removal of the newest events, or a full rewrite by someone with database superuser access,
    is detected only against a head recorded outside the system. It is tamper evidence, not
    tamper proofing. See [ADR 0009](docs/adr/0009-audit-hash-chain-and-append-only-privileges.md).

  Request logs record paths only (never search terms).
- **Signed records** carry a versioned SHA-256 fingerprint (`adaxai.encounter.v2`; older records
  `v1`); amendments are hash-linked to it. **Record verification** re-checks them on request.
  A match is not a digital signature and says nothing about clinical correctness.

## Requirements

- **Node.js 22.12+** (developed on Node 24.13) and npm
- **Python 3.11+** (developed on 3.12; on Windows found through the `py` launcher, or set `PYTHON`)
- No Docker, no PostgreSQL install, no admin rights. PostgreSQL binaries come from the
  `embedded-postgres` npm package.
- Verified on Windows 11 (x64) only. macOS/Linux binaries exist in the same package but these
  scripts are **not verified** there.
- Optional: `ANTHROPIC_API_KEY` (drafting, extraction, recommendations, image description),
  `AI_STT_API_KEY` (speech-to-text). Everything else works without them.

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

Then open <http://127.0.0.1:5173>. For a demonstration patient with history:

```bash
npm run demo:seed
```

`npm run setup` is safe to re-run. It creates `.env` from `.env.example` with generated local
passwords, initialises and starts PostgreSQL, creates the app role and the dev/test/e2e
databases, runs migrations, seeds synthetic staff, creates the Python virtualenv, fetches the
public thermal sample files and installs Playwright's Chromium (`-- --skip-browsers` skips it).

PostgreSQL keeps running after `npm run dev` exits; stop it with `npm run db:stop`.

## AI: what is and is not real

| Capability | Status |
| --- | --- |
| Transcript (typed, pasted), audio storage and playback, consent | Works without credentials |
| Rule-based safety checks (allergy vs prescription incl. an illustrative group list, vital-sign flags, missing information, red-flag phrases, record conflicts) | Works without credentials; deterministic, versioned (`safety-rules-v1`, `record-compare-v1`) |
| Routing suggestions | Works without credentials; deterministic |
| Mana record answers (briefing, history, last prescription, vitals comparison, changes, allergies, diagnoses, search) | Works without credentials; deterministic, versioned (`mana-record-v1`) |
| Mana AI summaries | **Need `ANTHROPIC_API_KEY`** and the patient's `ai_record_assistant` consent; otherwise the answer says why and shows the record answer only |
| Note drafting, fact extraction, recommendations, image description | **Need `ANTHROPIC_API_KEY`.** Without it the UI says the feature is unavailable and never shows placeholder output |
| Transcription of uploaded or recorded audio, live chunked transcription | **Need `AI_STT_API_KEY`** (OpenAI-compatible endpoint). Finished text per chunk; no interim text |
| Speaker identification | Only from “Doctor:” / “Patient:” labels in the text; provider diarisation is not implemented |
| Clinical accuracy of any AI output | **Not evaluated.** Tested only against test doubles and a local mock of the provider API |

- **Drafts only.** Nothing reaches the note until the doctor accepts or edits an item and adds
  it; the server records each insertion with a reference to the AI artifact, and the signed
  snapshot lists them; flagged or unsupported items need explicit confirmation; signing stays a
  separate, attested action. A test proves that accepting AI output never changes the consultation and is
  not in the signed record unless the doctor saved it in the note. The assistant never
  diagnoses, prescribes, changes medicines, closes a consultation or contacts the patient.
- **Provenance.** Facts and recommendations link to transcript lines or record items
  (`ai_evidence`), with who said or recorded it. Unverifiable citations are marked unsupported.
- **Versions and logs.** Every job records provider, answering model, prompt or rules version,
  tokens, latency, errors, data origin and a hash of the non-secret AI settings. Prompt texts are
  checksummed: a changed prompt must get a new version id.
- **Consent.** `ai_recording` (wording `2026-10-v2`) covers recording, drafting and record-aware
  recommendations; Mana AI summaries need `ai_record_assistant` (Mana record answers do not);
  photographs need `clinical_photography`, their AI description `ai_image_analysis`.
- **Privacy.** Registered names, MRN, phone numbers and emergency-contact details are replaced
  before text is sent; only age band and sex are sent; only a metadata-free photo preview. Other
  identifiers spoken in conversation may still be present. Sending data to a provider requires
  the patient's consent and a data-processing agreement with the provider.
- **No automatic learning.** Doctor decisions are recorded and summarised; nothing is retrained.
- **Architecture note.** Calls to hosted providers are thin adapters in the Node API behind
  provider-neutral interfaces (`apps/api/src/ai/providers.ts`). The Python service does local
  processing. A self-hosted model would be a Python service behind the same interfaces.

## Thermal imaging: what is and is not real

- **Measurements only**, not a diagnosis, not clinically validated.
- **Correctness check:** for the sample files, `flyr` temperatures match an independent
  implementation of the FLIR raw-to-temperature formula within 0.0001 °C. That is consistency,
  **not** absolute accuracy (which needs a blackbody reference and the clinic's own camera).
- **Camera compatibility is unverified.** Tests use public sample images (FLIR AX8, a generic
  FLIR file, and a DJI Zenmuse XT-R file that is rejected). Fetched by `npm run setup` (MIT
  licence, `samples/thermal/SOURCE.txt`).
- **Licence to review:** `flyr` is EUPL-1.2 (copyleft).
- **Datasets:** no trained model ships; the evaluation pipeline will not train below 20 positive
  and 20 negative labelled images from 10 subjects. Exports contain only approved images of
  patients with research consent, de-identified. Reports say prominently when data is
  non-clinical. Offline: `services/thermal/.venv/Scripts/python -m app.evaluate dataset.zip`.

## Patient portal

Patients see only finalised information about themselves: signed consultation records with
prescriptions and later amendments, visits, measured vital signs (device readings marked as such),
consents, profile and allergies, and doctor-approved thermal measurements. Drafts, transcripts,
audio, photographs and AI output are never shown. The app is installable (manifest, icons); its
service worker caches only the application shell and hashed build files and never `/api/`
responses (`apps/web/public/sw-policy.js`, unit-tested). Signing out clears all cached data in
the page.

## Services and ports

All services listen on localhost only.

| Service | URL |
| --- | --- |
| Web app | <http://127.0.0.1:5173> |
| API | <http://127.0.0.1:4000/api/health> (proxied by the web app under `/api`) |
| Python service | <http://127.0.0.1:8001/health> (OpenAPI docs at `/docs`) |
| PostgreSQL | `127.0.0.1:5433` |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | One-time / repeatable local setup |
| `npm run dev` | Start PostgreSQL (if needed), API, web and Python service |
| `npm run demo:seed` | Add the synthetic demo patient (idempotent) |
| `npm run db:start` / `db:stop` / `db:status` | PostgreSQL lifecycle |
| `npm run db:selftest` | Persistence check: write → clean stop → start → read, plus UTF-8 round-trip |
| `npm run db:migrate` | Apply migrations to the dev database (`-- --target test` or `e2e`). Also marks what the database is for (development, test or e2e) and refuses a database marked for something else |
| `npm run db:seed` | Synthetic staff and departments (idempotent) |
| `npm run db:generate` | Generate a new SQL migration from `apps/api/src/db/schema.ts` |
| `npm run backup` | Cold backup of the database and uploaded files to `backups/` (stop the app first) |
| `npm run backup:verify -- <dir>` | Start the backup on a spare port and check counts and files |
| `npm run backup:restore -- <dir> --yes` | Restore; the current data is moved aside, not deleted |
| `npm run user:reset-password -- <username> [--seed-password]` | Local recovery of a staff account (lockout or lost password): a one-time temporary password, or back to `SEED_DEMO_PASSWORD`; clears lockout, ends sessions, audited with the OS user and host, never touches patient data. On production or clinical installations `--seed-password` is refused and a reset needs `--break-glass --reason "…"` |
| `npm run retention [-- --dry-run]` | Delete consultation audio of signed consultations older than the configured days |
| `npm run audit:verify -- [--target test\|e2e] [--anchor <seq>:<hash>]` | Check the audit log's hash chain (read-only) and print its head; with an anchor recorded earlier, detect removal of the newest events |
| `node scripts/storage-orphans.mjs [--delete]` | List (or remove) stored files the dev database does not reference (`--delete` only on a database marked as development) |
| `npm test` | API, web, Python and end-to-end tests |
| `npm run test:api` | Vitest against the real test database `adaxai_test` |
| `npm run test:web` | Service-worker caching policy (node --test) |
| `npm run test:thermal` | pytest |
| `npm run test:e2e` | Playwright (desktop + mobile Chromium) with axe WCAG 2.2 AA and phone-overflow checks |
| `npm run lint` | oxlint (warnings fail) + ruff |
| `npm run typecheck` | TypeScript across all workspaces and the e2e tests |

**Test isolation:** API tests use `adaxai_test` and `storage-test/`; the end-to-end suite starts
its own API (4100), Python service (8101) and web app (5273) against `adaxai_e2e` and
`storage-e2e/`. Neither touches the development database or `storage/`, and both can run while
`npm run dev` is up.

This is enforced, not only configured:
- `DB_NAME`, `DB_TEST_NAME` and `DB_E2E_NAME` must all differ, and the test and e2e names must end
  in `_test` and `_e2e`;
- each database carries an identity marker (`meta.database_identity`) set by `db:migrate`;
- the test helpers' reset, `db.mjs reset` and `storage-orphans --delete` refuse unless the database
  identifies as the expected one;
- the e2e configuration stops before starting any server if the names are ambiguous.

Nothing prints connection secrets.

**Upgrading an installation made before this guard existed.** The test and e2e databases already
hold data but carry no identity marker, so setup and the test commands refuse to treat them as
disposable. After checking that they are the test databases, mark them once:

```bash
npm run db:migrate -- --target test --claim-existing
```

```bash
npm run db:migrate -- --target e2e --claim-existing
```

AI output in tests comes from test doubles or the test-only mock server `e2e/mock-anthropic.mjs`.

## Backup and restore

`pg_dump` is not bundled with the embedded binaries, so backups are **cold copies**: the script
stops PostgreSQL, copies the data directory and `storage/`, starts PostgreSQL again and writes a
manifest with row counts. This is a complete, consistent backup for the same PostgreSQL major
version (17) and platform.

```bash
npm run backup
```

```bash
npm run backup:verify -- backups/adaxai-<timestamp>
```

```bash
npm run backup:restore -- backups/adaxai-<timestamp> --yes
```

Stop `npm run dev` first (the scripts refuse while the API is running). `verify` starts a copy
on port 5499 and checks counts and that every referenced file is present, without touching your
data. `restore` moves the current data to `.data/pg.before-restore-*` and
`storage.before-restore-*` before copying the backup in. Backups contain patient data: keep them
encrypted and access-controlled.

## Database

- **Encoding:** `--encoding=UTF8 --locale=C --locale-provider=builtin --builtin-locale=C.UTF-8`
  (without it Windows picks WIN1252 and rejects non-Latin names).
- **Lifecycle:** `scripts/db.mjs` drives `initdb` and `pg_ctl` directly (reasons in
  [`spikes/postgres/RESULTS.md`](spikes/postgres/RESULTS.md)).
- **Roles:** `DB_ADMIN_USER` (superuser, scripts and migrations only); the API connects as
  `DB_APP_USER` (data only).
- **Databases:** `adaxai` (development), `adaxai_test`, `adaxai_e2e`.
- **Lifecycle in the database:** visit and consultation status changes are validated by triggers
  (the same transitions as the API) and recorded in `visit_status_events` and
  `encounter_status_events` with the acting user.
- **Integrity in the database:** triggers keep signed and discarded records, amendments, audit events, status history, AI
  evidence, review history, transcript segments, evaluation runs, photographs and stethoscope
  recordings append-only or frozen, and allow reviewed AI output, labels, routing suggestions and
  device assignments to change only in their single permitted way.
- **Migrations:** `apps/api/drizzle/`, each in its own transaction with a checksum; never edit an
  applied migration. They are additive. Before applying new ones to a database that holds data,
  stop the app (`Ctrl+C` in the `npm run dev` window), take a cold backup with `npm run backup`,
  check it with `npm run backup:verify -- <dir>`, then restart. Migration 0022 enables the
  `btree_gist` extension (bundled with the PostgreSQL binaries) for the no-double-booking constraints.
- **On disk (git-ignored):** `.data/pg`, `.data/logs`, `storage/`, `storage-test/`,
  `storage-e2e/`, `backups/`.

## Configuration

`.env` (created by setup, git-ignored) holds secrets, ports, `DATA_ORIGIN` and optional model
overrides; see [`.env.example`](.env.example) for every variable. Non-secret settings are YAML,
validated strictly at start-up:

| File | Contents | When changes apply |
| --- | --- | --- |
| [`config/adaxai.yaml`](config/adaxai.yaml) | AI features, models, effort, timeouts, live chunk length, context limits, Mana record window and outdated threshold, upload types and limits, retention, safety-rule groups and tolerances | **API restart** |
| [`config/routing.yaml`](config/routing.yaml) | Routing rules, red-flag phrases and instructions, required intake | **At runtime** (re-read on change; an invalid edit keeps the last valid rules) |
| `.env` | Secrets, ports, `DATA_ORIGIN`, `AI_NOTE_MODEL`, `AI_STT_*` | **Restart** |

`DATA_ORIGIN` (default `synthetic`) is recorded on AI jobs, photographs, stethoscope recordings
and thermal images; set `clinical` only in a real clinical deployment.

## Known limitations

**Clinical**
- No AI output, rule, flag or measurement is clinically validated. AI was exercised only with
  test doubles and a local mock; quality with real providers, Indian languages and real
  consultations is unknown.
- Mana's record answers cover the listed question types; other questions fall back to a word
  search of the record (no paraphrase). The "possibly outdated" threshold is a display setting,
  not clinical guidance.
- Red-flag phrase matching is simple text matching with basic negation handling; it misses
  paraphrases and is not triage.
- The allergy group list is illustrative and incomplete; it is not a drug or cross-reactivity
  database. Vital-sign flags use adult ranges only.
- Thermal measurements depend on capture conditions; camera compatibility is unverified.
- No device has been integrated; device readings can only arrive through the documented gateway
  API and are always marked unverified.
- Prescriptions are not valid for dispensing in this build.

**Security and operations**
- Local single-machine deployment only: no TLS, no reverse proxy, no rate limiting beyond sign-in
  lockout, no multi-factor authentication, no external security review or penetration test.
- Pseudonymisation before AI calls is best effort (registered identifiers only).
- Backups are cold copies requiring brief downtime; there is no point-in-time recovery,
  encryption of backups or off-site copy.
- Audit coverage is extensive but has not been assessed against a specific regulation; no
  regulatory compliance is claimed.
- Rate limits are kept in memory by the single API process (a restart clears them).
- The audit hash chain and record fingerprints are unkeyed SHA-256: tamper evidence within this
  database, not proof. Someone with the database superuser password (stored in the local `.env`)
  could rewrite records and recompute every hash. Only a head recorded outside the system reveals
  that, or the removal of the newest events.
- Every audited request waits briefly for the audit chain's lock; this has not been measured under
  load.
- Appointments: there are no clinic hours, clinician calendars, department capacity limits,
  recurring appointments or waiting lists; patients cannot book or cancel for themselves; no
  reminders are sent (nothing schedules them); a missed appointment is marked by staff, not
  automatically. Messages reach the patient portal only: a patient without a portal account is
  not told by any other route. The length and horizon rules (10 to 60 minutes, up to 180 days
  ahead) are conservative defaults, not clinical policy.
- Unsigned drafts can be edited, signed or discarded only by their author; there is no supervised
  reassignment yet.
- "Care records" (`data_processing`) consent is recorded and shown but not enforced: whether care
  depends on it is a legal decision that needs qualified review.

**Compatibility**
- Verified on Windows 11 x64 with Chromium (Playwright) only; other browsers and macOS/Linux are
  untested. Web Bluetooth and direct device connections are not used.
- Speech-to-text needs an OpenAI-compatible endpoint; live transcription restarts the browser
  recorder per chunk (short gaps between chunks are possible).
- Images: JPEG, PNG, WebP only (no DICOM). Thermal: FLIR radiometric JPEGs readable by `flyr`.

## Project layout

```
apps/
  api/            Fastify API, Drizzle schema, migrations (drizzle/), tests
  web/            React + Vite + Tailwind web app (all portals), PWA files in public/
packages/
  contracts/      Zod schemas shared by api and web
services/
  thermal/        FastAPI service: thermal, image validation, dataset evaluation (Python)
config/           YAML settings (no secrets)
docs/             PRODUCT_SPEC.md, DESIGN.md, AUDIT.md, STATUS.md, DEMO.md, DEVICES.md, adr/ (decisions)
demo/             Synthetic consultation transcript
scripts/          db lifecycle, setup, backup, retention helpers, icons
e2e/              Playwright end-to-end tests (and the test-only AI mock)
spikes/postgres/  PostgreSQL feasibility spike (reference only)
```

## Troubleshooting

- **“Invalid username or password”**: use the username (`admin`, `dr.meera`, `dr.rahul`,
  `nurse.anil`), not an email address; patients use their MRN. The password is the exact value of
  `SEED_DEMO_PASSWORD` in `.env`. Seeding never changes an existing user's password, so if `.env`
  was edited after setup, or the password is lost, run
  `npm run user:reset-password -- admin --seed-password` (sets it back to `SEED_DEMO_PASSWORD`) or
  `npm run user:reset-password -- admin` (prints a one-time temporary password). If no users exist
  at all, set `SEED_DEMO_PASSWORD` in `.env` and run `npm run db:seed`.
- **“Too many failed sign-in attempts”**: 5 wrong passwords lock an account for 15 minutes. Wait,
  ask an administrator to reset the password, or use `npm run user:reset-password` as above.

- **`Port 5433 is served by a different PostgreSQL`**: set a different `DB_PORT` in `.env`.
- **`PostgreSQL rejected DB_ADMIN_PASSWORD`**: `.env` no longer matches the cluster. Restore the
  original `.env`, or (losing local data) stop the server, delete `.data/pg` and run setup.
- **After a crash**: `npm run db:start` handles a stale `postmaster.pid`.
- **Ports 4000/5173/8001 still in use after `npm run dev` ended**: stop it with Ctrl+C. If the
  terminal was closed, Windows can leave child processes running; end them in Task Manager.
- **Code changes not picked up by `npm run dev`**: the API (`tsx watch`) and the Python service
  (`uvicorn --reload`) occasionally miss changes on Windows; restart `npm run dev`.
- **Windows PowerShell 5.1**: do not rewrite source files with `Get-Content`/`Set-Content`
  (ANSI encoding corrupts non-ASCII text).
