# ADR 0004: PostgreSQL is the source of truth; YAML holds configuration only; secrets stay in the environment

- **Status:** accepted. This records the decision already in force since the PostgreSQL spike.
- **Date:** 2 Oct 2026

## Decision

**PostgreSQL holds all clinical, operational and audit data.**
- Schema changes are SQL migrations with checksums; an applied migration is never edited.
- Append-only and immutability rules are database triggers, not only API rules:
  - audit events;
  - signed encounters;
  - amendments;
  - AI evidence and review actions;
  - Mana answers;
  - note insertions;
  - device assignments.

**`config/*.yaml` holds non-secret configuration only:**
- AI feature switches and models;
- Mana context limits;
- upload limits;
- retention;
- illustrative safety groups;
- routing rules;
- *(planned)* alert rules.

**Validation and reload:**
- Strict Zod schemas validate the configuration at start-up; an invalid file stops the API with the setting named.
- Routing rules are re-read at runtime.

**Secrets live only in `.env`, which is git-ignored:**
- database passwords;
- AI keys;
- the seed password.

They are never printed, logged or sent to the client.

## Consequences

Destructive database operations (restore, retention, orphan deletion, test reset) need explicit target checks and backups. The audit lists the remaining gaps.
