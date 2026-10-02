# ADAXAI MVP

Role-based clinical web platform (Doctor, Nurse, Admin and Patient portals), a Fastify API on
PostgreSQL, and a Python thermal-imaging service.

> **Status: in development.** Use synthetic data only. This software is not a medical device,
> is not clinically validated and is not production-ready. See "Implemented so far" below.

## Implemented so far

| Area | What is real today |
| --- | --- |
| Foundation | PostgreSQL 17.10 (UTF-8), migrations, API, thermal-service health, web app |
| Sign-in and access | Session sign-in, roles (admin, doctor, nurse, patient), server-side permissions, forced temporary-password change, lockout, append-only audit log |
| Admin portal | Users (create, edit, deactivate, reset password), departments, audit log viewer, operational overview, system status |
| Patients | Registration (auto MRN, duplicate warning with audited override), search by name/MRN/phone (incl. non-Latin scripts), profile, allergies with explicit “no known allergies”, consents (grant/withdraw, history kept), patient-portal activation codes |
| OPD queue and nurse workflow | Check-in with atomic daily tokens, one open visit per patient per day, priority, department/doctor assignment, server-enforced status transitions, vitals with plausibility checks and adult reference-range flags (not applied under 18; display aid only), entered-in-error corrections, doctor “my patients” view, auto-refresh |
| Doctor consultation | Start/continue from the queue, structured note (complaint, history, medical history, examination, assessment, plan, follow-up), diagnoses (ICD-10 format check only), prescription editor, autosave with conflict detection, review-and-sign with attestation, signed records frozen in the database with a SHA-256 content hash, append-only amendments, printable prescription (labelled not valid in this build), patient timeline |
| AI consultation assistant | Patient consent (ongoing or per consultation), browser recording / audio upload / typed transcript, numbered transcript segments, speech-to-text (OpenAI-compatible endpoint) and note drafting with Claude (`claude-opus-5-5`, structured output, server-side refusal fallback) when keys are configured, identifiers replaced before sending, per-suggestion accept/edit/reject with cited transcript lines, unsourced suggestions flagged, every AI call logged (model, prompt version, tokens, outcome). Without keys the app states that AI is unavailable. |
| FLIR thermal imaging | Consent-gated upload of radiometric JPEGs with capture protocol, extraction of the per-pixel °C matrix and camera settings (Python service, `flyr`), viewer with palettes, span/level and hover readout, rectangle/ellipse regions (drawn or typed) with min/max/mean/SD and paired differences computed by the service, doctor approve/reject (then frozen in the database), visible-light image without location data |
| Clinical AI assistant (expanded) | Fact extraction from the transcript with categories, speaker attribution, uncertainty flags and links to transcript lines; deterministic comparison with the record (allergies, medicines, vitals); rule-based safety checks that work without any AI provider; history-aware AI recommendations that cite record items and list missing information; accept/edit/reject/defer for every AI output with confirmation for flagged items; jobs with retry and duplicate-submission protection; live chunked transcription when speech-to-text is configured; activity trail per consultation |
| Routing assistance | Deterministic rules in `config/routing.yaml` (department, red flags with escalation instructions, urgent-for-review priority, missing intake, least-busy clinician); staff apply or override with a reason; rules version stored with every suggestion |
| Clinical photographs | Consent-gated JPEG/PNG/WebP upload (validated by the Python service; DICOM rejected), original kept unchanged, metadata-free preview, optional AI description marked unverified and reviewed by a doctor before it can be added to the note |
| AI oversight | Admin AI operations page (counts only), doctor review list of rejected/edited AI output, review-outcome snapshots stored as evaluation runs, checksummed prompt versions, model registry, settings snapshots |
| Thermal data workflow | Clinician labels on approved images (versioned taxonomy `thermal-labels-v1`, reference standard and certainty, several doctors per image, withdraw-only, enforced in the database), data origin recorded per image (`synthetic` by default, public sample files recognised by checksum), experimental rule-based flags on request (warm areas, paired-region asymmetry; labelled not validated), de-identified dataset export (ZIP: manifest + float32 matrices; approved images with research consent only), evaluation pipeline (rule agreement with Wilson intervals; logistic-regression baseline with subject-grouped cross-validation only when ≥ 20 cases per class from ≥ 10 subjects), admin Thermal data page |

## Accounts and security model

- **Demo accounts** (synthetic): `admin`, `dr.meera`, `dr.rahul`, `nurse.anil`. Their password is
  `SEED_DEMO_PASSWORD` in your local `.env` (generated by `npm run setup`).
- **Passwords** are hashed with Argon2id. New staff get a temporary password and must change it
  at first sign-in. Five failed attempts lock an account for 15 minutes.
- **Sessions** are server-side: the browser holds an `httpOnly`, `SameSite=Lax` cookie with a
  random token; the database stores only its SHA-256 hash. Sessions end after 60 minutes idle or
  12 hours absolute, on sign-out, on deactivation, on role change and on password reset.
- **Authorization is enforced by the API on every route** (default deny; see
  `apps/api/src/auth/permissions.ts`). The web app hides controls too, but that is convenience
  only. Denied requests are audited. Administrators manage the platform but cannot read clinical
  records.
- **CSRF:** state-changing requests must carry the `x-adaxai-csrf: 1` header, which a cross-site
  page cannot send.
- **Audit log:** sign-ins (including failures), user and department changes, permission denials
  and audit-log viewing are recorded. Database triggers make the log append-only, so even the
  application role cannot update or delete entries.

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

## AI assistant: what is and is not real

| Capability | Status |
| --- | --- |
| Transcript (typed, pasted), audio storage and playback, consent recording | Works without credentials |
| Rule-based safety checks (allergy vs prescription incl. an illustrative group list, vital-sign flags, missing information, red-flag phrases, record conflicts) | Works without credentials; deterministic, versioned (`safety-rules-v1`, `record-compare-v1`) |
| Routing suggestions | Works without credentials; deterministic (`config/routing.yaml`) |
| Note drafting, fact extraction, recommendations, image description | **Need `ANTHROPIC_API_KEY`.** Without it the UI says the feature is unavailable and never shows placeholder output |
| Transcription of uploaded or recorded audio, live chunked transcription | **Need `AI_STT_API_KEY`** (OpenAI-compatible endpoint). The configured interface returns finished text per chunk; there is no interim (streaming) text |
| Speaker identification | Only from "Doctor:" / "Patient:" labels in the text. Provider diarisation is not implemented |
| Clinical accuracy of any AI output | **Not evaluated.** Tested only against test doubles and a local mock of the provider API |

- **Drafts only.** Every AI output (note suggestion, fact, recommendation, image description) is
  stored as a draft. Nothing reaches the note until the doctor accepts or edits it and then adds
  it; flagged or unsupported items need an explicit confirmation; signing stays a separate,
  attested action. The assistant never diagnoses, prescribes, changes medicines, closes a
  consultation or contacts the patient.
- **Provenance.** Facts and recommendations link to the transcript lines or record items they
  rely on (`ai_evidence`), with who said or recorded it (patient, clinician, existing record,
  device or staff measurement, AI). Recommendations whose citations cannot be verified are marked
  unsupported. When the model reports insufficient data, the UI says so.
- **Versions and logs.** Every job records the provider, the model that answered, the prompt or
  rules version, token counts, latency, errors, the data origin and a hash of the non-secret AI
  settings. Prompt texts are checksummed: a changed prompt must get a new version id.
- **Consent.** `ai_recording` (wording `2026-10-v2`) covers recording, drafting and record-aware
  recommendations; patients who agreed to the earlier wording are asked again before
  recommendations use their record. Photographs need `clinical_photography`, and their AI
  description `ai_image_analysis`.
- **Privacy.** Registered names, MRN, phone numbers and emergency-contact details are replaced
  before text is sent; only age band and sex are sent, and only a metadata-free preview of a
  photograph. Other identifiers mentioned in conversation may still be present. Sending data to a
  provider requires the patient's consent and an appropriate data-processing agreement.
- **No automatic learning.** Doctor decisions are recorded and summarised (Admin > AI operations,
  Doctor > AI review); nothing is retrained from them. Any model change is a configuration and
  governance decision.
- **Architecture note.** Calls to hosted providers (Anthropic, OpenAI-compatible speech-to-text)
  are thin adapters in the Node API behind provider-neutral interfaces
  (`apps/api/src/ai/providers.ts`). The Python service does local processing (thermal, image
  validation, dataset evaluation). A self-hosted model would be added as a Python service behind
  the same interfaces.

## Thermal imaging: what is and is not real

- **Measurements only.** The viewer shows temperatures decoded from the camera’s radiometric data
  and region statistics. It does not diagnose, and nothing about it is clinically validated.
- **Correctness check.** For the sample files, temperatures from `flyr` match an independent
  implementation of the published FLIR raw-to-temperature formula to within 0.0001 °C. That shows
  the conversion is implemented consistently; it is **not** an absolute-accuracy measurement
  (that needs a blackbody reference and the clinic’s own camera).
- **Camera compatibility is unverified.** Tests use public sample images (FLIR AX8, a generic FLIR
  file, and a DJI Zenmuse XT-R file that is rejected because its little-endian FFF variant is not
  supported by `flyr`). Run `node scripts/fetch-thermal-samples.mjs` to fetch them (MIT licence,
  see `samples/thermal/SOURCE.txt`). Test with your camera’s own exported files before use.
- **Licence to review.** `flyr` is licensed EUPL-1.2 (copyleft). Have its use reviewed before any
  commercial distribution.
- Results depend on emissivity, distance, room temperature and acclimatisation; the upload form
  records these with every image.

### Labels, flags, datasets and evaluation

- **No trained model ships with ADAXAI, and nothing here is validated.** There is no labelled
  clinical data yet. The evaluation pipeline refuses to train its baseline model below 20 positive
  and 20 negative labelled images from 10 subjects, and says so in its report.
- **Experimental flags** (`rules-v1`) are fixed thresholds: connected areas at least 2 SD above the
  image mean (12+ pixels), and paired regions whose means differ by ≥ 1.0 °C. They are computed on
  request, never stored, and shown under a “Not validated” label. Doctors should label from their
  own assessment before opening them, to avoid anchoring.
- **Data origin.** Each upload records `DATA_ORIGIN` (default `synthetic`; set `clinical`
  only in a real clinical deployment). Uploads of the public sample files are recorded as
  `public_sample` regardless. Exports and evaluation reports state prominently when any data is
  non-clinical; the metrics then only show that the pipeline runs.
- **Exports** contain only approved images of patients with active consent to de-identified
  research use. Names, record numbers, dates of birth, contact details, dates, free-text notes and
  original image files are removed; patients and raters get export-local pseudonyms; age is a
  10-year band. Exports are audited, kept (never deleted) and available only to doctors and
  administrators (`thermal:export`), not through the general file route.
- **Evaluate offline:** `services/thermal/.venv/Scripts/python -m app.evaluate dataset.zip --md report.md`
  (run from `services/thermal`).

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
| `npm run demo:seed` | Add the synthetic demo patient for [docs/DEMO.md](docs/DEMO.md) (idempotent) |
| `npm run retention [-- --dry-run]` | Delete consultation audio of signed consultations older than `retention.consultationAudioDays` (records kept, audited) |
| `npm run db:generate` | Generate a new SQL migration from `apps/api/src/db/schema.ts` |
| `npm run db:provision` | Re-apply roles, databases and grants (idempotent) |
| `npm test` | API tests, thermal tests, then end-to-end tests |
| `npm run test:api` | Vitest against the real test database (`adaxai_test`, reset per test file) |
| `npm run test:thermal` | pytest |
| `npm run test:e2e` | Playwright (desktop + mobile Chromium) with axe WCAG 2.2 AA and phone-overflow checks |
| `node scripts/db.mjs reset test\|e2e` | Empty the test or e2e database (refuses the development database) |

The end-to-end suite starts its **own** API (port 4100), thermal service (8101) and web app (5273)
against a dedicated `adaxai_e2e` database that is migrated, reset and seeded before every run. It
can run while `npm run dev` is up and never changes development data.
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
- **Databases:** `adaxai` (development), `adaxai_test` (API tests) and `adaxai_e2e` (browser tests).
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

Non-secret settings are YAML, validated with strict schemas at start-up
(`apps/api/src/settings/schema.ts`; an unknown or invalid key stops the API with a message naming
it):

| File | Contents | When changes apply |
| --- | --- | --- |
| [`config/adaxai.yaml`](config/adaxai.yaml) | AI features on/off, models, effort, timeouts, live chunk length, context limits, upload types and limits, retention, safety-rule groups and tolerances | **API restart** |
| [`config/routing.yaml`](config/routing.yaml) | Routing rules, red-flag phrases and instructions, required intake | **At runtime** (re-read when the file changes; an invalid edit keeps the last valid rules and is shown in the routing dialog) |
| `.env` | Secrets (database passwords, `ANTHROPIC_API_KEY`, `AI_STT_API_KEY`), ports, `DATA_ORIGIN`, optional model overrides (`AI_NOTE_MODEL`, `AI_STT_*`) | **API restart** |

`DATA_ORIGIN` (default `synthetic`) is recorded on AI jobs, photographs and thermal images; set
`clinical` only in a real clinical deployment. Nothing in YAML is a patient record.

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
