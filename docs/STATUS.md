# ADAXAI status

**Last updated:** 3 Oct 2026.

ADAXAI is an MVP. It is not production-ready, not a medical device, and not clinically validated. All data is synthetic. Nothing here claims legal or regulatory compliance.

| Slice | Commit |
| --- | --- |
| 1. Mana AI patient-context Q&A; AI text in notes with provenance | `5cbefc1` |
| 2. Consent and access control | `be5ca8b` |
| 3. Record lifecycle and integrity | this commit (see below) |

## Slice 3: record lifecycle and integrity

**Basis:** a read-only map of the visit and consultation lifecycle, signing and amendments, the audit log, test-database safety and the doctor UI, made by five analysts reading code and tests. Decisions are recorded in:
- [ADR 0008](adr/0008-record-lifecycle-and-signed-record-verification.md): lifecycle, drafts, verification;
- [ADR 0009](adr/0009-audit-hash-chain-and-append-only-privileges.md): audit chain, privileges, database identity.

### Implemented

**Migrations** (all additive: no existing row is changed or removed):

| Migration | Contents |
| --- | --- |
| `0018_lifecycle_enum` | The `discarded` consultation status. On its own, because a new enum value cannot be used in the transaction that adds it. |
| `0019_record_lifecycle` | Status-history tables, with a baseline event for every existing visit and consultation. Visit and consultation guards. Discard columns and checks. One non-discarded consultation per visit (a partial unique index replaces the old unique constraint). Hash-scheme column. Amendment chain trigger. Audit chain columns, trigger and `audit.chain_start` event, with a digest of the earlier events. `meta.append_only_tables` and `meta.enforce_append_only`. |
| `0020_lifecycle_backstops` | No change of doctor or department while the patient is with the doctor (`AX005`). Stethoscope recordings added to the append-only list. |
| `0021_discard_reason_check` | A discard needs a non-blank reason, NULL included. It replaces the 0019 check, which let a NULL reason pass. |

**Applied to:** `adaxai_test`, `adaxai_e2e` and the development database (0018–0021). Before applying them to dev, read-only checks showed no data that would break the new checks: no signed rows without a fingerprint, no completed visits without a signature, no cancelled visits without a reason, and no discarded consultations at all. The dev audit chain verifies: 576 earlier events unchanged since the chain began.

**State machines** (API checks plus database triggers):
- **Visits:** the queue's manual moves only. The consultation makes the others (start or resume, sign, discard).
- **Rules:**
  - closed visits never change;
  - no cancel or no-show while a consultation is unsigned;
  - cancelling needs a reason;
  - no change of doctor or department while the patient is with the doctor, which covers editing and routing too.
- **Concurrency:** every change is compare-and-set, and the queue sends the status the user saw. Resume locks the visit row. Concurrent starts get one consultation.
- **Consultations:** `in_progress` → `signed` or `discarded`, both final. The database also refuses a consultation that is:
  - inserted already signed;
  - re-pointed to another patient or visit;
  - signed without naming a scheme;
  - deleted;
  - given AI text after it was signed;
  - amended before it was signed, or with a backdated amendment.
- **Status history:** every check-in and change records the acting user (required for the application role, `AX002`), the source, the reason and the time. Readable from the consultation page, and append-only.
- **Paused drafts:** data from before slice 3 can hold a draft on a visit that is back in the queue. Such a draft cannot be edited or signed until its author continues it; continuing returns the visit to the doctor.

**Unsigned drafts and discarding:**
- `GET /api/encounters/mine` and the **My consultations** page show the doctor's own unsigned drafts from any day, with visit, progress and last save. A second tab shows records signed in the last 30 days.
- The queue warns about drafts from earlier days, without naming patients.
- **Discard** needs the author, a reason and the current version. The draft is kept read-only, leaves the timeline and portal, and the visit returns to the queue.

**Signed-record verification** (`GET /api/encounters/:id/verification`, audited):
- **Fingerprints:**
  - v2 for new signatures: scheme, facility, visit and attestation included; strict serialisation;
  - v1 for earlier records.
- **Checks:**
  - the scheme, cross-checked against the signed content and the audit entry;
  - content against the fingerprint;
  - the record's rows against what was signed, including the signing time;
  - the audit log's copy of the fingerprint;
  - the amendment chain;
  - amendments against their audit entries, both ways.
- **Results:** `valid`, `invalid`, `unsupported_version` or `unverifiable`. Results are shown only after a check runs, always with the statement of what a match does not prove.
- **Amendments** are numbered, timestamped and hash-linked by the database.

**Audit log integrity:**
- The database chains every new event: SHA-256, commit order, transaction-scoped advisory lock, and READ COMMITTED only.
- `audit/chain.ts` verifies it independently of the trigger. The check is available on the admin **Audit log** page (with copy head and compare anchor) and as `npm run audit:verify`.
- The application role has no UPDATE, DELETE or TRUNCATE on any append-only table. The migrator and `db:provision` re-apply this after granting.

**Test database safety:**
- **Names:** `DB_NAME`, `DB_TEST_NAME` and `DB_E2E_NAME` must be distinct, and the test and e2e names must carry their suffixes.
- **Identity marker:** each database carries one (`meta.database_identity`), claimed by `db:migrate --target`. An unmarked database holding data is not claimed as disposable without `--claim-existing`.
- **Refusals** unless the database identifies as expected:
  - the test helpers' reset and raw SQL, which also require the test runner;
  - `db.mjs reset`;
  - `storage-orphans --delete`.
- **Playwright:** the configuration resolves names like the scripts do and stops before starting servers if they are ambiguous.
- **`db:migrate`** refuses unexpected options. The root script now passes its options through; before, `--target` was silently dropped and the development database was used.

**UI:**
- **My consultations** worklist, and the discard dialog with explanation and reason.
- Paused, closed-visit and discarded states in the consultation view.
- The editor stops retrying, and says why, when a save is refused for good. It opens from the server's current version, never from a cached copy.
- **Record verification** and **Status history** cards.
- Admin **Audit log integrity** card.
- Results are announced to screen readers.

### Not implemented, or needing a decision

- **Fingerprints are unkeyed.** Someone with the database superuser password (in the local `.env`) can rewrite content and recompute hashes. Only a head recorded outside the system reveals that, or the removal of the newest events. No HMAC key, external timestamping or anchoring service exists yet.
- **Not covered by the record fingerprint:** vitals, allergies, attached images and recordings.
- **The chain lock serialises audited writes.** It has not been measured under load.
- **Discarded drafts keep their consultation audio.** Retention still applies only to signed consultations; changing that is a product decision.
- **Only a draft's author can continue, sign or discard it.** Supervised reassignment (for example when a doctor leaves) is not built.
- **Past-day open visits.** Starting a consultation on an open visit from an earlier day is still allowed. There is no end-of-day closure.
- **Retention deletes remain hard deletes** by policy (invariant 17 now covers tests and scripts).
- **No cold backup before the dev migration.** None was taken before applying 0018–0021 to the development database, because `npm run backup` needs the running dev servers stopped and they were in use. The migrations only add and run in one transaction each. For a future destructive change, stop the app and run `npm run backup` first.

### Tests

**New API test files (49 tests):**
- `lifecycle.test.ts` (14):
  - the drafts worklist and its scope;
  - concurrent starts;
  - paused drafts and resume;
  - open consultations block cancel and no-show;
  - stale screens;
  - a database transition matrix against the contract;
  - no reassignment during a consultation;
  - other facilities' visit lookups refused and audited, also through routing;
  - status history and its protection;
  - discard;
  - a concurrent sign and discard;
  - consultation guards in the database.
- `integrity.test.ts` (24):
  - canonical serialisation;
  - verification: valid, tampered content, rows or hash, unsupported version, missing hash, legacy v1, scheme downgrade, visit, facility and signing-time changes, notes;
  - amendments: chain, database-assigned values, changed, removed, reordered and unlinked, removal of the newest, legacy;
  - AI provenance through signing and amendment;
  - concurrent checks during new amendments never report a false alarm;
  - audit chain: independent rebuild incl. unusual characters, concurrent writes and rollbacks, altered, deleted, reordered and unlinked events, anchors, the earlier-events digest (with more than ten events), unknown versions and the problem cap, isolation level;
  - the admin API and the command line;
  - app-role privileges.
- `db-safety.test.ts` (11):
  - name rules;
  - the identity marker;
  - refusals by the test helpers, `db.mjs reset`, `db:migrate` (including misspelt options), the e2e configuration and `storage-orphans`. All of these run against throwaway databases or a closed port.

**Updated:** `visits.test.ts`, because refused transitions are now audited as failures and the test asserts both.

**E2E:** `e2e/record-lifecycle.spec.ts` has three tests, on desktop and mobile, each with axe and phone-width checks:
- worklist and discard;
- signed-record verification and status history;
- the admin chain check with an anchor.

### Verified test results (slice 3, 3 Oct 2026)

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:api` | 25 files, **253 passed**, 0 failed (new: `lifecycle` 14, `integrity` 24, `db-safety` 11; updated: `visits`) |
| `npm run test:web` | **5 passed** |
| `npm run test:thermal` | **32 passed** |
| `npx playwright test` | **49 passed, 0 failed, 0 timed out, 1 skipped** |

**Notes on the end-to-end run:**
- The skip is the existing desktop-only keyboard test, skipped on mobile by design.
- `record-lifecycle.spec.ts` has 3 tests, each run on desktop and mobile.
- The longest test took 44.6 s: `doctor-workflow` on desktop, in the first wave of six parallel workers while the dev servers warmed up. The same test took 29.0 s on mobile later in the run, and 13.0 s and 11.1 s when run alone.
- All runs were within the 60 s budget. No timeout was changed.

### Failures found during this slice, and what was done

| Failure | Classification | Action |
| --- | --- | --- |
| Concurrent record checks during new amendments reported false "invalid" (found by review round 2) | **Product defect**: reads in separate snapshots | One read-only, repeatable-read snapshot per check. The concurrency test fails 6 of 6 times without the fix (first attempt at that experiment was invalid: a botched temporary edit crashed the route, which was noticed and redone). |
| Concurrent consultation starts: some requests got 409 instead of opening the new consultation | **Product defect**: a request read the visit before another committed the start, then took the resume path with a stale status | Resume decides on the locked, current visit row; repeated runs pass |
| `ai-clinical` e2e (desktop): axe `target-size` on an AI recommendation's *Defer* button | **Product defect** introduced by this slice: "Discard draft…" in the sticky footer sat under partly hidden targets | The destructive action moved from the always-visible footer to the visit card. The test passes repeatedly. The axe check is unchanged. |
| The dev audit chain reported "earlier events changed" right after migration | **Product defect** in the verifier: `order by id` bound to the text alias of `id`, so earlier events were digested in text order and re-read | Order by the column. A regression test with more than ten earlier events fails without the fix (39 vs 24) and passes with it. |
| First runs of the new tests: hard-coded sequence numbers, a non-deferrable unique index, `LOCK TABLE` outside a transaction, an actor-less insert | Test defects | Fixed in the tests; no assertion weakened |
| `visits.test.ts`: audit list grew | Intended change | Refused transitions are now audited; the test asserts the successes and the refusals separately |

### Pre-commit adversarial review (slice 3)

**Method:**
- Five rounds, until a round found nothing new. Each round used independent read-only reviewers under distinct lenses, then a skeptic who tried to refute every finding.
- **Round 1:** lifecycle and concurrency, integrity and the audit chain, security and privacy, test-database safety, UI, migration safety.
- **Round 2:** checked the round-1 fixes and hunted for regressions.
- **Round 3:** SQL semantics, cross-role flows, and claims in the docs against the code.
- **Round 4:** checked the round-3 fixes, plus a final sweep of every changed file.
- **Round 5:** checked the round-4 fixes, plus a last look.

**Results:**

| Round | Raised | Confirmed | Refuted | Fixed |
| --- | --- | --- | --- | --- |
| 1 | 22 | 18 (16 distinct) | 4 | all 16 |
| 2 | 10 | 7 | 3 | all 7 |
| 3 | 14 | 7 | 7 | all 7 |
| 4 | 5 | 2 | 3 | both |
| 5 | 0 | 0 | 0 | none needed |

**What was fixed:**
- Routing could reassign a visit's doctor or department during a consultation. It is now refused by the API and by a database trigger (migration 0020).
- **The record verifier trusted the editable scheme column.** Downgrading it, or writing an unknown version, hid tampering. The scheme is now cross-checked against the signed content and the audit entry, and an absent marker counts as version 1.
- **The verifier also missed:**
  - removal of the newest amendments;
  - amendments without a link on records signed after linking began;
  - a changed signing time;
  - a changed visit or facility on records whose column said version 1.
- **Verification read in separate snapshots,** so an amendment committed during a check produced a false "invalid". A test reproduced this 6 of 6 times without the fix and passes 5 of 5 with it. Checks now run in one read-only, repeatable-read snapshot.
- **The audit-chain verifier:**
  - skipped gap, link and hash checks for events with another chain version;
  - misreported the status beyond 20 problems.
- **`auscultation_recordings`** was missing from the append-only privilege list. A test now checks every trigger-protected table.
- **`npm run db:migrate -- --target test` silently migrated the development database,** because npm swallowed the option. The root script now passes options through, and the command refuses unexpected ones.
- **The e2e name-guard test** ran a TypeScript file with plain Node (Node 22.12–22.17 cannot do that); it now uses tsx.
- **Web:**
  - the editor could open from a stale cached copy, giving false conflicts;
  - one record's verification result showed on another record;
  - an AI insertion cleared the "cannot be saved" state;
  - the worklist was not refreshed after saves and signing;
  - the discard dialog closed silently when the draft left the list;
  - the anchor form put errors on the wrong field and could not take a pasted head;
  - results were not announced to screen readers.
- **Routing visit lookups** of other facilities were not audited.
- **Docs:** STATUS.md had not yet been updated, and the upgrade step for installations made before the guard was undocumented.
- **Round 3:**
  - The discard check let a NULL reason pass, because NULL in a CHECK counts as a pass. Migration 0021 fixes this.
  - A verification result stayed on screen after an amendment.
  - A queue action right after recording vitals sent the status from before the vitals, and was refused as "changed by someone else".
  - `audit:verify` silently ignored an `--anchor` that npm had swallowed and still reported VALID. Both command-line tools now refuse such options and name the variable.
  - The docs said every lifecycle refusal is audited; only refused manual status changes are.
  - A broken code fence in README and a split table in PRODUCT_SPEC.
- **Round 4:**
  - STATUS did not list migration 0021.
  - A request that lost a concurrent start received the record without an audited read.

**Refuted, with reasons recorded:**
- The cross-facility admin chain report: documented, and it carries counts and hashes only.
- Discard reasons in the visit history: intended, and tested.
- Cancel and no-show buttons on paused drafts: the server refuses them, with a reason.
- The worklist cap of 200: not reachable in practice.
- A newer version picked up by background refetches: the discard is still checked against the server's current version.
- The clipboard fallback: the app is served from localhost.
- A stale verification result after an amendment: the result is timestamped, and **Check again** is shown. Round 3 later confirmed a narrower form of this, which was fixed.
- **Round 3:**
  - "Closed visits never change" is a claim about status, and the docs say so.
  - Signing is not tied to the visit state in the database; no doc claims that, and the API checks it.
  - The verification statement's wording, which the per-check details qualify.
  - Anchors cover events up to the anchor, as documented.
  - The `--target=` form without `--`.
  - The placeholders in this file before the final run.
  - Printing database names.
- **Round 4:**
  - Refusing `npm_config_*` variables inherited from a developer's environment is fail-closed by design. The message now names the variable.
  - A resume racing a discard is serialised by the foreign-key lock on the visit.

### Browser verification

**Automated:** Playwright drove real Chromium on desktop and Pixel 7 for the new flows, with axe WCAG 2.2 AA and phone-width checks.

**Manual check:** a read-only script signed in to the **dev server** (synthetic dev data) as `dr.meera` and `admin`. It screenshotted, at 1440 and 390 px:
- the queue with the earlier-drafts warning;
- **My consultations**: three real drafts from 2 Oct;
- **Signed recently**;
- a signed v1 record after **Check now** (*Matches its fingerprint*) with its status history;
- the admin **Audit log integrity** check (*Chain intact*).

No page overflowed (scrollWidth equalled the viewport). Nothing was discarded, signed or edited. The demo password was read from `.env` inside the script and never printed.

## Slice 2: consent and access control

The basis was a read-only scope audit of every API route (154 route records; 68 gaps confirmed by adversarial verification). Decisions are recorded in [ADR 0006](adr/0006-consent-lifecycle-and-enforcement.md) (consent) and [ADR 0007](adr/0007-default-deny-routes-facility-scope-and-denial-audit.md) (access).

### Implemented

**Consent model** (migration `0017`, additive)
- **States:** granted (current wording), granted under an earlier wording (renew), withdrawn, not recorded. Computed in one place and shown in every app.
- **Withdrawal record:** reason (optional, kept on the record, not in the audit log), who, and the channel (staff or patient portal).
- **Renewal:** supersedes the earlier-wording grant atomically.
- **Database rules:**
  - rows are never deleted or rewritten, and end once (trigger);
  - one active ongoing grant per purpose (unique index);
  - deterministic lookup, current wording first.

**Enforcement at the API boundary**, refusals audited as `consent.blocked`:
- recording and AI assistance;
- Mana AI summaries, including retries;
- photographs and their AI description;
- thermal images;
- device assignment, recordings and ingestion;
- portal activation, reset, sign-in and every portal request;
- research dataset download and evaluation.

The rule-based safety check reads the transcript only while recording consent is in place.

**Withdrawal takes effect at once**, ending every grant of the purpose, including consultation-only ones:
- **portal access:** the account is switched off, sessions end, codes are revoked;
- **device consent:** assignments end;
- **research consent:** datasets that include the patient are blocked;
- **recording:** the browser recorder stops, sends nothing more and closes the live transcript.

Patients can withdraw their own consents in the portal. Granting stays with staff, who read the wording. The portal shows the wording the patient actually agreed to.

**Device readings** are filed to the patient the device was assigned to when they were measured, and only if consent was in place at that time. A renewal under newer wording counts as continuous consent. Readings outside an assignment or before consent are refused and audited.

**Portal accounts**
- Staff can issue a reset code (new password; switches the account back on; requires portal consent).
- Staff can switch an account off at once.
- Activation and reset re-check consent and record who issued the code.

**Default deny**
- Every `/api` route must declare `public`, a permission or `anySession`, or the API does not start.
- A route-inventory test checks the public set (5 routes) and the any-session set (3 routes).
- 401 is checked for every private route.
- A 403 is checked for every role and route the role lacks permission for (over 150 pairs, each audited).

**Facility scope**
- Admin user list, edit and password reset; staff directory; overview counts; audit search.
- Audit rows carry their facility.
- A patient or consultation of another facility is "not found", and the attempt is audited with the reason.

**Minimum necessary**
- Admins see that a device is in use, not by whom.
- Nurses see only reviewed AI photo descriptions.
- Only the signing doctor amends a signed consultation (conservative default).
- AI audit details carry counts only, never model text.

**Every refusal leaves a trace**, without double entries:
- in-route 403s;
- cross-facility 404s;
- portal record probes;
- device rejections;
- the patients disclosed by bulk reads;
- CSRF refusals, throttled per address.

**Sign-in**
- Attempt slots are reserved before the password check, so there is no lockout race.
- The same lockout rules apply to every username, so no account discovery.
- Unknown usernames are never stored.
- Wrong current passwords at a password change count towards the lockout.
- Rate limits per address, account, user and device token (429 with `Retry-After`).

**Logs:** request logs record paths only, never search terms.

**De-identified thermal export:** staff-typed region names become neutral codes (case-insensitive, pairs preserved); the free-text body region is left out.

**UI**
- **Consents card:**
  - the state of each purpose;
  - renewal;
  - withdrawal dialog with the effect and an optional reason;
  - consultation-only grants;
  - full history.
- **Patient portal card:** activation, reset code, switch off.
- **Portal consents page:** withdrawal in the patient's own words and effect; earlier-wording label.
- **Sign-in notice** after a patient withdraws portal access.
- **Admin device registry:** without patient identity.

### Not implemented, or needing a decision

- **"Care records" (`data_processing`) consent** is recorded and shown but not enforced. The withdrawal texts say so. What it means for care is a legal decision.
- **Unauthenticated 401s** are not audited. This avoids noise from expired sessions; every other refusal is audited.
- **Rate limits** are per process and in memory; a restart clears them.
- **Amendment rights** (only the signing doctor) are a conservative default for the clinical owner to confirm.
- **Unchanged areas:**
  - the visit/encounter lifecycle;
  - signed-content verification;
  - the audit hash chain and app-role grants;
  - the test-DB name guard.

  These were done in slice 3 (above).

### Tests

**Updated** where the behaviour intentionally changed:
- search audit now lists the patients returned;
- an activation code for an existing account is now a reset code;
- portal probes are audited;
- `outside_assignment` replaces `device_unassigned`, and withdrawing device consent ends assignments;
- ROI codes in the export;
- consent message wording.

**New in `consents.test.ts` (13):**
- lifecycle;
- database guards;
- enforcement: absent, granted, withdrawn;
- consultation-only grants;
- device timing and renewal chain;
- buffered-reading attribution;
- portal withdrawal and reset;
- portal consent defence in depth;
- patient self-withdrawal;
- earlier wording;
- switching an account off;
- withdrawal texts.

**New in `access.test.ts` (14):**
- route inventory;
- start-up refusal of an undeclared route;
- 401 sweep;
- role matrix;
- in-route refusals;
- facility isolation;
- lockout under concurrency (incl. the one-correct-guess burst);
- parity for inactive and unknown usernames;
- password-change lockout;
- rate limits;
- CSRF audit volume;
- log redaction.

**Added to existing suites:**
- `devices.test.ts`: admin view and list audit;
- `images.test.ts`: nurse view;
- `thermal-data.test.ts`: research withdrawal;
- `mana.test.ts`: withdrawn consent and retry audit.

**E2E:** `e2e/consent.spec.ts` covers portal withdrawal, staff withdrawal, reset code and portal self-withdrawal, on desktop and mobile.

### Verified test results (slice 2, 3 Oct 2026)

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:api` | 22 files, **204 passed**, 0 failed |
| `npm run test:web` | **5 passed** |
| `npm run test:thermal` | **32 passed** |
| `npx playwright test` | **43 passed, 0 failed, 0 timed out, 1 skipped**. The skip is the existing desktop-only keyboard test on mobile. The longest test took 30.9 s, within the 60 s budget. |

**Browser check** (dev server, synthetic data): a read-only script signed in as `nurse.anil` and screenshotted the consents card with its history, the patient portal card and the withdraw dialog (opened and cancelled; no data changed). At 390 px there is no horizontal overflow (scrollWidth 390). Migration 0017 was applied to the dev database; it is additive, and there were no duplicate active grants beforehand.

### Pre-commit adversarial review (slice 2)

**Method:**
- Five lenses: authorization bypass, consent logic, integrity and audit, regressions, UI.
- A skeptic then tried to refute each finding.
- 26 findings were raised: 22 confirmed, 4 refuted.

**What was fixed:**
- a sign-in lockout race that singled out the correct password;
- enumeration through inactive accounts and through the reset window of unknown usernames;
- missing facility on audit rows from public routes;
- withdrawal texts that over-promised (incl. "Care records") or used staff wording for patients;
- buffered device readings refused after a consent renewal;
- consultation-only grants hiding withdrawals, and no way to withdraw them;
- a renewal racing a withdrawal;
- Mana's legacy consent path;
- portal code issuance rejecting an earlier wording;
- double audit rows;
- the CSRF audit flood;
- a failed Mana retry audited as a success;
- case-sensitive ROI codes breaking pairs;
- the live recorder after a consent refusal (it uploaded leftover audio, left the transcript "live", and kept showing stale consent);
- "Add amendment" shown to doctors who may not amend;
- the device gateway contract not documented.

## Slice 1: Mana AI patient-context Q&A, and AI text in notes with provenance

### Implemented

#### Mana record retrieval (`apps/api/src/mana/record.ts`)

Access:
- Doctors only (`ai:use`).
- The patient must be in the caller's facility; another facility's patient is indistinguishable from a missing one (404).
- A consultation id passed as context must belong to the same patient.

What it reads, for one patient only, from bounded windows (`config/adaxai.yaml` → `mana`):
- allergies, and the recorded allergy status;
- signed consultations: every note field, diagnoses, prescriptions and amendments;
- today's draft, labelled as a draft;
- reasons for visit;
- vital signs, with their source and validation status;
- approved thermal measurements.

What each item carries:
- a reference, record type, consultation id, date, field, status and provenance;
- an excerpt with identifiers replaced.

#### Mana record answers (`apps/api/src/mana/answers.ts`, rules `mana-record-v1`)

No AI key is needed. Intents:
- briefing;
- history summary;
- last prescription;
- vital signs compared with the previous reading;
- changes since the previous visit;
- allergies;
- diagnoses;
- free-text record search.

Every statement cites record items. The rules also state:
- what is absent;
- conflicts: allergy vs. prescribed medicine in a configured illustrative group; "no known allergies" vs. active allergies; disagreeing readings at one visit;
- possibly outdated records;
- amended consultations.

#### Mana AI summary (`mana-qa-v1`)

Runs only when both hold:
- `ANTHROPIC_API_KEY` is set;
- the patient has a current consent of the new type `ai_record_assistant`.

What is sent:
- Only items relevant to the question, within the character budget.
- The references sent are stored on the job.
- Name, MRN and phone are replaced before sending.

What is checked and recorded:
- The server verifies citations; uncited statements are kept and marked "Not supported by the record".
- Job, run, provider, model, prompt version and tokens are recorded.

Failure handling:
- A failure is recorded as such, and retry is possible.
- Without a key the answer says "AI summary unavailable" and why.
- Without consent it says "consent needed", and nothing is sent.

#### Persistence and audit

- **Storage:** `mana_questions` (migration `0015`). A trigger allows only the AI part to be completed, and only while it is pending or failed.
- **Review and insertion:** reviews and insertions are appended to `ai_review_actions` and `note_insertions`.
- **Idempotency:** requests carry idempotency keys.
- **Audit events:** `mana.ask`, `mana.read`, `mana.review`, `ai.job_create`, `ai.patient_qa`, `encounter.ai_insert`.

#### AI text in notes (invariant 1, [ADR 0002](adr/0002-ai-text-into-notes-via-recorded-insertions.md))

How text gets in:
- `POST /api/encounters/:id/insertions` is now the only UI path for AI or rule output into a note.
- Only the authoring doctor can use it, before signing, at the current version.
- Reviewed output only. A Mana answer is inserted directly; the insertion itself is the explicit action.
- The same text from the same source goes into a section once.

What is recorded:
- The note keeps the source reference: provider, model, prompt or rules version.
- The signed snapshot lists every insertion, with `retained` (whether the text is still unchanged).

Where it shows:
- under the note section;
- in the sign dialog;
- on the signed record.

The earlier browser-only "Add to …" path is gone.

#### UI

- **Placement:** a Mana panel on the doctor's patient record and in the consultation workspace.
- **Asking:** suggested questions and free text.
- **Answers:**
  - statements grouped by section, with kind badges;
  - expandable sources: field, date, status, provenance, and a link to the consultation;
  - the AI summary labelled separately.
- **Actions:** Mark reviewed; Insert into note; retry.
- **Consultation workspace:** three panels at 1536px and wider (visit and timeline | note | Mana and the assistant), two panels at 1280px, stacked on phones.

#### Documentation

- [AUDIT.md](AUDIT.md) (Phase 0);
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) (Phase 1);
- [ADRs 0001–0005](adr/);
- README and [DEMO.md](DEMO.md) updated.

### Not implemented or not validated in this slice

- **AI summary:** no real provider has been called. It is tested only with a test double and the local test-only mock of the Anthropic API. Answer quality with a real model is unknown.
- **Record rules:** cover the listed intents only. Other questions fall back to a word search with no paraphrase. The question classifier is pattern-based.
- **Thresholds:** the "possibly outdated" threshold (180 days) and the allergy groups are display aids, not clinical guidance.
- **Languages:** English UI. No Tamil, Hindi or code-mixed evaluation.
- **Workspace layout:** the three-panel layout is not tested at every width. It was checked by screenshot at 1920, 1366 and 390px.

### Verified test results (2 Oct 2026)

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:api` | 20 files, **175 passed**, 0 failed (`mana.test.ts`: 19 new tests; `config.test.ts`: 1 new isolation guard) |
| `npm run test:web` | **5 passed** |
| `npm run test:thermal` | **32 passed** |
| `npx playwright test` | **41 passed, 0 failed, 0 timed out, 1 skipped**. The skip is the existing desktop-only keyboard test, skipped on mobile by design. `e2e/mana.spec.ts` has 2 tests × desktop and mobile. The longest test took 32.4 s. |

New tests, `apps/api/test/mana.test.ts`:
- classifies questions into intents;
- answers the last prescription with source, date, field and status, flags outdated and conflicting records, and never invents an AI answer;
- compares today's vitals with the previous reading and flags disagreeing readings at the same visit;
- states what is absent: no signed consultation, nothing to compare, no matching record item;
- summarizes history and changes since the previous visit from this patient's record only;
- flags an amended consultation as possibly corrected and marks its items as amended;
- is for doctors only, within their facility; answers are immutable and reviews are recorded;
- AI summary: needs the patient's consent, sends only this patient's pseudonymised items, verifies citations and records provenance;
- a failed summary keeps the record answer, is marked retryable and can be retried;
- asking without an AI summary sends nothing to the provider;
- inserting AI output into the note: only by explicit insertion of reviewed output, keeping a reference to the AI artifact through signing. Includes: the same text goes in once, stale versions are refused, other doctors are refused, other patients' artifacts are refused, text must match the reviewed text, section length limits hold, references are in the signed snapshot, the trail is append-only.
- does not report medicines as stopped when the latest signed consultation simply has no prescription;
- searches whole words and keeps the documented "no known allergies" status;
- finds the previous reading even after a burst of newer readings;
- a long record keeps the allergy record and the cited items in the AI context budget;
- keeps AI-reported conflicts even when the model returns many statements;
- a retry re-checks consent: after withdrawal nothing is sent, through either retry route;
- non-retryable failures cannot be retried; a summary left in progress by a stopped server can be;
- sends dates as the facility's local day.

New tests, `e2e/mana.spec.ts` (desktop and mobile):
- Mana answers from the record with sources, labels the AI summary, and inserted text keeps its provenance through signing;
- without the patient's consent Mana still answers from the record but sends nothing for an AI summary.

### Failures found during this slice, and what was done

| Failure | Classification | Action |
| --- | --- | --- |
| At audit time, 3 e2e tests timed out (30 s), and later 2 others: the long multi-role workflows | Environment / resource. The tests failed at their final steps. In passing runs `doctor-workflow` takes 26.6–27.7 s, and the longest test in the final run took 32.4 s, so the 30 s default was too short. | Per-test budget set to 60 s in `playwright.config.ts`, with the measurements in a comment. Per-assertion timeouts are unchanged (5 s). Re-run: 41 passed. |
| Mana mobile: page 2 px wider than a 412 px phone | **Product defect**, clock-dependent: the non-wrapping "Reviewed by … · date, 11:28 pm" badge overflowed when the time had two hour digits | `Badge` got a `wrap` option, used for long labels; the overflow check now names the offending elements. 16 of 16 repeated runs pass. |
| Mana e2e: chip clicked before AI status loaded, so the request went out with no AI summary | **Product defect**: a UI race | The client always sends the doctor's choice; the server decides and states why a summary is unavailable. |
| "Any mention of fever?" classified as a vital-sign comparison | **Product defect**: rule order | Search phrasing is matched first; unit test added. |
| Duplicate "Sources: M1" lines in the prescription answer | UX defect (browser check) | The prescription date and doctor moved into the section title. |

### Pre-commit adversarial review

**Method:**
- Four independent reviewers covered security, correctness, data integrity and UI.
- A skeptic then tried to refute each finding.
- 23 findings were raised and 22 confirmed. The refuted one described documented ADR 0002 behaviour.

**What was fixed**, each one with a regression test where testable:

**Security**
- A Mana AI retry, through either retry route, did not check consent again, so after withdrawal the record could still be sent. Every run now re-checks consent; a blocked attempt is audited as `mana.ai_blocked`.
- A non-retryable failure could be retried.
- The insertion endpoint accepted any text under an AI artifact's provenance. Now only the reviewed text can be inserted (`text_mismatch`). Mana answers stay editable by design, and are labelled "text chosen and edited by the doctor".

**Integrity**
- An insertion could push a note section past its length limit, which made every later autosave fail. It now returns 400.
- An answer could stay "AI summary in progress" forever. It is now always resolved, and a stale pending answer can be retried.

**Correctness**
- Absence statements ignored the 10-consultation window. They now say what was read.
- A burst of readings could hide the previous one (the old 200-reading cap). Readings are now bounded per kind and visit.
- "What changed" reported medicines as stopped when the latest signed consultation had no prescription.
- Search matched inside words, and hid "no known allergies".
- The AI context budget dropped old allergy records.
- AI conflicts could be cut off by the statement cap.
- Dates sent to the AI were UTC days, not facility days.

**UI**
- Overlapping insertions and autosave could race. They now run on the same serial chain.
- The save indicator could claim "Saved" while edits made during an insertion were unsaved.
- An accepted note suggestion whose automatic insertion failed could not be inserted later. It now has a fallback "Add to …".
- The live region read whole answers aloud. Only a short notice is announced now.
- At 1280px a gap opened above Mana.
- The assistant's two-column block was squeezed into the side panel (now a container query).

**Test isolation**

At 23:47, during this work, real `ANTHROPIC_API_KEY` and `AI_STT_API_KEY` values were added to `.env`. The values were not displayed. The API test helper builds its config from `.env`, so the "no keys" test app picked up a real provider.

| Item | Detail |
| --- | --- |
| Fix | The test configuration now never carries provider keys. Guard test: `config.test.ts` › "the test configuration never carries provider keys, whatever .env contains". |
| E2E | Was already isolated: the API server gets a placeholder key pointed at the local mock, and an empty speech-to-text key. Verified that Node keeps preset variables over `.env`. |
| Checked | The test database shows no external-provider runs. |
| Dev database | It shows two speech-to-text attempts from the dev app at 23:48, both failed with `rate_limited`. They were not made by tests. |

### Browser verification

- **Automated:** Playwright drove real Chromium for the full Mana workflow, on desktop and Pixel 7, with axe WCAG 2.2 AA and phone-width checks.
- **Manual check:** a local script signed in to the **dev server** (synthetic dev data) as `dr.meera` and screenshotted:
  - the patient-record briefing, with no AI key, showing the unavailable reason;
  - the consultation at 1920px (three panels, with the allergy vs. Amoxicillin conflict);
  - the consultation at 1366px (two panels);
  - the consultation at 390px: no horizontal overflow, scrollWidth 390.

The demo password was read from `.env` inside the script and never printed.

## Next planned work

1. **Slice 4: appointments:**
   - booking by staff and patient;
   - status history (the slice 3 history tables are the pattern);
   - check-in linked to the visit;
   - doctor dashboards with today's appointments and the drafts worklist;
   - notifications with delivery status.
2. Devices and alerts.
3. Consultation capture.
4. Admin and operations: audit export, config viewers, failed-job list.
5. Evaluation harness.
6. The full 14-step demo.

## External needs (not blocking the MVP build)

- **A provider key and a data-processing agreement**, needed before any real AI summary can be evaluated. Use synthetic data only.
- **A qualified clinical owner**, needed for:
  - alert thresholds;
  - allergy groups;
  - the "outdated" threshold;
  - consent wording.
- **Legal / privacy review** of:
  - consent purposes;
  - what "Care records" (`data_processing`) consent means for care;
  - cross-border AI processing.

  Nothing here claims compliance.
- **The clinical owner's confirmation** of amendment rights (currently only the signing doctor).
- **Product decisions from slice 3:**
  - who may take over or close another doctor's unsigned draft (today only its author can);
  - whether retention should delete the audio of discarded drafts;
  - where facilities record the audit-chain head outside the system, and how often.
- **Labelled, de-identified data**, needed before any model evaluation or training.
