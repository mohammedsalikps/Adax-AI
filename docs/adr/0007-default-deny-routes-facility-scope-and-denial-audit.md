# ADR 0007: Default-deny route declarations, facility scope, minimum-necessary views and audited refusals

- **Status:** accepted
- **Date:** 3 Oct 2026

## Context

The audit found several gaps:
- **Opt-in authorization.** Authorization was per route: a route that forgot its permission would be open to every signed-in role, patients included.
- **No facility boundaries for admins.** Admin routes ignored facility boundaries for users, the staff directory, the overview and the audit log.
- **Admins saw patient identities.** The device list showed which patients wear monitoring devices.
- **Nurses saw unreviewed AI output.** They received unreviewed AI photo descriptions.
- **Many refusals were not audited:** in-route 403s, cross-facility lookups, portal record probes, device ingestion rejections.
- **Sign-in had no throttling** beyond a racy lockout.
- **Logs leaked search terms.** Request logs carried patient search terms.

## Decision

### Default deny at start-up

Every `/api` route must declare one of:
- `public` (5 routes);
- `permission`;
- `anySession` (3 routes: me, logout, change password).

A route that declares none **stops the API from starting**. The plugin keeps a route inventory. Tests check that:
- the public and any-session sets are exactly the expected ones;
- every private route answers 401 without a session;
- every role is refused (403, audited) every route whose permission it lacks.

The test enumerates over 150 role and route pairs.

### Facility scope

Admin routes are limited to the caller's facility:
- user list, edit and password reset;
- staff directory and overview counts;
- audit search.

For audit search: audit rows now carry `facility_id`. Older and anonymous rows are matched through their actor or patient, and the append-only log is not rewritten. The last-admin guard counts per facility, under a lock.

### Minimum necessary

- **Device list.** Admins see that a device is in use, not by whom; the list read is audited with the patient ids it disclosed.
- **AI photo descriptions.** Non-doctors see only reviewed ones.
- **Amendments.** Only the doctor who signed a consultation may amend it. This is a conservative default, to be confirmed by the clinical owner.
- **Audit details.** AI job audit details carry counts and flags only, never model free text.

### Every refusal leaves a trace

The error handler audits in-route 403s (wrong doctor, CSRF), and 404s for patients or consultations outside the caller's facility (reason `other_facility`), unless the refusal was already audited where it happened.

Also audited:
- portal record probes;
- device ingestion rejections;
- the patients disclosed by bulk reads (search, queue, thermal list, review outcomes, device list).

### Sign-in

- **Lockout without a race.** A failed-attempt slot is reserved atomically BEFORE the password is checked. Even a burst of concurrent guesses gets at most five checks per 15-minute lockout, and a locked answer never depends on whether the password was right.
- **The same rules for every username**, existing (active or not) or unknown, so the answers reveal no accounts or MRNs. Unknown usernames are never stored in the audit log.
- **Password change.** Wrong current passwords count towards the same lockout; at the limit every session ends.
- **Rate limits (in memory)** per address, account, user and device token, set in `config/adaxai.yaml` → `security.rateLimits`. They answer 429 with `Retry-After`; the first refusal in each window is audited.
- **CSRF refusals** happen before any session, so they are audited once per address and 5-minute window.

### Logs

Request logs record the path only, never the query string.

## Consequences

- A new route cannot be added without deciding who may call it.
- Several earlier tests were updated where the behaviour intentionally changed. Each change is listed in STATUS.md.
- The rate limiter is per process and resets on restart. It is a safeguard for this single-machine MVP, not a distributed control.
