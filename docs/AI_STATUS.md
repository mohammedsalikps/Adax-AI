# AI and device status: what is actually real

**Verified 3 Oct 2026 by reading the code (not the documents) and by the tests named below.** This page says what runs, what needs an external service or credential, what is only exercised by a test double, and what does not exist. It is deliberately conservative: an endpoint existing is not "working". Nothing here is a claim of clinical validity, diagnostic accuracy, regulatory approval or production readiness. The audit with line-level evidence is in [DOCTOR_APP_AUDIT.md](DOCTOR_APP_AUDIT.md); the target architecture is [ADR 0012](adr/0012-local-first-ai-hosted-providers-opt-in.md).

## Words used

| Word | Meaning |
| --- | --- |
| **Real** | Runs on this machine with no external service, and is covered by automated tests |
| **Needs a hosted provider** | The code is real but does nothing without a key for an external service (and then sends data there, after consent) |
| **Test-only** | Exercised only against a test double or a local mock of the external service; never run against the real thing, so its quality with a real model is **unknown** |
| **Simulated** | Stands in for something that does not exist yet, and is labelled so |
| **Unavailable** | Shown to the doctor as "not available" with the reason |
| **Absent** | Does not exist |

## The eight capabilities

| Capability | Status | What actually runs | Needs an external credential? | Tested how |
| --- | --- | --- | --- | --- |
| **A. Voice transcription** | **Partly real; speech-to-text needs a hosted provider** | Real: consent check, microphone capture in the browser (20-second chunks), audio upload and storage, and the **typed or pasted transcript** (no provider). Speech-to-text is one `fetch` to an OpenAI-compatible `/audio/transcriptions` endpoint, **enabled only by `AI_STT_API_KEY`** (default host `api.openai.com`). Without the key the audio is stored and the screen says so; live recording answers 503. The transcript has **no timestamps, no speaker identification, no language identification** | `AI_STT_API_KEY` (and the service's terms) | Adapter against a local mock of the endpoint (**test-only**); the e2e recording uses a fake microphone and is stored, never transcribed. No real speech server has ever answered successfully (two real attempts were rate-limited) |
| **B. Important-point extraction** | **Needs a hosted provider; test-only** | Extraction of facts (chief complaint, symptoms, history, allergies, medications, observations, assessment, follow-up) is an Anthropic call (`claude-opus-5-5` in `config/adaxai.yaml`) behind a schema. **Real and deterministic around it:** the review gates, source excerpts, flags (no source, wrong speaker, conflicts with the record) and the recorded insertion. *Patient concerns* are not a category; duration and investigations are not first-class | `ANTHROPIC_API_KEY` | Test doubles and a local mock of the Anthropic API. **Real-model quality is unknown** |
| **C. Patient-context retrieval** | **Real** | The history read model (`GET /api/patients/:id/history`: allergies, conditions, medicines, results, signed consultations, latest vitals), the context assembly for recommendations, and Mana's record reader are deterministic, facility-scoped and audited. All data is typed in by staff or comes from signed consultations (there is no laboratory or pharmacy feed). There is no vector or semantic retrieval | No | API and database tests; e2e |
| **D. AI summary** | **Partly present; the consultation summary is absent** | There are per-section note drafts (Anthropic) and Mana's optional summary of record items (Anthropic). A structured *consultation* summary (context, current visit, assessment, plan) **does not exist** (planned, V3). The **patient summary** on the consultation screen is composed from the record by fixed rules and labelled "not AI-generated" | `ANTHROPIC_API_KEY` for the drafts and Mana's summary | Test doubles (**test-only**) |
| **E. AI recommendations** | **Rules are real; the AI part needs a hosted provider and is test-only** | `safety-rules-v1` always runs and needs no provider (allergy and record conflicts, vital-sign and red-flag checks): **real**. An optional language-model step adds suggestions. The AI is contractually barred from drafting diagnoses or prescriptions | `ANTHROPIC_API_KEY` for the AI step | Rules: unit and API tests. AI step: **test-only** |
| **F. Mana AI** | **Partly real** | For **one patient at a time** a rules answer is always produced from the record, with a source for each statement and an explicit "not in the record" (regex intent detection; immutable stored answers; doctors only; consent for the AI summary). An optional language-model summary of selected record items is **test-only** and needs a key. **Absent:** any question across patients ("who visited two hours ago", "who is waiting"), a "previous consultation" intent, reading transcripts, extracted facts, the queue or appointments, and any local model | `ANTHROPIC_API_KEY` for the summary only | Rules: API and e2e tests. Summary: **test-only** |
| **G. Thermal analysis** | **Real measurement; no model** | FLIR radiometric images are decoded to a temperature matrix; regions give statistics and paired differences; fixed-threshold "experimental flags" (always marked not validated). **No trained model exists**; there is no image-quality or confidence output | No (a local Python service) | 32 pytest tests, API tests and one e2e, on public sample images only |
| **H. Device readings** | **API real; no hardware; no live state** | A token-authenticated gateway endpoint stores readings as *device, unverified*. **No device, gateway or simulator exists**, and there is no live, stale or disconnected state. This slice shows each vital sign with its time and source. Blood pressure is entered by a person | No | API tests. No e2e posts a reading |
| *Stethoscope* | **Upload only** | Audio files uploaded by staff and played back; **no direct connection, no analysis, no simulator** | No | API and e2e |

## What leaves this machine, and when

- With **nothing configured, nothing is sent.** The test configuration never carries provider keys, and tests never call a real provider.
- **This development machine's `.env` has both hosted keys set**, so the development app reports "AI drafting: available (claude-opus-5-5)" and "Speech-to-text: available (gpt-4o-transcribe)": consultation text (names, MRN and phone are replaced; the scrubbing is best-effort) and audio (which cannot be scrubbed) **would go to those two third parties**, after the patient's consent for that purpose is recorded. This is the opposite of the product direction and is a decision for the owner: remove the keys, or leave them knowing what they do.
- Each use is gated by a recorded consent (`ai_recording`, `ai_record_assistant`, `ai_image_analysis`) and audited with the model, prompt version and input and output hashes.
- **Planned (ADR 0012, not built):** a provider registry with a default of `none`, a **local, open-weight** model server on this machine for language and speech, and hosted providers only by explicit choice. Installing a runtime and weights is a download and needs the owner's approval. This machine has an RTX 2050 (4 GB), 15.7 GB of RAM and no local model runtime installed.

## Raw, extracted and confirmed

| Stage | Where | Rule |
| --- | --- | --- |
| **Raw transcript** | `transcript_segments` | Append-only; the speaker comes only from a typed "Doctor:" or "Patient:" prefix |
| **Extracted draft** | `clinical_facts`, `ai_draft_items`, recommendations | Always *pending*, always marked as AI, never part of the record |
| **Doctor-confirmed** | accepted or edited item, then a recorded insertion into the note | Only through `POST /encounters/:id/insertions`, with provenance; flagged items need an explicit confirmation; **nothing AI-produced is ever signed, prescribed or diagnosed without the doctor** |

A known looseness: accepting a *note-draft* item inserts it into the note draft in one click (a *facts* item needs a second click). The doctor still signs.

## What this slice (V1) changed here

Nothing in the AI itself. It added the deterministic patient context (C) and the patient summary, and it removed no safeguard. The AI panels are unchanged and keep saying plainly when a provider is not configured.
