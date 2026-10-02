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
| Doctor | `/doctor` | Dashboard (today's appointments, waiting, active, completed, drafts awaiting review, alerts, follow-ups due); patient list and profile; **Mana AI**; three-panel consultation workspace; notes and prescriptions with immutable signed versions and amendments. |
| Admin | `/admin` | Staff and roles; facility and departments; routing and alert configuration viewers with versions; device registry; AI job and provider status; review metrics; audit search, filter and export; operational health. |

## 3. Domain entities (PostgreSQL)

Implemented tables are listed in `apps/api/src/db/schema.ts`. Planned items are marked *(planned)*.

| Area | Entities |
| --- | --- |
| Identity | facilities, departments, users (roles: admin, doctor, nurse, patient), sessions, audit_events (append-only) |
| Patient | patients (MRN sequence), allergies, consents (typed, versioned, withdrawable), patient_activation_codes |
| Flow | visits (daily tokens), observations (vitals; `source`, `validation_status`, device), *(planned)* appointments, appointment_status_events, notifications |
| Record | encounters (signed snapshot + content hash), diagnoses, prescription_items, encounter_amendments, **note_insertions** |
| AI | ai_jobs, ai_runs, ai_prompt_versions, ai_settings_snapshots, ai_models, transcripts, transcript_segments, clinical_facts, ai_recommendations, ai_evidence, ai_review_actions, **mana_questions**, *(planned)* transcript_corrections |
| Imaging and devices | clinical_images, image_analyses, thermal_* tables, devices, device_assignments, auscultation_recordings, *(planned)* device_batches, alert_rules, alerts, alert_events |
| ML | evaluation_runs, dataset_memberships, *(planned)* model cards and evaluation datasets for text and speech |

## 4. State machines

**Appointment** *(planned)*: `booked → checked_in → (visit flow) → completed`.
- From `booked` the appointment may also become `cancelled`, `rescheduled` (a new appointment linked to the old one) or `no_show`.
- Every transition is appended to `appointment_status_events` with actor, time and reason.

**Visit:** `waiting → in_triage → ready → in_consultation → completed`.
- `cancelled` and `no_show` are reachable from open states.

**Encounter:** `in_progress → signed`.
- Signing is a separate doctor action with an attestation.
- A signed encounter is frozen by triggers; corrections are appended as amendments.

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

Acceptance criteria for the planned slices are written in [AUDIT.md](AUDIT.md) §6 and will move here as each slice lands.

## 7. Languages

- **Now:** the UI is English only.
- **Transcripts:** stored as given. Segments can be cited whatever the language.
- **Planned:** language metadata on transcripts and segments (English, Tamil, Hindi, code-mixed), and a WER harness on synthetic code-mixed reference text.
- **Claims:** no accuracy claim is made for any language.

## 8. Architecture decisions

See [adr/](adr/).
