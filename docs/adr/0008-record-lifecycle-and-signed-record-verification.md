# ADR 0008: Record lifecycle in the database, unsigned-draft worklist, and versioned signed-record verification

- **Status:** accepted
- **Date:** 3 Oct 2026

## Context

The Phase 0 audit and the slice 3 read-only map found these gaps:

- **Visit statuses were checked only in the API.**
  - A visit with an open consultation could be moved back to the queue and then cancelled.
  - Signing then completed a cancelled visit and overwrote its terminal status.
  - Starting a consultation re-read the visit outside its transaction, so a concurrent cancel could be undone.
- **No status history.** The only trace was the audit log, which held no reasons and missed the implicit moves (vitals, signing).
- **Drafts could be lost.**
  - Unsigned drafts from earlier days disappeared from every worklist: the queue shows today only.
  - A draft could not be closed without signing it.
- **The signed fingerprint was never re-checked.**
  - The SHA-256 of the signed snapshot was unversioned and never recomputed outside tests.
  - Amendments were not covered by any fingerprint.
  - Nothing in the database stopped an already-signed row from being inserted, AI text from being recorded into a signed note, or a backdated amendment.

## Decision

### State machines, enforced twice

**Visits.** The manual moves are those in `VISIT_TRANSITIONS`:
- `waiting` → `in_triage`, `ready`, `cancelled` or `no_show`;
- `in_triage` → `ready`, `waiting` or `cancelled`;
- `ready` → `in_triage`, `cancelled` or `no_show`.

The consultation makes the other moves:
- starting it (or its author continuing it) moves an open visit to `in_consultation`;
- signing completes the visit;
- discarding the draft returns the visit to `ready`.

Closed visits never change. A visit with an unsigned consultation cannot be cancelled or marked as a no-show, and a cancellation needs a reason.

While the patient is with the doctor, the visit's doctor and department do not change. This is enforced in editing, in routing and in the database (migration 0020, `AX005`): the consultation's author is fixed.

**Consultations:** `in_progress` → `signed` or `discarded`. Both end states are final and immutable.

**Enforcement.** The API checks these rules first and answers with clear conflicts. A trigger in migration 0019 enforces the same rules in the database, as a backstop:
- `AX003`: invalid transition;
- `AX004`: an unsigned consultation blocks the change.

A test enumerates every pair of statuses and checks that the database allows exactly the contract's moves.

**Concurrency.** Every change is compare-and-set:
- the visit's status;
- the consultation's version;
- for resume, a row lock on the visit.

The request may carry the status the user saw (`from`), so a stale screen cannot apply a change. Starting a consultation is idempotent under concurrency: there is one non-discarded consultation per visit, enforced by a partial unique index.

### Who, when, how and why

Every status change and check-in writes a row to `visit_status_events` or `encounter_status_events`, through database triggers.

Each row records:
- the from and to statuses;
- the source (check-in, queue, vitals, consultation start/resume/signed/discarded);
- the reason;
- the acting user;
- the time.

**Attribution.** The API names the acting user per transaction (`set_config('adaxai.actor_id', …, true)`). The triggers refuse a status change by the application role that names no user (`AX002`).

**Protection.** The history tables are append-only (trigger and privileges).

**Starting point.** Existing visits and consultations received one `history_start` event, which marks where the history begins.

**Audit log.**
- Refused manual visit status changes (queue) are audited as failures.
- Other lifecycle refusals are answered with a clear 409 and are not audited. These include stale or concurrent consultation writes, a paused draft, a reassignment during a consultation, and the database backstops. They are conflicts, not access denials; denials are audited under ADR 0007.
- Reasons stay in the history tables, not in the audit log.

### Unsigned drafts are never lost; discarding is deliberate

`GET /api/encounters/mine` lists:
- the doctor's own unsigned drafts in their facility, from any day;
- or their records signed in the last 30 days.

The list read is audited with the patient ids it showed.

A draft can be **discarded**:
- only by its author;
- only with a reason (3–300 characters);
- at the version the author saw.

Effects of a discard:
- the draft is kept, read-only, with who, when and why;
- it leaves the timeline, the queue and the portal;
- the visit returns to the queue, and a new consultation can start on it.

### Signed-record verification (versioned)

**Scheme v1:** records signed before migration 0019, with no scheme marker. It is SHA-256 of the sorted-key canonical JSON of the snapshot.

**Scheme v2 (current):**
- the snapshot names its scheme;
- it also covers the facility, the visit id, the reason for visit and the signing attestation;
- the serialisation is strict: no undefined values, dates or non-finite numbers, so a fingerprint is never computed over something the stored JSON cannot reproduce.

**Covered in both schemes:**
- patient identity;
- doctor;
- visit date and token;
- the seven note sections;
- diagnoses;
- prescription;
- references to AI-assisted text;
- the signing time.

**Not covered:** vitals, allergies, attached images and recordings, and later changes in other tables.

**Amendments** are numbered, timestamped and linked by the database. Each one's `prev_hash` is the previous amendment's hash, or the record's `content_hash` for the first. Its `content_hash` is the SHA-256 of a documented canonical text (`adaxai.amendment.v1`). The verifier rebuilds that text independently.

**`GET /api/encounters/:id/verification`** returns `valid`, `invalid`, `unsupported_version` or `unverifiable`, with each check. The checks are:
- **Scheme.** The `hash_scheme` column can be edited, so it is cross-checked against the scheme named by the signed content and by the signing's audit entry. A disagreement is `invalid`, never "unsupported" or "legacy". A record shown as "unsupported" must still agree with the audit log's copy of its fingerprint.
- **Content** against the fingerprint.
- **The record's rows** against what was signed: note, diagnoses, prescription, AI-text references, identity, visit and facility (whenever the snapshot names them), and the signing time.
- **The audit log's copy** of the fingerprint.
- **The amendment chain.** Amendments without a link are accepted only on records signed before linking began, and only before the first linked one.
- **Amendments against their audit entries**, in both directions. One added outside the application, or one removed since, including the newest, is `invalid`.

**Consistency.** All reads of a check come from one read-only, repeatable-read snapshot. An amendment committed while the check runs is therefore seen whole, with its audit entry, or not at all. A test showed that without this, concurrent checks reported false alarms.

**Missing markers.** An absent scheme marker, in the snapshot or in the audit entry, is evidence of version 1, because only version 1 wrote none.

Differences that are not tampering (for example, a patient's name corrected later) are shown as notes. Every check is audited.

**Wording:** the UI shows the result only after the check has run, together with a fixed statement of its limits (`VERIFICATION_LIMITS`).

### Database guards added

- No consultation is inserted already signed, or for a visit of another patient or facility.
- A draft keeps its patient, visit, facility and author.
- A signature names its scheme.
- Consultations are never deleted.
- AI text cannot be recorded into a signed or discarded note.
- Amendments are added only to signed records, with the database's time.

## Consequences

- **The queue offers no manual move away from "With doctor".** The nurse's "Ready for doctor" button no longer appears on visits with the doctor.
- **Paused drafts.** Data from before slice 3 may hold an unsigned draft on a visit that is back in the queue. Such a draft is paused (no edits or signing) until its author continues it.
- **Visit lookups.** Lookups of other facilities' visits, including through routing, are now audited, like consultations.
- **What the fingerprints prove:** only that the stored content matches what was fingerprinted. They are not digital signatures.
  - They do not show who signed, or clinical correctness.
  - A superuser can rewrite both the content and the fingerprints.
  - Detecting a rewrite needs the audit chain's anchor (ADR 0009).
- **Discarded drafts keep their recorded audio.** Retention still deletes consultation audio only after signing. Applying the policy to discarded drafts is a product decision.
- **Signing rights.** Only the author can edit, sign or discard a draft. If the author leaves, the draft stays on the list until a supervised reassignment exists. That is a product decision, recorded in STATUS.md.
