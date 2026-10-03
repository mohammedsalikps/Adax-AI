# Doctor App audit: what actually works today

**Date:** 3 Oct 2026. **Basis:** the repository at commit `4be6256` plus the uncommitted authentication and application-entry slice (slice 4a, see [STATUS.md](STATUS.md)).

**Method and its limits.** Four independent read-only reviews, one each for the AI backend, the clinical record and its data model, devices and thermal imaging, and the web UI. They read code, tests and documents; they did not run anything. I spot-checked the claims that matter most against the code myself (listed under each section as "checked"). Every `file:line` below comes from those reviews and is a pointer, not a proof. Nothing here is a claim of clinical validity, regulatory compliance or production readiness.

**Status words used:**

| Word | Meaning |
| --- | --- |
| REAL | Backend, UI and automated tests all exist and pass |
| REAL (mock-tested) | Real code, tested only against a test double or a local mock of the external service; never exercised against the real thing |
| PARTIAL | Some of it is real; the rest is missing |
| UI ONLY | A screen element with no backend behind it |
| ABSENT | Does not exist |

## 1. The chain a doctor needs, stage by stage

| Stage | Status | Evidence and what is missing |
| --- | --- | --- |
| Doctor sign-in | REAL | Slice 4a. Doctor App door, lockout, sessions, role routing, tests at every layer |
| Dashboard | PARTIAL | `DoctorHomePage.tsx`: four real counts, today's schedule (capped at 8), "ready for you" list, four links. No greeting, department chip, trends, or Reports / Mana AI shortcuts. Row actions on the schedule are *Check in* / *Details*; *Start consultation* is in a separate card |
| Today's patients (queue) | PARTIAL | `QueuePage.tsx`: real queue, statuses, *Start consultation*. Cards, not a table; no All / Waiting / In room / Completed tabs; no date picker (the API supports `date`); actions are inline buttons, there is no overflow menu |
| Start consultation | REAL | `POST /encounters`; one draft per visit; doctor-only; tested end to end (`doctor-workflow.spec.ts`) |
| Patient profile | PARTIAL | A full page (`PatientProfilePage.tsx`), not a slide-over. The consultation screen **never loads patient detail**: its banner shows name, MRN, age/sex, DOB, phone and allergy substance names only (no severity, reaction, blood group, consents) |
| Past history | **ABSENT** | There is **no table, API or screen** for known conditions, current or previous medicines, or investigations/results. History is a free-text note section plus a *Timeline* card (diagnosis names and "drug strength" per earlier signed visit, no dose or frequency; also lists other doctors' unsigned drafts). Checked: the 50 tables in `schema.ts` contain none of these |
| Live transcription | REAL (mock-tested) / PARTIAL | Browser chunks every 20 s to an OpenAI-compatible `/audio/transcriptions` call. Text only: **no timestamps, no speaker separation, no language identification**, even though the columns `start_ms`, `end_ms`, `confidence` exist and are never written. Speaker comes only from a typed "Doctor:" prefix. Never run against a real speech server in any test; two real-provider attempts in the dev database both failed with `rate_limited` |
| Important-point extraction | REAL (mock-tested) | `clinical_facts` with categories, evidence excerpts, deterministic flags (no source, speaker mismatch, conflicts with record) and a review state. Missing: *patient concerns*; *duration* is only an optional attribute; *investigations* are folded into *plan* |
| Doctor notes | REAL | Seven note sections, autosave with version check, conflict handling, tested |
| AI summary | PARTIAL | Per-section note drafts and recommendations exist. **There is no consultation summary** (Patient context / Current visit / Assessment / Suggested plan), and by contract the AI may not draft diagnoses or prescriptions |
| Doctor review | REAL | Accept / edit / reject per item; flagged items need explicit confirmation; accepted text enters the note only through a recorded insertion with provenance; nothing is auto-signed (tested) |
| Sign, print, amend, verify | REAL | Hash-linked signed record, immutability triggers, amendments, discard, verification, print of the prescription |
| Patient sees the record | REAL | Signed records and amendments only, immediately; drafts and other patients' records return 404 |
| Admin visibility | PARTIAL | Counts, the schedule without patient identity, the audit log and its integrity check. Admin cannot read patients, queue or encounters (by design) |
| Audit trail for a consultation | PARTIAL | Status history, amendments, verification and an AI-activity list are visible to the doctor. Draft saves, reads and prints appear only in the admin audit log (which has no entity filter); printing is client-side and has no audit event |

## 2. AI backend

**What exists (all in `apps/api/src/ai/**`, `mana/**`):**
- Speech-to-text: `OpenAiCompatibleTranscriber` (`stt.ts`), a plain `fetch` to `{baseUrl}/audio/transcriptions`, enabled by `AI_STT_API_KEY`. Unconfigured: audio is stored and a notice returned; live recording returns 503.
- Four language-model capabilities, **all through the Anthropic SDK and all requiring `ANTHROPIC_API_KEY`**: note drafts, fact extraction, recommendations (plus an always-on rules step, `safety-rules-v1`), and photo description. Model in `config/adaxai.yaml`: `claude-opus-5-5`.
- Mana: a rules answer is always produced for a **single patient** (regex intent detection, the last 10 signed consultations and a year of vitals/visits/thermal), cited and immutable; an optional language-model summary is added when a key is set.
- Review, recorded insertion into notes, oversight views, job retry. Jobs run inside the HTTP request; there is no queue.

**Data egress (checked):**
- `providers.ts:146` builds the language-model provider **only** from `ANTHROPIC_API_KEY` and passes no base URL; the speech provider defaults to `https://api.openai.com/v1` with `gpt-4o-transcribe` (`config/adaxai.yaml:44-45`) once `AI_STT_API_KEY` is set. The settings schema allows only `provider: 'anthropic'`.
- With nothing configured nothing is sent (blank in `.env.example`; the test configuration never carries keys). **But this development machine's `.env` has both keys set** (names only inspected), so the dev app can send synthetic consultation text and audio to two third parties when a user consents. This is the opposite of the product direction (below) and is not a default we want.
- Consent gates exist for each feature (`ai_recording`, `ai_record_assistant`, `ai_image_analysis`). Audio cannot be pseudonymised; text scrubbing covers registered names, MRN and phone and is documented as best-effort.
- **Provider boundary:** interfaces exist; there is no registry. A local OpenAI-compatible provider would need new adapters for five interfaces (the zod output schemas are private to `anthropic.ts`; the Anthropic adapter uses Anthropic-only parameters). Whether Ollama or llama.cpp honour the JSON-schema parameters is **not verified**.

**Raw / extracted / confirmed (REAL, tested):** raw = immutable `transcript_segments`; extracted = `clinical_facts` / draft items with status *pending*; confirmed = *accepted* or *edited* with `final_text`. A confirmed item reaches the record only through `POST /encounters/:id/insertions` with provenance. Facts are never written to the allergy, prescription or diagnosis tables. Gap: accepting a *note-draft* item auto-inserts it into the note draft (a facts item needs a separate click), which is looser than "never automatic". There is no structured, signed "consultation facts" object, only the free-text note.

**Provenance:** `ai_runs` stores provider, model string, prompt version and input/output hashes; prompt checksums and a settings snapshot are recorded. No model weights version or hash, and no "local or external" flag.

**Mana against the owner's examples:** "Who visited two hours ago?" and "Which patients are waiting?": no cross-patient endpoint (falls to a word search). "What medications was this patient taking previously?": classified as *last prescription*, returns the last signed prescription and at most one earlier one, i.e. what was prescribed, not what is taken. "Show me the previous consultation": no such intent (closest: a briefing with 240-character excerpts of four fields). Mana does not read transcripts, extracted facts, the queue or appointments.

**Documents disagree:** STATUS.md (slice 1) says "no real provider has been called"; a later passage records two real speech-to-text attempts from the dev app, both `rate_limited`. The accurate statement: no *successful* real-provider response has ever been obtained or evaluated, so answer quality with a real model is unknown.

## 3. Devices and thermal imaging

| Capability | Status | Notes |
| --- | --- | --- |
| Wearable ingestion API | REAL (no hardware) | Bearer-token gateway route, per-token rate limit, assignment-window and consent checks, values range-checked, always stored as `device_unverified`. **No device, gateway or simulator exists**; the seed has no device data |
| Reading state (live / stale / disconnected / simulated / unavailable) | **ABSENT** | Schema, API and UI have only `source` (manual / device) and `validationStatus`. The consultation screen shows vitals as a plain list with **no time and no source**. A UI-created device assignment has no visit, so its readings do not reach the queue or consultation vitals. No push channel; only the queue polls (every 5 s) |
| Blood pressure | Manual entry only | No cuff or cuffless pipeline. The gateway would accept device BP kinds with no gate and no test |
| Stethoscope | PARTIAL (upload) | File upload and playback only; the card says no stethoscope is connected. No streaming, SDK boundary, simulator, analysis, or per-recording real/simulated flag; type checked by declared MIME only |
| Thermal measurement | REAL | FLIR radiometric JPEGs decoded to a °C matrix, regions with statistics and paired differences, doctor-only approval of measurements, 30 pytest tests, 12 API tests, 1 e2e (public sample files only; the samples are git-ignored) |
| Thermal "analysis" | Rules only | Fixed-threshold flags (warm regions, paired difference ≥ 1.0 °C), always `validated:false`. **No trained model exists**; a subject-grouped evaluation harness exists but trains nothing that is saved or served. No image-quality assessment, no confidence, no calibration check beyond camera constants, manual regions only |
| Thermal in the consultation | **ABSENT** | Reached only from the patient profile or its own pages |
| Labelling of measured vs model vs clinician | Informal | Measured values and "Experimental flags" are labelled and disclaimed; there is no "model output" because there is no model; no clinician-interpretation field in the care record |

## 4. Web UI against the reference mock-up

The reference is a clinical workstation: dashboard (greeting, four stat cards, schedule with *Start*, quick actions), *Today's Patients* (tabs, table), a three-column consultation workspace (AI transcription with waveform and key points, stethoscope and vitals tiles, writing pad; past history tabs; AI summary / recommendations / Mana tabs), and a patient-profile slide-over. The brand in code is ADAXAI.

| Element | Status |
| --- | --- |
| Sidebar: Home, Patients | REAL. *Today's Schedule* = Appointments (PARTIAL); *Consultations* = a worklist (PARTIAL); **Reports, Settings, a Mana AI page: ABSENT** (Mana is a panel) |
| Greeting, department chip, stat-card trends | ABSENT (stat cards themselves REAL with different labels) |
| Today's Patients tabs, date picker, table, overflow menu | ABSENT (the queue is a card list) |
| Consultation header: back arrow, "Consultation" title, **Live badge and timer**, "Vitals stable" badge, Print / Save / Complete | ABSENT or PARTIAL (`startedAt` exists in the contract and is unused; the title is screen-reader-only; Save / Review and sign exist in a bottom bar) |
| Patient banner: photo, condition chips, risk chips | PARTIAL: initials avatar, allergies as names; no photo, no conditions |
| Left column: AI transcription lines | PARTIAL: speaker label and segment id, no timestamps; **no waveform** |
| Key Points (AI) | PARTIAL: the *Facts* tab holds categorised, evidence-linked, reviewable facts; no such box |
| Stethoscope card with live tiles and heart-sound waveform | **ABSENT** (upload card only). Vitals tiles: data REAL, rendered as text |
| Digital writing pad | **ABSENT** (no ink model or storage) |
| Past History tabs, known conditions, medications, investigations | **ABSENT** (no data model) |
| AI panel tabs AI Summary / Recommendations / Mana AI | PARTIAL: tabs are *Note suggestions / Facts / Recommendations / Activity*; Mana is a separate card |
| "AI Clinical Summary (Draft)" sections and *Suggested Plan* tabs | **ABSENT** |
| Edit / Reject / Approve & Add to Note | REAL as Accept / Edit / Reject with recorded insertion |
| Patient Profile slide-over | ABSENT (a full page) |
| Fake or no-op controls | None found (no "coming soon", empty handlers); `DESIGN.md` states the rule |

**Consultation page today:** 710 lines; a one-column layout below 1280 px, two columns from 1280, three from 1536, inside a `max-w-7xl` main; the AI assistant, Mana, photographs and auscultation are in a side panel; thermal is not on the page. Autosave (1.2 s debounce, 5 s retry, serial chain, version check, read-only on conflict) and the existing accessible names, regions and test ids are covered by `doctor-workflow`, `ai-assistant`, `ai-clinical`, `mana`, `record-lifecycle` and `entry` e2e specs; a redesign must keep them.

**Design system available:** colour, radius, shadow, spacing and type tokens; Button, Card, StatCard, Badge, Alert, Dialog, forms, SegmentedControl, Table, Toast, initials avatar; clinical PatientBanner, VitalsInline, Timeline, AppointmentTable. **Missing:** a shared Tabs component (one inline `tablist` in the AI panel), a drawer/slide-over, an overflow menu, photo avatars, charts or sparklines (one private sparkline in the portal), a waveform, a bundled font, dark theme.

## 5. Synthetic data

`npm run db:seed`: one facility, three departments, four staff (admin, two doctors, one nurse), all marked "(synthetic)" in their names. `demo:seed` adds **one** patient per run: six consents, one allergy, one signed earlier consultation (type 2 diabetes, metformin) and today's visit with five vitals. Not tested.

Absent against the target dataset: more than one patient or nurse, an orthopaedic doctor, appointments, any portal account, structured histories, investigations, medication history, device readings, thermal studies in the database, stethoscope recordings, transcripts (a 13-line text file is pasted by hand), AI outputs. "Synthetic" is marked only in names and by a global banner; `patients`, `visits` and `encounters` have no origin column (`data_origin` exists on AI jobs, images, thermal captures, auscultation recordings and Mana questions).

## 6. Safety and governance documents

Present: ADRs 0001-0011, `AUDIT.md` (a Phase 0 snapshot, partly out of date), `DEVICES.md`, `PRODUCT_SPEC.md`. **Absent:** intended use and system boundaries, a hazard analysis and risk register, an AI limitations and model-version record, dataset provenance, an evaluation record, a data-retention statement beyond the audio setting, and a usability plan. These are planned in [DOCTOR_APP_PLAN.md](DOCTOR_APP_PLAN.md).

## 7. Blockers for the first complete consultation, in order

1. **No longitudinal history model** (conditions, medicines, investigations): the past-history panel cannot show real data.
2. **The consultation screen has no patient context** beyond names (no allergy severity, conditions, medicines, results).
3. **No local AI**: every language-model step needs a hosted key; speech defaults to a hosted service; nothing has been run against a real model.
4. **Transcript has no timing, speaker or language;** extraction lacks patient concerns and first-class duration and investigations.
5. **No consultation summary** capability or screen.
6. **No reading-state model** for vitals; device readings can miss the consultation.
7. **The UI is not the reference workstation** (layout, header, tabs, drawer, waveform).
8. **Synthetic data is too thin** to demonstrate or test any of the above.
