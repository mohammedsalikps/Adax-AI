# ADR 0006: Consent lifecycle, enforcement at the API boundary, and immediate withdrawal effects

- **Status:** accepted
- **Date:** 3 Oct 2026

## Context

The audit found several problems with consent:
- **Nondeterministic lookup.** The lookup used `findFirst` with no ordering, so version checks depended on row order.
- **Per-row withdrawal.** Withdrawal ended one row; a consultation-only grant of the same purpose stayed active.
- **Withdrawal had no effects.** Withdrawing portal access did not end portal access. Withdrawing device consent left device assignments open. Withdrawing research consent did not affect existing datasets.
- **Renewal was blocked.** A grant under an earlier wording could not be renewed.
- **Missing audit.** Refusals were not audited.

## Decision

### Model (migration `0017`)

A consent row records:
- purpose (type) and scope (ongoing / one consultation);
- wording version, method, and who recorded it, when.

It ends **once**:
- **withdrawn:** who, when, an optional reason, and the channel (`staff` or `patient_portal`); or
- **superseded:** by a renewal under the current wording.

Database rules:
- A trigger forbids deleting, rewriting or re-granting a row.
- A partial unique index allows one active ongoing grant per patient and purpose.
- The withdrawal reason stays on the consent record. The audit log only notes that a reason was given.

### States

Computed in one place (`apps/api/src/consents/service.ts`) and shown in every app:

| State | Meaning |
| --- | --- |
| `granted` | current wording |
| `outdated` | granted under an earlier wording |
| `withdrawn` | |
| `not_recorded` | |

The portal shows the wording the patient actually agreed to. Earlier wordings are kept in the contracts, taken from git history.

### Enforcement

`requireConsent()` is called at the API boundary of every workflow that has a consent purpose:

| Purpose | Workflows |
| --- | --- |
| `ai_recording` | recording, transcripts, AI drafting, extraction, recommendations |
| `ai_record_assistant` | Mana AI summaries, re-checked on every retry |
| `clinical_photography` | photographs |
| `ai_image_analysis` | AI description of photographs |
| `thermal_imaging` | thermal images |
| `device_monitoring` | device assignment, stethoscope recordings, ingestion |
| `portal_access` | portal activation and reset, sign-in, every portal request |
| `research_use` | research dataset export, download and evaluation |

Behaviour:
- **Refusal:** a 409 with the code `consent_required`, `consent_withdrawn` or `consent_outdated`, audited as `consent.blocked`.
- **Rule-based safety check:** it reads the transcript only while recording consent is in place; otherwise it checks the record alone.

### Withdrawal

Withdrawal ends every active grant of the purpose (ongoing and consultation-only) in one transaction, with its effects:

| Purpose | Effect |
| --- | --- |
| `portal_access` | The portal account is switched off, its sessions end, unused codes are revoked. |
| `device_monitoring` | Open device assignments end. |
| `research_use` | Existing exports that include the patient can no longer be downloaded or evaluated. |
| `ai_recording` | Recording stops server-side, and the browser recorder stops on the first refused chunk. |

Patients can withdraw their own consents in the portal. Granting stays with staff, who read the wording to the patient.

### Device readings

A reading is filed to the patient the device was assigned to **when it was measured**, and only if that patient's current consent was already in place at that time. Readings measured before the assignment started, or before the current consent, are refused and audited.

## Not decided here (needs qualified review)

**What "Care records" (`data_processing`) consent means legally.** Enforcing it would block registration and treatment, so it is recorded and shown, but not enforced. Whether care requires it, or relies on another lawful basis, is a legal decision; see STATUS.md "External needs".

## Consequences

- Consent behaviour is deterministic and tested: `apps/api/test/consents.test.ts`, `access.test.ts`, `devices.test.ts`, `thermal-data.test.ts`, `e2e/consent.spec.ts`.
- Bumping a wording version makes affected grants `outdated`. Features that need the current wording then ask for renewal. Portal access accepts an earlier wording, so patients are not locked out by a wording change.
