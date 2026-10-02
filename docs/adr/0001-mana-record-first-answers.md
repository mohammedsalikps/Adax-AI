# ADR 0001: Mana answers are record-first; AI summaries are optional, labelled and citation-checked

- **Status:** accepted
- **Date:** 2 Oct 2026

## Context

Doctors ask questions such as "what was prescribed last time" or "what changed since the last visit". The answer has to be traceable to the record. Language models can misstate or invent. In many installations no AI provider is configured, and some patients do not consent to external processing.

## Decision

Each Mana answer has two layers.

1. **Record answer.** Explicit, versioned rules (`mana-record-v1`) read the patient's record:
   - Every statement cites record items by reference. Each reference carries its source type, id, consultation, date, field, status and provenance.
   - The rules also state what is absent, and flag conflicts, possibly outdated records and amended records.
   - This layer needs no provider and no extra consent; it is a view of the record.
2. **AI summary.** Optional, and runs only when a provider is configured and an `ai_record_assistant` consent is current:
   - The model receives only the record items relevant to the question, without identifiers.
   - The server keeps only citations that exist among the items sent. Statements without a valid citation are kept but flagged as unsupported.
   - The summary is stored with job, run, provider, model and prompt version, and always displayed apart from the record answer, labelled AI-generated.

Free-text questions are classified by rules. A suggested question carries its intent. A question that matches no intent becomes a record search, with no generated paraphrase.

## Consequences

- Mana is useful, and honest about its limits, with no AI key. The demo works offline.
- Each rule change needs a new rules version. Each prompt change needs a new prompt id; this is enforced by checksum.
- Rule coverage is narrower than a free-form model. Questions outside the intents fall back to search, which can only quote the record.
