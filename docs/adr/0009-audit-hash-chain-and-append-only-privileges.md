# ADR 0009: Audit-log hash chain, append-only privileges, and a database identity guard for tests

- **Status:** accepted
- **Date:** 3 Oct 2026

## Context

**The audit log.** The log was append-only by trigger (migration 0003), but:
- the application role still held UPDATE and DELETE on it. Those privileges also allowed `LOCK TABLE … ACCESS EXCLUSIVE`;
- a change made with the triggers bypassed (by a superuser) left no trace;
- nothing tied events together. A removed, altered or reordered event was undetectable.

**The test helpers.** The test helpers and `db.mjs reset` empty a database as the superuser, with triggers disabled. Their only protection was the configured name. If `DB_TEST_NAME` or `DB_E2E_NAME` equalled `DB_NAME`, or if `.env` and the shell disagreed, a test run could empty the development database.

## Decision

### A hash chain written by the database

**What each event gets.** A `BEFORE INSERT` trigger on `audit_events` (migration 0019) sets:
- `chain_seq`: the next number;
- `prev_hash`: the previous event's `row_hash`, or 64 zeros for the first;
- `row_hash`: the SHA-256 of the event's canonical text;
- `chain_version` = 1;
- `occurred_at` = `now()`, the database clock. Callers cannot backdate events.

**The canonical text.** It is the jsonb array below, as PostgreSQL prints it:

```
[chain_version, chain_seq, prev_hash, id, occurred_at (UTC, microseconds),
 actor_user_id, actor_role, action, outcome, entity_type, entity_id,
 patient_id, request_id, ip, user_agent, details, facility_id]
```

**Ordering and concurrency.**
- Appends are serialised by a transaction-scoped advisory lock (`pg_advisory_xact_lock(4206943, 1)`). The chain therefore holds committed events only, in commit order.
- A rolled-back write leaves no gap.
- Writes under any isolation level other than READ COMMITTED are refused (`AX001`), because the head they read could be stale.
- Ordering never relies on `id`. Identity values have rollback gaps and can be supplied by the caller.

**Existing events are not rewritten.** Migration 0019 appends one `audit.chain_start` event as the first link. It records:
- the number of earlier events;
- the last earlier id;
- a SHA-256 digest of their canonical texts, in id order.

That is the documented boundary.

### Verification, independent of the trigger

`verifyAuditChain` (in `audit/chain.ts`) rebuilds every canonical text from the column values. It does not call the database function, so a replaced trigger function is caught as well. It reports:
- **altered:** a hash does not match;
- **gap:** a number is missing (a removed event);
- **broken_link:** events were reordered or inserted;
- **unchained_event:** written with the trigger bypassed;
- **legacy_changed:** the earlier events no longer match their digest;
- **unsupported_version.** Gaps and links are still checked for such events. Versions never decrease along the chain, so an older version after a newer one is reported as altered.
- The overall result is `unsupported_version` only when nothing else is wrong, counted beyond the 20 problems listed.

The check is available in two places:
- **Admin:** `GET /api/admin/audit-integrity`, audited. It returns counts, sequence numbers and hashes only, never event content.
- **Command line:** `npm run audit:verify`. It is read-only, runs as the application role, and prints the head.

**Anchors.** The head (`seq:hash`) is meant to be recorded outside the system. Passing it back (`?anchorSeq=&anchorHash=`, or `--anchor`) detects two things a self-contained chain cannot show:
- removal of the newest events;
- a complete rewrite of the chain.

**Deadlocks.** The established rule continues: audit is the last statement of a transaction, and no code calls `audit(db)` while holding the chain lock. Otherwise a deadlock or a stall across connections becomes possible.

### Least privilege on append-only tables

`meta.append_only_tables` lists the append-only tables:
- `audit_events` and `encounter_amendments`;
- `note_insertions`;
- the two status-history tables;
- the AI evidence, review and evaluation tables;
- `clinical_images`;
- `auscultation_recordings` (added by migration 0020).

A test checks that every table with an append-only row trigger is in the list.

`meta.enforce_append_only(<app role>)` revokes UPDATE, DELETE and TRUNCATE on them. The migrator and `db:provision` apply it after their grants, so re-provisioning cannot restore those privileges.

### Databases say what they are for

**The identity marker.** `meta.database_identity` is a one-row table in each database, holding `development`, `test` or `e2e`.
- `db:migrate --target …` claims it. A database with another identity is refused before anything is applied.
- The command refuses unexpected or dangling options (exit 2), and the root `npm run db:migrate --` passes its options through. A dropped `--target` therefore never falls back to the development database.
- An unmarked database that already holds data is not claimed as disposable unless `--claim-existing` is given.

**Destructive steps refuse unless the names are unambiguous and the database identifies as expected.** That means all names are distinct, test and e2e names carry their suffixes, and the target is not `DB_NAME`. The guarded steps are:
- the test helpers' reset and raw SQL. These also require the test runner;
- `db.mjs reset`;
- `storage-orphans --delete`, which requires `development`.

**End-to-end runs.** The Playwright configuration resolves the database names the same way the scripts do (shell first, then `.env`). It stops before any server starts if the names are ambiguous, and it passes the resolved e2e name to every step.

No connection details or passwords are printed.

## Consequences and limits

- **Tamper evidence, not tamper proofing.** The chain has no key. Someone with the superuser password, which is in `.env` on the same machine, can rewrite the events and recompute every hash. Only an anchor kept outside the system reveals that. Keying the chain (an HMAC with a key held elsewhere) or external timestamping are possible next steps.
- **Removing the newest events** is invisible without an anchor.
- **Serialised writes.** Every audited request waits for the chain lock until its transaction commits. That is acceptable for this single-machine MVP, but not measured under load.
- **Tests bypass triggers by design.** The test reset uses `session_replication_role = replica`, which bypasses all triggers. That is why the guard above exists.
- **Restoring a backup** rolls the log back to the backup point. An anchor recorded after the backup will report it, which is intended.
