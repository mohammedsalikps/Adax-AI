# ADAXAI Connected Clinical Platform: product specification

This is the specification for an MVP. Everything shown or seeded is synthetic. ADAXAI is not a medical device, is not production-ready, and none of its AI output, rules or measurements are clinically validated. This document makes no claim of legal compliance, clinical safety certification or regulatory approval.

## 1. What ADAXAI is

ADAXAI is a connected outpatient platform. It links four applications through one PostgreSQL record:
- the patient app (installable PWA);
- the nurse app;
- the doctor app;
- the admin console.

The doctor works with **Mana AI**, a companion for the patient's record and the consultation. Mana's design rules:

1. **Record first.** Every Mana answer starts from what the patient's record documents. Explicit, versioned rules read it (`mana-record-v1`), and each statement cites the exact record item it comes from: record type, consultation, date, field and status.
2. **Generated text is labelled and checked.** When an AI provider is configured *and* the patient has consented, Mana adds an AI-generated summary. It is always shown apart from the record answer, and labelled with provider, model and prompt version (`mana-qa-v1`). Its citations are verified on the server; anything it cannot tie to a record item is flagged "Not supported by the record".
3. **Absence, conflict and age are stated.** Missing information is stated, never guessed. Conflicting records are flagged; so are records that are possibly outdated or amended.
4. **Nothing reaches the note without the doctor.** AI text enters a note only by an explicit doctor action. The server records that action with a reference to the AI artifact, and the signed record keeps the reference. For reviewed suggestions only the reviewed text can be inserted. Mana text the doctor edits is labelled as such.
5. **Unavailable, never fake.** Without a provider, Mana says so and still answers from the record.

## 2. Users and applications

| User | Application | Core jobs |
| --- | --- | --- |
| Patient | PWA (`/patient`) | Activate and sign in; book and follow appointments; read signed records, prescriptions, vitals, released reports and follow-ups; manage consents; read notifications. |
| Nurse | `/nurse` | Appointments and queue; registration with duplicate warning and MRN; consent capture; check-in and intake; vitals with units and source; routing suggestion apply/override; device assignment; portal activation; alert escalation. |
| Doctor | `/doctor` | Dashboard (today's appointments, waiting, active, completed, drafts awaiting review, alerts, follow-ups due); patient list and profile; **Mana AI**; three-panel consultation workspace; notes and prescriptions with immutable signed versions and amendments; **My consultations** (unsigned drafts from any day, records signed in the last 30 days); discarding a draft with a reason; record verification and status history. |
| Admin | `/admin` | Staff and roles; facility and departments; routing and alert configuration viewers with versions; device registry; AI job and provider status; review metrics; audit search, filter and export; operational health. |

## 3. Domain entities (PostgreSQL)

Implemented tables are listed in `apps/api/src/db/schema.ts`. Planned items are marked *(planned)*.

| Area | Entities |
| --- | --- |
| Identity | facilities, departments, users (roles: admin, doctor, nurse, patient), sessions, audit_events (append-only, SHA-256 hash chain since migration 0019) |
| Patient | patients (MRN sequence), allergies, consents (typed, versioned, withdrawable), patient_activation_codes |
| Flow | visits (daily tokens), **visit_status_events**, observations (vitals; `source`, `validation_status`, device), *(planned)* appointments, appointment_status_events, notifications |
| Record | encounters (signed snapshot + versioned content hash, or discarded with who/when/why), **encounter_status_events**, diagnoses, prescription_items, encounter_amendments (numbered, hash-linked), **note_insertions** |
| AI | ai_jobs, ai_runs, ai_prompt_versions, ai_settings_snapshots, ai_models, transcripts, transcript_segments, clinical_facts, ai_recommendations, ai_evidence, ai_review_actions, **mana_questions**, *(planned)* transcript_corrections |
| Imaging and devices | clinical_images, image_analyses, thermal_* tables, devices, device_assignments, auscultation_recordings, *(planned)* device_batches, alert_rules, alerts, alert_events |
| ML | evaluation_runs, dataset_memberships, *(planned)* model cards and evaluation datasets for text and speech |

## 4. State machines

**Appointment** *(planned)*: `booked → checked_in → (visit flow) → completed`.
- From `booked` the appointment may also become `cancelled`, `rescheduled` (a new appointment linked to the old one) or `no_show`.
- Every transition is appended to `appointment_status_events` with actor, time and reason.

**Visit** (implemented, [ADR 0008](adr/0008-record-lifecycle-and-signed-record-verification.md)): `waiting → in_triage → ready → in_consultation → completed`.
- **Manual moves** (queue, `VISIT_TRANSITIONS`):
  - `waiting` → `in_triage`, `ready`, `cancelled` or `no_show`;
  - `in_triage` → `ready`, `waiting` or `cancelled`;
  - `ready` → `in_triage`, `cancelled` or `no_show`.
- **The consultation's moves:**
  - starting it (or its author continuing a paused draft) moves an open visit to `in_consultation`;
  - signing moves `in_consultation` to `completed`;
  - discarding the draft moves `in_consultation` back to `ready`.
- **Rules:**
  - closed visits (`completed`, `cancelled`, `no_show`) never change;
  - while the patient is with the doctor, the visit's doctor and department do not change (editing, routing, database);
  - a visit with an unsigned consultation cannot be cancelled or marked as a no-show;
  - cancelling needs a reason.
- **Enforcement:** the API checks first and the database enforces the same rules (trigger). Every change is compare-and-set.
- **History:** every check-in and change is appended to `visit_status_events`, with the acting user, the source, the reason and the time.

**Encounter (consultation):** `in_progress → signed` or `in_progress → discarded`.
- At most one consultation per visit is not discarded.
- **Signing** is a separate doctor action with an attestation. It needs the visit to be with the doctor.
- **Discarding** is done by the author, with a reason. The draft is kept read-only and leaves the patient's record.
- **Immutability:** signed and discarded encounters are frozen by triggers. Corrections to signed ones are appended as amendments.
- **History:** every change is appended to `encounter_status_events`.
- **Paused drafts:** a draft whose visit is back in the queue (only data from before migration 0019) is paused until its author continues it.

**AI review item** (facts, recommendations, draft items, image analyses): `pending → accepted | edited | rejected | deferred`.
- `superseded` applies when a newer run replaces the item.
- Flagged items need explicit confirmation before they can be accepted.

**Mana answer:**
- The record answer is written once and never changes.
- The AI part moves from `pending` to `succeeded` or `failed`. Only `failed` can be retried.
- `unavailable`, `consent_required` and `not_requested` are final.
- Marking an answer reviewed, and inserting it into a note, are appended actions.

**Note insertion:** append-only.
- At signing each insertion is recorded in the signed snapshot, with `retained: true/false`, meaning whether the inserted text is still present unchanged.

**Consent** (implemented, [ADR 0006](adr/0006-consent-lifecycle-and-enforcement.md)): `granted → withdrawn`, or `granted → superseded` by a renewal under the current wording.
- A row ends once (database trigger). At most one ongoing grant per purpose is active.
- Computed states: granted, outdated (earlier wording), withdrawn, not recorded.
- Withdrawal ends every grant of the purpose and applies its effects at once:
  - portal account switched off, sessions ended, codes revoked;
  - device assignments ended;
  - research datasets blocked.
- Patients withdraw in the portal; staff grant after reading the wording to the patient.

**Portal account:** `none → active` (activation code). `active → deactivated` when portal consent is withdrawn or staff switch it off. `deactivated → active` with a reset code, after new consent.

**Device assignment:** `active → ended`, and it can end only once.

**Alert** *(planned)*: `open → acknowledged → resolved`, with `escalated` possible from `open` or `acknowledged`.
- Every change is an appended `alert_event`.
- Rules are versioned. Thresholds are **synthetic demo values only**, until a qualified clinical owner supplies approved values.

## 5. Mana AI (implemented in this session)

### Retrieval layer

`apps/api/src/mana/record.ts`:
- Authorization is checked first. Only doctors may call it (`ai:use`), and the patient must belong to the caller's facility; another facility's patient is indistinguishable from a missing one (404). A consultation id must belong to the same patient.
- It reads one patient only, from bounded windows set in `config/adaxai.yaml` → `mana`:
  - the 10 most recent signed consultations;
  - 365 days of vital signs;
  - recent visits;
  - approved thermal measurements;
  - the open consultation draft, labelled as a draft.
- Every item has a stable reference: A allergy, N note field, D diagnosis, M medicine, X amendment, C today's draft, P today's draft prescription, V vital sign, R reason for visit, T thermal.
- Each item also carries its record type, consultation id, date, field, status (signed / amended / draft / active / inactive / recorded), provenance, and an excerpt with identifiers replaced.

### Record answers

`apps/api/src/mana/answers.ts`, rules `mana-record-v1`.

Intents:
- briefing;
- history summary;
- last prescription;
- vital signs compared with the previous reading;
- changes since the previous visit;
- allergies;
- diagnoses;
- free-text record search.

The rules flag:
- recorded allergy vs. prescribed medicine (configured, illustrative groups);
- "no known allergies" vs. active allergies;
- disagreeing readings at one visit (configured tolerance);
- records older than `outdatedDays`;
- amended consultations.

### AI summary

- **Gates:** it runs only with a configured provider and a current `ai_record_assistant` consent.
- **What is sent:** only the items relevant to the intent, within `maxContextChars`; the references sent are stored on the job. Age band and sex are sent; name, MRN and phone never are.
- **What is recorded:** job, run, provider, model, prompt version and token counts.
- **Failure:** recorded as failed, retryable where appropriate. The record answer stays.

### Persistence and audit

- **Storage:** `mana_questions` holds the question, intent, record answer and source snapshot. A trigger allows only the AI part to be completed, while it is pending or failed.
- **Review:** the reviewed flag and note insertions are appended to `ai_review_actions` and `note_insertions`.
- **Audit:** `mana.ask`, `mana.read`, `mana.review`, `ai.job_create`, `ai.patient_qa`, `encounter.ai_insert`.

### User interface

- **Placement:** a Mana panel on the doctor's patient record, and in the right-hand panel of the consultation workspace.
- **Asking:** suggested questions, or free text.
- **Answers:**
  - statements grouped by section;
  - kind badges: not in record, conflict, possibly outdated;
  - expandable sources with field, date, status and provenance, plus a link to the consultation;
  - a separately labelled AI summary.
- **Actions:** Mark reviewed; Insert into note, which records the AI provenance; Retry for a failed summary.
- **Visibility of insertions:** shown under the note section, in the sign dialog, and on the signed record.

## 6. Acceptance criteria and their tests

| Criterion | Test |
| --- | --- |
| Record answers cite source, consultation, date, field and status; outdated and conflicting records are flagged; no provider gives an explicit unavailable state and no AI job | `apps/api/test/mana.test.ts` › "answers the last prescription with source, date, field and status…" |
| Vital signs compared with the previous reading; disagreeing readings flagged | `mana.test.ts` › "compares today's vitals…" |
| Absence stated | `mana.test.ts` › "states what is absent…" |
| No cross-patient leakage; another patient's consultation refused | `mana.test.ts` › "summarizes history and changes… from this patient's record only" |
| Amendments flagged | `mana.test.ts` › "flags an amended consultation…" |
| Doctors only; facility-scoped; immutable answers; reviews and idempotency | `mana.test.ts` › "is for doctors only…" |
| AI summary is consent-gated, pseudonymised, citation-verified and provenance-recorded | `mana.test.ts` › "needs the patient's consent, sends only this patient's pseudonymised items…" |
| Failure keeps the record answer; retry works | `mana.test.ts` › "a failed summary keeps the record answer…" |
| AI text enters the note only by recorded insertion of reviewed output; duplicates, stale versions and other doctors are refused; signed snapshot keeps references; append-only | `mana.test.ts` › "only by explicit insertion of reviewed output…" |
| Browser: briefing with sources, labelled AI summary, follow-up question, insertion with provenance through signing, answers on the profile, axe and mobile layout | `e2e/mana.spec.ts` (desktop and mobile) |
| Unsigned drafts from any day listed for their author only, in their facility; list reads audited with patient ids | `lifecycle.test.ts` › "lists only the doctor’s own drafts…", "is for doctors only…" |
| Concurrent starts create one consultation; a paused draft is not editable or signable until its author continues it | `lifecycle.test.ts` › "concurrent starts…", "a draft whose visit is back in the queue is paused…" |
| The database allows exactly the contract's visit transitions; open consultations block cancel and no-show; refused manual status changes audited | `lifecycle.test.ts` › "the database allows exactly the transitions…", "cannot cancel or mark as no-show…" |
| Status history with actor, source and reason; append-only; no anonymous app changes | `lifecycle.test.ts` › "every change records who, how and why…" |
| Discard: reason, author, version; read-only afterwards; visit back to the queue; new start possible; concurrent sign and discard | `lifecycle.test.ts` › "discarding an unsigned draft" |
| Signed-record verification: valid, tampered content, rows or hash, unsupported version, missing hash, legacy v1, notes | `integrity.test.ts` › "signed-record verification" |
| Amendments numbered, timed and hash-linked by the database; changed, removed or reordered ones detected; provenance of AI text preserved | `integrity.test.ts` › "amendments" |
| Audit hash chain: concurrent writes, rollback, altered/deleted/reordered/unlinked events, pre-chain digest, anchors, isolation level, admin API, CLI | `integrity.test.ts` › "audit log hash chain" |
| Application role has no UPDATE/DELETE/TRUNCATE on append-only tables | `integrity.test.ts` › "privileges of the application role" |
| Tests and scripts cannot empty, reseed or migrate the development database | `db-safety.test.ts` |
| Browser: worklist and discard, signed record verification and history, admin chain check with anchor, axe and mobile layout | `e2e/record-lifecycle.spec.ts` (desktop and mobile) |

Acceptance criteria for the planned slices are written in [AUDIT.md](AUDIT.md) §7 and will move here as each slice lands.

## 7. Languages

- **Now:** the UI is English only.
- **Transcripts:** stored as given. Segments can be cited whatever the language.
- **Planned:** language metadata on transcripts and segments (English, Tamil, Hindi, code-mixed), and a WER harness on synthetic code-mixed reference text.
- **Claims:** no accuracy claim is made for any language.

## 8. Architecture decisions

See [adr/](adr/).
