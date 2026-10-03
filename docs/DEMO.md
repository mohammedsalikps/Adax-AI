# ADAXAI demonstration (synthetic data only)

Everything here is synthetic: patients, staff, transcript and audio are fictional. ADAXAI is an
MVP; it is not production-ready, not a medical device, and none of its AI output, rules or
measurements are clinically validated.

## Preparation

```bash
npm run setup
```

```bash
npm run dev
```

```bash
npm run demo:seed -- --fresh
```

`demo:seed -- --fresh` creates a new **Ravi Demo-Synthetic-XXXX** (the suffix is printed): consents
recorded (including *Mana AI record summaries*), a penicillin allergy, one signed earlier consultation (type 2 diabetes, metformin) and
today's visit with vitals, ready for the doctor. Use `--fresh` for every clean run.

Staff accounts. Sign in with the username, not an email address. Password: the exact value of
`SEED_DEMO_PASSWORD` in your `.env` (see the README's Troubleshooting if sign-in fails):

| Account | Role |
| --- | --- |
| `nurse.anil` | Nurse (General Medicine) |
| `dr.meera` | Doctor (General Medicine) |
| `dr.rahul` | Doctor (Paediatrics) |
| `admin` | Administrator |

Use two browser windows (or one normal and one private) to switch roles quickly.

**With or without AI keys.** Without keys (the default), the AI steps show a clear “unavailable”
state, and everything else works, including the rule-based safety checks and routing. With
`ANTHROPIC_API_KEY` in `.env` (and optionally `AI_STT_API_KEY`), restart `npm run dev` to also
show drafting, fact extraction, AI recommendations and photo description. Only do that with
synthetic data and after checking your provider agreement.

## 1. Nurse intake (nurse.anil)

1. **Register patient**: a new synthetic patient (any name, date of birth, sex, phone). Note the
   MRN shown after saving. Possible duplicates are flagged.
2. In the check-in dialog choose General Medicine, reason for visit *“Chest pain since this
   morning”*, check in. The daily token appears.
3. On the patient record: **Consents** → record *Patient portal*, *Consultation recording & AI
   assistance* and *Device readings* (verbal); **Allergies** → *No known allergies*.
4. Queue → **Vitals**: temperature 37.6, heart rate 96, BP 142/88, SpO₂ 96.
5. Queue → **Routing** → **Suggest routing**: the configured red flag (*“chest pain” in the
   reason for visit*) with its escalation instruction, *urgent for staff review*, and the reason
   for each part (rules `routing-rules-v1`). **Apply suggestion** (or **Override** with a reason).
6. **Ready for doctor**.

## 2. Mana AI on the patient record (dr.meera)

1. **Patients** → open **Ravi Demo-Synthetic-XXXX**. The **Mana AI** panel is at the top.
2. **Pre-consultation briefing**. The answer is read from the record by explicit rules (no AI key
   needed):
   - penicillin allergy;
   - today's reason for visit and vital signs compared with the earlier reading;
   - the last consultation;
   - the last signed prescription (metformin);
   - the diagnoses on record.

   Open **Sources** under any statement to see the record item: field, date, status (signed,
   draft, amended) and provenance, with **Open consultation**. Without a key the panel says *AI
   summary unavailable* and why; nothing is invented.
3. Ask in your own words, e.g. *“Any mention of chest pain?”*. Mana searches this patient's record
   and quotes the matching items, or says nothing matches.
4. With `ANTHROPIC_API_KEY` set (and the seeded consent), each answer also gets a separate
   **AI-generated summary**:
   - it cites record items;
   - anything the server cannot tie to a record item is marked *Not supported by the record*;
   - it states what was not found;
   - it shows the provider, model and prompt version.
5. **Mark reviewed** records your name and time. Answers never change after they are given.

## 3. Doctor consultation with the AI assistant (dr.meera)

Use the seeded **Ravi Demo-Synthetic-XXXX** for this part; he has history to compare against.

1. Queue → **Start consultation**. The workspace has three panels on wide screens: visit and
   timeline, the note, and Mana with the assistant. The left panel shows today's vitals and the timeline with the
   earlier signed consultation; the banner shows the penicillin allergy.
2. AI assistant: consent is already recorded (current wording). Paste
   [`demo/consultation-transcript.txt`](../demo/consultation-transcript.txt) → **Save transcript**
   (segments S1…S13).
3. **Generate draft** and **Extract facts**: without a key both say *unavailable* (no
   placeholder text). With a key: facts tagged *Patient said / Clinician said*, linked to
   transcript lines, with flags. “No, no allergies” is flagged **Conflicts with the existing
   record** (penicillin) and cannot be accepted without ticking the confirmation.
4. Prescription → **Add medicine** → *Amoxicillin*. Then **Get recommendations**:
   - rule-based (always): *Check Amoxicillin: recorded allergy to Penicillin* (configured,
     illustrative penicillin group), the *chest pain* red flag with its instruction (the negated
     *“no shortness of breath”* is not flagged), the raised temperature;
   - with a key: AI suggestions with *Why*, cited record items and transcript lines, *Not found in
     the data*, and model + prompt version; uncited ones are marked unsupported.
5. Review each item: **Accept**, **Edit**, **Reject** or **Defer**. Accepting changes nothing in
   the note or prescription; use **Add to …** to copy text into the note yourself.
6. Remove Amoxicillin (accepting the safety check), write the note, add diagnosis and a
   suitable prescription, then **Review and sign**. Only what is in the note is signed.
7. **Activity** tab: every job with provider, model, prompt or rules version, data origin
   (*Synthetic data*), retries for failures, every review decision and the audit trail.
8. Optional: **Clinical photographs** → add a synthetic image (JPEG/PNG/WebP); **Stethoscope
   recordings** → upload a synthetic audio file and play it back.

### Mana in the consultation

Ask **Last prescription** in the right-hand panel. With Amoxicillin in today's draft prescription,
Mana flags a **Conflict** with the recorded penicillin allergy (illustrative configured group).
**Insert into note…** lets you edit the text, choose a section and insert it:
- the note shows *AI-assisted text from mana answer* under that section;
- the sign dialog lists it;
- the signed record keeps the reference.

Accepted assistant items use **Add to …** the same way.

## 4. Signed record, drafts and integrity

1. On the patient record, the visit links to the signed consultation.
   - The signed view shows the content hash and **Print prescription**, labelled not valid in this build.
   - Signed records cannot be edited. Corrections are added with **Add amendment**; each is numbered and linked to the record's fingerprint.
2. **Record verification** → **Check now**. It shows the real result of re-checking the stored content, the record rows, the audit copy and the amendment chain against their fingerprints, with what that does and does not mean.
3. **Status history** → **Show**: who moved the visit and the consultation, when, how and why.
4. **My consultations** (doctor menu) lists your unsigned drafts from any day.
   - Drafts from earlier days are flagged; the queue shows today only and warns about them too.
   - **Continue** a draft, or **Discard…** it with a reason. The draft is kept read-only, leaves the patient's history, and the visit goes back to the queue as *Ready for doctor*.
   - **Signed recently** lists the last 30 days.
5. A visit with an unsigned consultation cannot be cancelled or marked as a no-show; the queue explains why.

## 5. Patient access

1. As nurse: patient record → **Patient portal** → issue an activation code (consent required).
2. In a private window open `/activate`: MRN, activation code, a new password → the patient lands
   on their home page: follow-up advice, latest visit.
3. **Records**: the signed consultation with its prescription; **Visits**, **Vital signs**,
   **Consents**, **My details**. Drafts, transcripts, AI output and photographs are not shown.
4. Isolation: opening another patient's record address shows *Record not found*; staff pages
   send the patient back to their home page; the API answers 403/404 (all audited).
5. On a phone or with the browser's device mode, the portal is responsive and installable
   (browser menu → *Install app*). Only the app shell is cached, never records.
6. **Consents** in the portal: the patient can **Withdraw…** a consent. The dialog says what
   changes at once (e.g. research datasets that include them are blocked); the reason is
   optional. A consent given under an earlier wording is labelled *Earlier wording*.
7. As nurse: the patient record's **Consents** card shows each purpose's state, who withdrew it
   (staff, or the patient in the portal), the reason, and the full **Consent history**.
   **Withdraw…** on *Patient portal* switches the account off at once: the patient's next page
   load goes to sign-in.
8. To restore access: **Record consent** again, then **Issue reset code** on the *Patient portal*
   card; the patient sets a new password at `/activate`. If the patient withdraws portal access
   in the portal themselves, they are signed out with an explanation.

## 6. Appointments (nurse, doctor, patient, admin)

Synthetic data only. Times are on the clinic's clock (shown on every page).

1. **Book** (nurse): **Appointments** → **Book appointment**.
   - Find the patient, choose the department and optionally a doctor, then a date, a time and a length.
   - From a patient's record, the **Appointments** card books for that patient.
2. **Conflicts are refused, not moved.**
   - Book the same doctor at an overlapping time: the dialog says the clinician is taken and keeps your entries.
   - Back-to-back is fine.
   - The same patient cannot be booked twice at overlapping times, with any doctor.
3. Each row shows its time, the patient, the clinician, its status and, when the server allows it, **Check in**. Open **Details** for everything else:
   - **Reschedule…** books the new time and closes the old appointment as *rescheduled*.
   - **Cancel…** asks for confirmation and a reason, and frees the slot.
   - The history and the messages to the patient are there too.
   - The list can be filtered by status (with counts) and by patient name or MRN; the search runs on this device and sends nothing.
4. **Check in** (on the day of the appointment).
   - It creates the patient's visit in **OPD queue** with a token, or joins the visit they already have today. It never makes a second one.
   - The queue row shows the appointment time. No consultation is started.
   - Checking in again does nothing new.
5. **The doctor** (`dr.meera`) lands on **Home**: four numbers (in the queue, with a doctor, completed today, appointments to come), **Today's schedule**, the patients **Ready for you** with *Start consultation*, and shortcuts.
   - The same appointment is in **Appointments → My schedule** (assigned to them, or unassigned in their department), with the visit's state.
   - **OPD queue** (in the menu) is the full queue; start the consultation from there or from Home.
   - **Search patients** in the top bar opens the Patients page with the search filled in (the term is not put in the address).
   - When the consultation is signed, the appointment becomes *Completed* by itself.
   - Cancelling or marking the visit as no-show in the queue closes the appointment the same way.
6. **Messages to the patient.** The appointment's **Details** show each message and its delivery status.
   - Delivery is to the **patient portal only**. No SMS or email is sent.
   - Without a portal account the status is *Not delivered* with the reason.
   - After a booking, move or cancellation a message says whether the patient was told; if not, it says so and that nothing is sent by SMS or email.
   - After the patient activates the portal (see §5 above), **Try again** delivers the messages that still hold. A message about a time that no longer stands (for example “booked” for an appointment that was moved) is not retried.
   - The patient then sees it under **Appointments** in the portal, and **Mark as read** shows staff that it was seen. The booking reason (staff free text) is not shown to the patient, and a booked appointment whose time passed shows as “time has passed”, not upcoming.
7. **Administrator** (`admin`): **Appointments** shows the facility's schedule without patient names or reasons, and cannot change anything. There is no patient search in the top bar for administrators.
8. **On a phone** the menu is a drawer: it takes the focus, Escape or its close button shuts it, and the page behind it cannot be reached while it is open. Below 1280 px the schedule is a list of cards instead of a table.
9. A booked appointment whose time has passed is flagged *Awaiting an outcome*. Mark it **Did not attend…**, reschedule it, or cancel it; nothing does this automatically.

## 7. Oversight (admin)

- **AI operations**: provider status, job counts, failures, review outcomes per model and prompt
  version (*Includes synthetic*), **Store snapshot**. Counts only, no patient data.
- **Audit log**: sign-ins, record reads, AI review decisions, routing, portal reads, denials.
  - **Audit log integrity → Check the chain** recomputes every hash link and shows the current head.
  - Copy the head and keep it outside the system. Later, **Compare** it to detect removal of the newest events or a rewrite.
  - The same check runs from the command line: `npm run audit:verify`.
- **Devices**: registry and gateway tokens. No physical device is integrated
  ([DEVICES.md](DEVICES.md)).
- **Thermal data**: dataset counts, de-identified export and evaluation (labelled non-clinical).

## What the automated tests prove

`npm test` runs the API tests (real PostgreSQL), the service-worker policy tests, the Python
tests and the Playwright suite (desktop and mobile, axe WCAG 2.2 AA, phone-overflow checks). For
this demonstration see `apps/api/test/appointments.test.ts`, `appointments-db.test.ts`,
`appointment-notifications.test.ts`, `e2e/appointments.spec.ts`, `apps/api/test/lifecycle.test.ts`, `integrity.test.ts`, `db-safety.test.ts`,
`e2e/record-lifecycle.spec.ts`, `apps/api/test/mana.test.ts`, `e2e/mana.spec.ts`, `apps/api/test/ai-clinical.test.ts`, `portal.test.ts`, `routing.test.ts`,
`images.test.ts`, `devices.test.ts`, `hardening.test.ts` and `e2e/*.spec.ts`. AI output in tests
comes from test doubles or the test-only mock `e2e/mock-anthropic.mjs`.
