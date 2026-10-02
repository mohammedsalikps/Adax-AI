# ADAXAI demonstration: AI-assisted consultation (synthetic data)

Everything in this demonstration is synthetic. The patient, staff and transcript are fictional.
ADAXAI is not production-ready and none of its AI output is clinically validated.

## Before you start

```bash
npm run setup        # once
npm run dev          # PostgreSQL, API, web, thermal service
npm run demo:seed    # adds "Ravi Demo-Synthetic" with history and a visit ready for the doctor
```

Staff accounts (password = `SEED_DEMO_PASSWORD` in `.env`): `dr.meera` (doctor, General
Medicine), `nurse.anil` (nurse), `admin`.

Two ways to run it:

- **Without AI keys** (the default): shows the provider-unavailable state, the deterministic
  safety rules and routing, and the whole review workflow for rule-based output.
- **With keys** in `.env` (`ANTHROPIC_API_KEY`, optionally `AI_STT_API_KEY`), then restart
  `npm run dev`: also drafting, extraction, AI recommendations and image description. Check
  your provider agreement first: the transcript and parts of the record are sent to the provider
  (identifiers replaced).

## Steps

| # | Action | What to point out |
| --- | --- | --- |
| 1 | Sign in as **nurse.anil** → OPD queue. Find *Ravi Demo-Synthetic* (ready). Open **Routing** → **Suggest routing** | Deterministic rules (`routing-rules-v1`): the red flag “chest pain” with the configured instruction, *urgent for staff review*, the reason for each part. **Apply** or **Override** (reason required) |
| 2 | Sign out; sign in as **dr.meera** → **Start consultation** | The encounter opens with today's vitals (temperature 38.4 °C) and the patient banner shows the penicillin allergy |
| 3 | **Timeline** in the side panel (also on the patient's record under Patients) | The earlier signed consultation (type 2 diabetes, metformin) and the penicillin allergy in the banner. This is the history the assistant compares against |
| 4 | In the **AI consultation assistant**: consent is already recorded (ongoing, current wording). Paste the contents of [`demo/consultation-transcript.txt`](../demo/consultation-transcript.txt) → **Save transcript** | Numbered segments S1…S13 with speakers |
| 5 | **Generate draft** and **Extract facts** (needs `ANTHROPIC_API_KEY`) | Without a key: “AI drafting … unavailable (ANTHROPIC_API_KEY is not set)”, and buttons disabled. **No placeholder output** (requirement 11) |
| 6 | **Facts** tab (with a key) | Each fact: category, *Patient said / Clinician said*, sources (open “Sources”) linking to S-lines. “No, no allergies” is flagged **Conflicts with the existing record** with the penicillin allergy shown as *Existing record*. Metformin is supported by the earlier prescription. Uncertain or unsourced facts are flagged and cannot be accepted without the checkbox |
| 7 | Prescription: **Add medicine** → *Amoxicillin*. Then **Get recommendations** | **Rule-based check** (works without a key): “Check Amoxicillin: the patient has a recorded allergy to Penicillin” (the configured, illustrative penicillin group), the red flag “chest pain” with its instruction (the negated “no shortness of breath” is not flagged) and the raised temperature. With a key, after **Extract facts**, also a clarification for “no allergies” vs the recorded penicillin allergy, and **AI suggestions**, each with *Why*, cited record items (A1, D1, M1, V…) and transcript lines, *Not found in the data*, and model + prompt version |
| 8 | Review: **Accept**, **Edit**, **Reject** or **Defer** items; for accepted facts or suggestions use **Add to …** | Nothing changes the note until you add it; accepting a recommendation never changes the prescription |
| 9 | Fill the note, diagnosis, remove or keep the prescription → **Review and sign** | The signed record contains only what the doctor accepted or typed; the existing signing workflow (attestation, hash, immutability) is unchanged |
| 10 | **Activity** tab | Jobs with provider, model, prompt/rules version, latency, data origin (*Synthetic data*), retry for failed jobs, every review decision, and the audit trail |
| 11 | Provider failure (optional, with a key): set an invalid key, restart, **Extract facts** | The job is recorded as failed with a safe message; **Retry** in Activity after fixing the key. Retries do not duplicate results |
| 12 | Isolation: sign in as **admin** → **AI operations** | Counts only: providers, jobs, review outcomes per model/prompt version, *Includes synthetic*. No patient data. Admins cannot open consultations or AI artifacts (API returns 403); patients cannot either |

Also available: **Clinical photographs** on the consultation (consents are seeded). Upload a
JPEG/PNG/WebP, optionally **Describe with AI** (key needed). The description is labelled
*AI-generated · unverified* and can be added to Examination only after review. **Doctor > AI
review** lists rejected and edited AI output.

## What the automated tests cover

`npm test` runs the API tests (real PostgreSQL), the Python service tests and the Playwright
suite (desktop and mobile, axe WCAG 2.2 AA). For this workflow see
`apps/api/test/ai-clinical.test.ts` (persistence, evidence links, record comparison,
confirmation gates, immutability, failure and retry, idempotency, live chunks, consent version,
authorisation and isolation, oversight, retention), `apps/api/test/routing.test.ts`,
`apps/api/test/images.test.ts`, `e2e/ai-clinical.spec.ts` and `e2e/routing.spec.ts`. AI output in
tests comes from test doubles or the test-only mock server `e2e/mock-anthropic.mjs`, never shown
as real output.
