# ADR 0003: A separate consent for Mana AI record summaries

- **Status:** accepted
- **Date:** 2 Oct 2026

## Context

The existing `ai_recording` consent (wording `2026-10-v2`) covers two things: recording the consultation, and processing that recording with parts of the record. Answering a doctor's question about the record, outside any recording, is a different purpose. Stretching the old wording to cover it would not be informed consent.

## Decision

The new consent type is `ai_record_assistant`, wording `2026-10-v1`:

> When the doctor asks a question about the patient's record, send the relevant parts of the record (without name or contact details) to an external AI service that writes a summary with references, for the doctor to check. Answers read directly from the record do not need this consent.

- **What it gates:** Mana's AI summary, and only that. It must be the current version.
- **What it does not gate:** record answers. They are part of the doctor's normal access to the record, and they are audited.
- **When it is missing:** the answer states "consent needed" and nothing is sent.

## Consequences

- Staff record one more consent type, in the same place and with the same audit as the others.
- Existing consents keep their meaning. No existing patient is moved silently into a new purpose.
- Migration `0015` adds the enum value. A PostgreSQL enum value cannot be removed again, which is acceptable because the change is additive.
