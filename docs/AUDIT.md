# ADAXAI-MVP audit (Phase 0)

- **Date:** 2 Oct 2026
- **Audited state:** `main` at `5199423`, working tree clean.
- **Out of scope:** the separate `doctor-app` repository. It was checked and left untouched: HEAD `929141e`, clean.
- **Method:** seven independent, read-only domain auditors read code and test assertions, not the README or comments. A further critic agent spot-checked every "verified" claim, which led to five downgrades. Earlier reports were not trusted.
- **What "verified" means here:** the behaviour is implemented end to end, *and* a test whose assertions were read exercises it. "Partial" means some layers or the test are missing. "Missing" means nothing implements it. "Claimed-only" means documentation claims it but the code does not implement it.

ADAXAI is an MVP. It is not production-ready, not a medical device, and not clinically validated.

## 1. Checks executed at audit time

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | exit 0 |
| Lint (oxlint + ruff) | `npm run lint` | exit 0 |
| API tests (real PostgreSQL) | `npm run test:api` | 19 files, **155 passed**, 0 failed |
| Service-worker policy tests | `npm run test:web` | **5 passed** |
| Thermal service tests | `npm run test:thermal` | **32 passed** |
| End-to-end (Playwright, desktop + mobile) | `npx playwright test` | **34 passed, 3 failed, 1 skipped** |

The three e2e failures were 30-second test timeouts in the three longest doctor workflows (`ai-clinical`, `ai-assistant`, `doctor-workflow`, desktop). They ran while seven audit agents and the dev servers were using the CPU. The previous gate, at commit `5199423`, recorded these tests as passing. The re-run after the Mana slice is recorded in [STATUS.md](STATUS.md).

Services found running: PostgreSQL on 5433, API on 4000, web on 5173, thermal on 8001.

## 2. Summary by domain

| Domain | Verified | Partial | Missing |
| --- | --- | --- | --- |
| Mana AI (doctor companion) | unavailable-state; consent-gated recording; extraction with evidence; note-section drafting; signing separate | patient context (encounter-bound); citations (no outdated detection); retrieval layer (not reusable); chunk idempotency, language metadata; review actions | **patient-context Q&A**, Q&A answer contract, transcript correction, visit summary / Rx draft / patient instructions, **persisted reference for AI text inserted into notes** |
| Doctor and nurse apps | queue, registration + duplicate warning + MRN, check-in, signed immutability + amendments, routing apply/override, portal activation | dashboards (queue only), patient list (no filters), profile (no problem / medication list), consultation workspace (not three-panel), intake (advisory), vitals source display, consent capture (version/withdrawal bugs) | appointments, drafts-awaiting-review worklist, record version history, nurse alert escalation |
| Appointments and patient PWA | activation and session identity, signed-only records, visit history, prescriptions, vitals, consent view, no SW caching of `/api`, cross-patient denial | released reports (thermal only), follow-ups (free text), sign-out clearing (untested), dashboards freshness | **appointments entirely**, status history, patient booking, notifications, self-service consent changes |
| Admin and audit | review metrics, per-route permission matrix, append-only audit (triggers) | staff management (**not facility-scoped**), device oversight, AI job status, audit search (no patient / actor filter in UI), ops health, audit coverage of denials | facility config, routing config viewer, alert config, **audit export** |
| Devices and alerts | registry, assignment with consent, token ingestion, stethoscope upload / playback | timestamps (receipt time not shown), units / validation display, **assignment-window check** | ingestion idempotency and batches, waveform, labelled simulator, **threshold alerts, alert lifecycle, inboxes** |
| AI / ML, thermal, UX | provider interfaces (draft, extract, recommend, image, STT, thermal), fake providers only in tests, thermal pipeline intact (32 tests), honest "no training" status, axe WCAG 2.2 AA checks, mobile overflow checks | thermal eval (no model registry / cards, weak leakage test), design system (colour tokens only, no motion / spacing scale) | Q&A provider interface, text / speech training and evaluation pipeline, extraction metrics, WER, 9 of 14 demo steps not fully possible |

## 3. Security invariants (directive 1–17)

| # | Invariant | Status at audit | Note |
| --- | --- | --- | --- |
| 1 | AI text enters a note only by explicit doctor action **and keeps its artifact reference** | Partial | The explicit-action half was verified. The reference was missing: "Add to note" appended text in the browser only. |
| 2 | Signed records immutable | Verified | DB triggers + API. The hash is unkeyed and never re-verified. |
| 3 | Provenance | Partial | Note text had no AI-vs-typed provenance. Observations have no `data_origin`. |
| 4 | Session-based patient identity | Verified | |
| 5 | Default-deny | Partial | Authentication fails closed, but authorization is opt-in per route. No route-inventory test. |
| 6 | Consent gates | Partial | Withdrawing `portal_access` does not end portal access. `activeConsent` has no ORDER BY, so the version picked is ambiguous. |
| 7 | No fabricated data | Partial | `demo-seed` has no environment guard. Synthetic vitals look like manual entries. |
| 8 | Audit | Partial | Not audited: 401s, CSRF denials, in-handler 403s, cross-facility 404s, and the device list. |
| 9 | Unavailable, not fake | Verified | |
| 10 | No patient data in info logs | Partial | Patient-search query strings (name, phone, MRN) appear in Fastify request logs. |
| 11 | Cross-patient denial | Verified for the portal. Staff access is facility-wide, without care-team scoping (product decision). | |
| 12 | No SW caching of patient data | Verified | |
| 13 | Device source / validation shown | Partial | The consultation view has no device or unverified marker. |
| 14 | Alerts auditable | Missing | No alert subsystem. |
| 15 | Upload type / signature / size | Partial | Images and thermal files are checked. Audio is checked by MIME type only. |
| 16 | Secrets never exposed | Partial | No log-redaction or bundle scan test. `ANTHROPIC_BASE_URL` is honoured implicitly by the SDK. |
| 17 | Destructive DB ops guarded | Partial | Test reset has no guard against a test DB name equal to the dev DB name. Retention and orphan deletion are hard deletes. |

Other P0 security findings:
- **Admin routes ignore facility boundaries.** User list, user edit and password reset are affected, so an admin could reset another facility's admin.
- **No rate limiting** on sign-in, activation or device ingest.
- **Patients cannot recover a portal account**, and staff cannot deactivate one.
- **The app role keeps UPDATE/DELETE grants on `audit_events`**; only triggers protect it.

## 4. Corrections to earlier claims

The critic downgraded five "verified" items to "partial". All five are reflected in the tables above:
- admin staff management (facility scope);
- audit of reads and denials;
- no fabricated data (demo seed and data origin);
- consent capture (version and withdrawal handling);
- demo step 9, insertion into the note (browser only).

In the README, "model registry" refers to the `ai_models` usage log. It is not a registry of trained models.

## 5. Decisions

**Keep:**
- authentication, sessions and CSRF;
- signed-record triggers and amendments;
- the AI job/run/evidence data layer;
- consent gating of AI recording and photographs;
- routing rules;
- portal isolation and the service-worker policy;
- the thermal pipeline;
- the backup / verify / restore scripts;
- the test isolation.

**Fix** (existing, incomplete):
- AI insertion provenance;
- consent version and withdrawal handling;
- admin facility scoping;
- default-deny route guard;
- audit coverage and export;
- log redaction;
- audio signature checks;
- device ingestion window and idempotency;
- vitals source display;
- the consultation layout.

**Build** (missing):
- Mana patient-context Q&A;
- appointments with status history and patient booking;
- threshold alerts and inboxes;
- labelled device simulator;
- transcript correction;
- dashboards with worklists;
- notifications;
- the text / speech evaluation harness;
- the full demo path.

**Rebuild:** none. No existing module needs replacing; the gaps are additive.

## 6. Order of work

Following the directive's priorities and the critic's ranking:

1. **Mana AI patient-context Q&A with cited sources, plus server-recorded AI insertion into notes.** This is P0, and the critic ranked it first. Built in this session; see [STATUS.md](STATUS.md).
2. **Consent and access-control enforcement.** P0:
   - portal withdrawal ends access;
   - deterministic consent versions and renewal;
   - route-inventory default-deny guard;
   - admin facility scoping;
   - rate limiting;
   - log redaction.
3. **Record lifecycle and integrity.** P0:
   - unsigned-draft worklist;
   - visit/encounter transition guards;
   - signed-content verification;
   - audit hash chain and grants;
   - test-DB name guard.
4. **Appointments.** P0/P1:
   - booking by staff and patient;
   - status history;
   - check-in linked to the visit;
   - dashboards;
   - notifications with delivery status.
5. **Devices and alerts.** P1:
   - labelled simulator;
   - idempotent batches;
   - device vs receipt time;
   - assignment-window quarantine;
   - synthetic demo threshold rules;
   - alert lifecycle and inboxes.
6. **Consultation capture.** P1:
   - transcript correction with history;
   - language metadata;
   - chunk idempotency.
7. **Admin and operations.** P1:
   - audit export;
   - routing / alert config viewers;
   - failed-job list.
8. **Evaluation harness.** P2:
   - extraction metrics and WER on synthetic labelled sets, clearly marked as such;
   - model cards;
   - "training blocked: no labelled data".
9. **Full 14-step demo and documentation.**
