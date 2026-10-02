# ADAXAI status

**Last updated:** 2 Oct 2026.

ADAXAI is an MVP. It is not production-ready, not a medical device, and not clinically validated. All data is synthetic.

## Current slice: Mana AI patient-context Q&A, and AI text in notes with provenance

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

1. **Slice 2: consent and access control** ([AUDIT.md](AUDIT.md) §6):
   - consent states, renewal and withdrawal reasons;
   - portal withdrawal ends access;
   - default-deny route guard;
   - facility scoping of admin routes;
   - rate limiting;
   - audit of denials;
   - log redaction;
   - UI for consent status.
2. Record lifecycle and integrity.
3. Appointments.
4. Devices and alerts.
5. Consultation capture.
6. Admin and operations.
7. Evaluation harness.
8. The full 14-step demo.

## External needs (not blocking the MVP build)

- **A provider key and a data-processing agreement**, needed before any real AI summary can be evaluated. Use synthetic data only.
- **A qualified clinical owner**, needed for:
  - alert thresholds;
  - allergy groups;
  - the "outdated" threshold;
  - consent wording.
- **Legal / privacy review** of consent purposes and cross-border AI processing. Nothing here claims compliance.
- **Labelled, de-identified data**, needed before any model evaluation or training.
