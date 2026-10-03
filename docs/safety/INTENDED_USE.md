# Intended use and system boundary

**Status: draft for the prototype, 3 Oct 2026.** ADAXAI is an MVP prototype. It is **not production-ready, not a medical device, not clinically validated, and not claimed to comply with any law or standard**. All data in it is synthetic. This document states what the software is for so that risks can be assessed against something; it is a working engineering record, not a regulatory submission.

## Intended use (prototype)

Support a **licensed clinician** in an outpatient consultation by:
- showing the clinician the patient's recorded history, allergies, medicines, results, vital signs and earlier consultations;
- capturing the consultation as text (typed, or transcribed from audio) and proposing, **as drafts for the clinician to accept, edit or reject**, important points, a note summary and suggestions;
- recording the clinician's decisions in a signed, tamper-evident, auditable record, and making permitted parts of it available to the patient.

## Intended users

| User | Use |
| --- | --- |
| Doctor | Consults, reviews drafts, decides, signs |
| Nurse | Registers and checks in patients, records vital signs; reads, does not edit, consultations |
| Patient | Reads their own signed records and messages |
| Administrator | Manages accounts and devices; reads operational counts and the audit log; cannot read patients' clinical records |

## What the software does not do

- It does **not diagnose, prescribe, triage or decide**. Every AI output is a draft that a clinician must accept, edit or reject; nothing AI-generated is signed, prescribed or added to a record without a clinician's action.
- It does **not** provide a validated measurement. Device readings are stored as *unverified*; blood pressure is entered by a person; thermal flags are rule-based, not validated, and are not a diagnosis.
- It is **not for emergencies, for unsupervised patient use, or for any use on real patients** until clinical, legal, regulatory and security validation has been done.

## System boundary

Inside: the web applications (doctor, nurse, patient, admin), the API, the PostgreSQL database, the thermal-processing service, locally hosted AI model servers (planned, [ADR 0012](../adr/0012-local-first-ai-hosted-providers-opt-in.md)), file storage on the same machine.

Outside, and not controlled by ADAXAI: the operating system and network, the clinician's judgement, any wearable or stethoscope hardware (none is integrated today), and any hosted AI provider (off by default; if selected, patient-derived text or audio leaves the machine under the provider's terms).

## Principles that follow from the intended use

1. **Human oversight:** the clinician is always the decision-maker; the interface shows what is draft, what is confirmed, what is measured and what is model output.
2. **Evidence:** AI statements cite their source or say the record does not establish the answer.
3. **Least privilege and default deny:** roles, facility scope and patient consent are enforced by the server.
4. **Traceability:** who did what, when, with which model version, is recorded in an append-only, hash-linked audit log.
5. **Honesty about uncertainty:** unavailable, stale, simulated and unverified states are shown, never hidden.
