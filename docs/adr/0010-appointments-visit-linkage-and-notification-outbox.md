# ADR 0010: Appointments as promises linked to visits, a database-enforced booking policy, and an in-app notification outbox

- **Status:** accepted
- **Date:** 3 Oct 2026

## Context

Before this slice there was no appointment of any kind:
- patients could only be checked in as walk-ins (a visit with a token);
- the patient portal told patients to contact the clinic to book;
- there was no notification mechanism, and no SMS, email or push provider.

Slice 3 had just made visits and consultations a database-enforced state machine, with status history, audited refusals and append-only protection. An appointment must not become a calendar that is disconnected from those.

## Decision

### An appointment is a promise, a visit is what happens

- **Separate entities.** An appointment is not a visit. Booking never creates a visit, a token or a consultation.
- **Check-in** is the only link. It creates or joins **exactly one** visit and records it in `appointments.visit_id`, which is unique.
- **Walk-ins are unchanged.** Check-in without an appointment (`POST /api/visits`) works as before, and both paths share one function that creates a visit (`createVisit`), so tokens are allocated the same way.
- **No unintended transitions.** Checking in never starts a consultation or marks the patient as "with doctor". Only the doctor's own action does that.

### Time

- **Stored as an instant** (`timestamptz`) plus a duration. The facility's timezone (`facilities.timezone`) gives the local day and clock time.
- **Staff enter a local day and clock time.** The conversion runs in PostgreSQL, the same timezone database that decides "today" for the queue.
  - A clock time that does not exist (a daylight-saving gap) is **refused**, never moved.
  - A repeated clock time (the clocks go back) resolves to PostgreSQL's choice, the **later** occurrence (standard time). A test pins this.
- **The web never converts.** The API sends the local day and `HH:MM`, and the web only formats them, so the browser's timezone plays no part.
- **Booking rules:**
  - not in the past;
  - at most 180 days ahead;
  - start times on 5-minute marks;
  - lengths of 10, 15, 20, 30, 45 or 60 minutes.

### Scheduling policy: conservative, and not clinical policy

The product has no clinic hours, clinician calendars or capacity model, so none was invented. What is enforced, in the database (`btree_gist` exclusion constraints), is:
- a **doctor** cannot hold two overlapping slots;
- a **patient** cannot hold two overlapping slots, whichever doctor they are with;
- while an appointment is booked or checked in, it holds its slot. Closing it releases the slot;
- slots are half-open, so back-to-back appointments are fine;
- an appointment with **no doctor** holds no doctor slot (department capacity is not modelled);
- a doctor who works in a department can only be booked into that department.

The refusal message says only which kind of slot is taken, and names no other patient. Constraint names map to specific errors (`slot_taken`, `patient_double_booked`), unlike a blanket "unique violation".

### State machine, enforced twice

**Transitions** (`APPOINTMENT_TRANSITIONS`; a test checks that the database allows exactly these):
- `booked` → `checked_in`, `cancelled`, `rescheduled` or `no_show`;
- `checked_in` → `completed`, `cancelled` or `no_show`.

**Manual and visit-driven moves:**
- Staff move only `booked` appointments, by check-in, cancel, reschedule or did-not-attend.
- A **checked-in appointment follows its visit.** A database trigger on `visits` completes it when the consultation is signed, and cancels it, or marks it no-show, when the visit is closed in the queue. It is one place, so no route can forget it.
- By hand, a checked-in appointment cannot be cancelled, moved or marked as a no-show.

**Immutability:**
- Closed appointments are frozen.
- A booked row never changes apart from its status: **rescheduling books a new appointment** (`rescheduled_from` / `rescheduled_to`) and closes the old one as `rescheduled`, so no earlier state is erased.
- Rows are never deleted.
- A cancellation needs a reason.

**History:** every booking and status change is written by a trigger to `appointment_status_events`, with the acting user, source, reason and time. It is append-only. The acting user is named per transaction (`adaxai.actor_id`), as for visits; the application role cannot change an appointment without naming one.

### Concurrency and retries

- Every change is compare-and-set on the status and `version`; the request carries the version the user saw. A stale screen gets a clear 409.
- **Slots are taken in a fixed order.** Booking and rescheduling first take a transaction-scoped advisory lock per clinician and per patient involved, sorted, before they write anything. Competing changes therefore queue instead of waiting on each other's rows, so a clash is always answered by the exclusion constraint (`slot_taken`, `patient_double_booked`) and never by a database deadlock. If PostgreSQL still ends a change as a deadlock or serialization failure (`40P01`, `40001`), nothing was saved and the answer is a 409 `try_again`, not a 500.
- A booking or reschedule carries a client-generated **idempotency key**.
  - A retry returns the same appointment (200).
  - The same key for a different request is refused with `idempotency_key_reused`, also when the two requests arrive at once (never a 500).
  - Identical requests at once make one appointment (booking) or one replacement (rescheduling): the second gets the first one's result, and no failure is audited.
- **Check-in** locks the appointment row. A second or simultaneous check-in waits and then gets the first one's result, with no second visit and no second token.
  - If the patient already has an open visit today, check-in joins it, unless it belongs to another appointment (`visit_linked_elsewhere`).
  - Losing a race with a walk-in check-in is handled in a savepoint and ends in the same joined visit.
- The audit event is the last statement of every transaction, and visit creation does not audit itself, so the audit chain lock (ADR 0009) never waits on a row lock.
- Refused status changes are audited as failures.

### Notifications: an outbox with one real channel

- **One message per appointment and event** (`dedup_key` is unique): booked, rescheduled (the new appointment) and cancelled. Repeating a request never queues it twice.
- **The only channel is the patient portal** (`in_app`).
  - "Delivered" means available there.
  - **No SMS, email or push provider exists, so none is used or claimed.**
  - The UI says so wherever delivery is shown.
- **Delivery rule:** a message is delivered when the patient has an active portal account and their portal consent is still in force. Otherwise it is recorded as undeliverable, with the reason (`no_active_portal_account`, `portal_consent_withdrawn`, ...).
- **Retry:** staff can retry. An attempt is made **exclusively**: the message row is locked (`FOR UPDATE SKIP LOCKED`) for the whole attempt, which is one transaction (claim, channel call, outcome, attempt record). A request that finds it locked skips it, so two retries together, or a retry racing the first automatic attempt, make one attempt; a delivered message is never attempted again; and an attempt that dies half-way leaves nothing behind, so the attempt count and the attempt log always agree. Every attempt and outcome is recorded in `notification_attempts` (append-only). The appointment row is share-locked and its status re-read after the claim, so a cancel or a move either committed before the check (the message is not delivered) or waits until the attempt has committed. The lock is held while the channel runs: fine for the portal (a few indexed reads), and a channel that calls out over a network must bound its own time.
- **Only true messages are retried.** A message is worth delivering only while it still holds: “booked” and “moved” while the appointment is open, “cancelled” once it is cancelled (`notificationIsCurrent`). A message that never arrived and no longer holds (for example “booked” for an appointment that was since moved) is shown as not needed and is not retried, so a patient who gains portal access later is not told about a time that no longer stands.
- **Staff are told whether the patient was told.** Each appointment carries the status of its newest message (`patientMessage`). After a booking, move or cancellation the toast says whether the message is available in the portal or that the patient has not been told (and that nothing is sent by SMS or email), and the schedule flags a cancellation or a failed message the patient may not know about. A booking for a patient without a portal account is the normal state and is not flagged on every row.
- **Failures:**
  - A channel that throws is recorded as a failed attempt.
  - It never fails the booking.
  - Its error text is not kept, because it could echo content.
- **Content:** a message holds times, the department and the clinician's name only. It is rendered when shown, from non-clinical fields. It never carries the reason for the visit or a cancellation reason. Audit events hold counts only.
- **Preferences:** there are no communication preferences in the product. Portal messages follow the patient's portal consent, the only relevant control that exists.

### Who sees what

| Role | Appointments |
| --- | --- |
| Doctor, nurse | Facility-scoped schedule; book, reschedule, cancel, did-not-attend, check-in; history and message status; retry. A doctor can limit the list to their own patients (assigned to them, or unassigned in their department). |
| Administrator | The facility's schedule **without patient identity or free text**; no changes (minimum necessary, ADR 0007). |
| Patient | Their own appointments and delivered messages in the portal; can mark a message read. **Patients cannot book or cancel.** The booking reason is staff free text and is not shown to them. A booked appointment whose time passed without an outcome is shown as “time has passed”, not as upcoming. Messages are listed unread first, then by when they became available (not when they were queued). |

Another facility's appointment id is "not found", and the lookup is audited. Reads of the schedule are audited with the patient ids they disclosed (counts only for administrators).

## Consequences and limits

- **Not built:**
  - clinic hours, clinician calendars, department capacity, recurring appointments, waiting lists;
  - patient self-booking or self-cancelling;
  - reminders (there is no scheduler);
  - automatic did-not-attend (staff mark it, and the schedule flags a booked appointment whose time has passed as "awaiting an outcome");
  - SMS, email or push delivery.
- **A message to a patient without a portal account** waits as "not delivered" until one exists and staff retry. Nothing reaches them by another route.
- **If a facility's timezone is edited,** future appointments keep their instant and are shown at the new local time. The instants are never rewritten.
- **Past appointments** are listed for 90 days on the schedule; the patient's record lists the latest 50.
- **Dates before 1900** are refused as a field problem (PostgreSQL has no year 0); this is not clinical policy.
- **A cancelled or moved appointment’s earlier messages** stay on record, with their delivery state; they are not deleted.
- **Check-in is allowed only on the appointment's own day.** An earlier day's booked appointment must be marked as did not attend or rescheduled.
- **The duration and horizon defaults** are defaults, not clinical policy. A clinical owner should confirm them.
