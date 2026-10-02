-- Slice 3: record lifecycle and integrity. Additive: new columns are
-- nullable, new tables start with a baseline, no existing row is rewritten.
CREATE TABLE "encounter_status_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "encounter_status_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"encounter_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"from_status" "encounter_status",
	"to_status" "encounter_status" NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_status_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "visit_status_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"visit_id" uuid NOT NULL,
	"from_status" "visit_status",
	"to_status" "visit_status" NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "encounters" DROP CONSTRAINT "encounters_visit_id_unique";--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "chain_seq" bigint;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "row_hash" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "chain_version" smallint;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD COLUMN "hash_scheme" text;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "hash_scheme" text;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "discarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "discarded_by" uuid;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "discard_reason" text;--> statement-breakpoint
ALTER TABLE "encounter_status_events" ADD CONSTRAINT "encounter_status_events_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_status_events" ADD CONSTRAINT "encounter_status_events_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_status_events" ADD CONSTRAINT "encounter_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_status_events" ADD CONSTRAINT "visit_status_events_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_status_events" ADD CONSTRAINT "visit_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encounter_status_events_encounter_idx" ON "encounter_status_events" USING btree ("encounter_id","id");--> statement-breakpoint
CREATE INDEX "visit_status_events_visit_idx" ON "visit_status_events" USING btree ("visit_id","id");--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_discarded_by_users_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_chain_seq_uq" ON "audit_events" USING btree ("chain_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "amendments_encounter_seq_uq" ON "encounter_amendments" USING btree ("encounter_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_one_active_per_visit_uq" ON "encounters" USING btree ("visit_id") WHERE status <> 'discarded';--> statement-breakpoint
CREATE INDEX "encounters_visit_idx" ON "encounters" USING btree ("visit_id");--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_signed_complete" CHECK (status <> 'signed' or (signed_at is not null and signed_snapshot is not null and content_hash is not null));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_discarded_complete" CHECK (status <> 'discarded' or (discarded_at is not null and discarded_by is not null and length(btrim(discard_reason)) > 0));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_hash_scheme_format" CHECK (hash_scheme is null or hash_scheme ~ '^adaxai[.]encounter[.]v[0-9]+$');
--> statement-breakpoint
-- ===========================================================================
-- Record lifecycle and integrity (slice 3). Everything below is additive:
-- no existing row is rewritten. See docs/adr/0008 and docs/adr/0009.
-- ===========================================================================

-- Who changed a status and why. The API sets these per transaction with
-- set_config('adaxai.actor_id' | 'adaxai.source' | 'adaxai.reason', value, true).
-- Status changes by any role other than a superuser must name the acting user.
CREATE FUNCTION lifecycle_setting(key text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('adaxai.' || key, true), '') $$;
--> statement-breakpoint
CREATE FUNCTION lifecycle_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  actor text := lifecycle_setting('actor_id');
BEGIN
  IF actor IS NULL AND NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'status changes must name the acting user (adaxai.actor_id)' USING ERRCODE = 'AX002';
  END IF;
  RETURN actor::uuid;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. Visit state machine, enforced in the database.
--    Manual moves (queue): waiting -> in_triage | ready | cancelled | no_show;
--    in_triage -> ready | waiting | cancelled; ready -> in_triage | cancelled | no_show.
--    Consultation moves: an open visit -> in_consultation (needs an unsigned
--    consultation); in_consultation -> completed (needs a signed one);
--    in_consultation -> ready (only when no unsigned consultation remains,
--    i.e. after a discard). Closed visits never change status, a visit with an
--    unsigned consultation cannot be cancelled or marked as no-show, and a
--    cancellation needs a reason. Mirrors VISIT_TRANSITIONS in
--    packages/contracts/src/visits.ts (a test checks they agree).
-- ---------------------------------------------------------------------------
CREATE FUNCTION visit_status_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  f text;
  t text := NEW.status::text;
  draft boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM lifecycle_actor();
    IF t <> 'waiting' THEN
      RAISE EXCEPTION 'a visit starts as waiting, not %', t USING ERRCODE = 'AX003';
    END IF;
    RETURN NEW;
  END IF;
  f := OLD.status::text;
  IF f = t THEN
    RETURN NEW;
  END IF;
  PERFORM lifecycle_actor();
  IF f IN ('completed', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION 'visit % is closed (%) and cannot move to %', OLD.id, f, t USING ERRCODE = 'AX003';
  END IF;
  draft := EXISTS (SELECT 1 FROM public.encounters e WHERE e.visit_id = NEW.id AND e.status = 'in_progress');
  IF t IN ('cancelled', 'no_show') AND draft THEN
    RAISE EXCEPTION 'visit % has an unsigned consultation; sign or discard it first', OLD.id USING ERRCODE = 'AX004';
  END IF;
  IF t = 'cancelled' AND length(btrim(coalesce(NEW.status_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'cancelling a visit needs a reason' USING ERRCODE = 'AX003';
  END IF;
  IF NOT (
       (f = 'waiting' AND t IN ('in_triage', 'ready', 'cancelled', 'no_show'))
    OR (f = 'in_triage' AND t IN ('ready', 'waiting', 'cancelled'))
    OR (f = 'ready' AND t IN ('in_triage', 'cancelled', 'no_show'))
    OR (f IN ('waiting', 'in_triage', 'ready') AND t = 'in_consultation' AND draft)
    OR (f = 'in_consultation' AND t = 'completed'
        AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.visit_id = NEW.id AND e.status = 'signed'))
    OR (f = 'in_consultation' AND t = 'ready' AND NOT draft)
  ) THEN
    RAISE EXCEPTION 'visit % cannot move from % to %', OLD.id, f, t USING ERRCODE = 'AX003';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER visits_status_guard BEFORE INSERT OR UPDATE OF status ON visits
  FOR EACH ROW EXECUTE FUNCTION visit_status_guard();
--> statement-breakpoint
CREATE FUNCTION visit_status_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.visit_status_events (visit_id, from_status, to_status, source, reason, actor_user_id)
    VALUES (NEW.id, NULL, NEW.status, coalesce(lifecycle_setting('source'), 'check_in'), NULL, lifecycle_actor());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.visit_status_events (visit_id, from_status, to_status, source, reason, actor_user_id)
    VALUES (NEW.id, OLD.status, NEW.status, coalesce(lifecycle_setting('source'), 'unspecified'), lifecycle_setting('reason'), lifecycle_actor());
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER visits_status_history AFTER INSERT OR UPDATE OF status ON visits
  FOR EACH ROW EXECUTE FUNCTION visit_status_record();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Consultation (encounter) state machine: in_progress -> signed | discarded.
--    Signed and discarded consultations are immutable and never deleted; a
--    draft keeps its patient, visit, facility and author; a new consultation
--    starts as an empty draft on a visit of the same patient and facility; a
--    new signature must name its hash scheme.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION encounter_reject_if_signed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM lifecycle_actor();
    IF NEW.status <> 'in_progress' OR NEW.signed_at IS NOT NULL OR NEW.signed_snapshot IS NOT NULL OR NEW.content_hash IS NOT NULL
       OR NEW.discarded_at IS NOT NULL OR NEW.hash_scheme IS NOT NULL THEN
      RAISE EXCEPTION 'a consultation starts as an unsigned draft' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.id = NEW.visit_id AND v.patient_id = NEW.patient_id AND v.facility_id = NEW.facility_id) THEN
      RAISE EXCEPTION 'a consultation must belong to a visit of the same patient and facility' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'encounter % is signed and cannot be changed; add an amendment instead', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'discarded' THEN
    RAISE EXCEPTION 'encounter % was discarded and cannot be changed', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consultations are never deleted; discard the draft instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.facility_id IS DISTINCT FROM OLD.facility_id OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    RAISE EXCEPTION 'a consultation keeps its patient, visit, facility and author' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> OLD.status THEN
    PERFORM lifecycle_actor();
    IF NEW.status = 'signed' AND NEW.hash_scheme IS NULL THEN
      RAISE EXCEPTION 'a signature must name its hash scheme' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.status = 'in_progress' AND (NEW.signed_at IS NOT NULL OR NEW.signed_snapshot IS NOT NULL OR NEW.content_hash IS NOT NULL
     OR NEW.hash_scheme IS NOT NULL OR NEW.discarded_at IS NOT NULL OR NEW.discarded_by IS NOT NULL OR NEW.discard_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'an unsigned draft has no signature or discard details' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER encounters_guard_insert BEFORE INSERT ON encounters
  FOR EACH ROW EXECUTE FUNCTION encounter_reject_if_signed();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION encounter_child_reject_if_signed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  parent_status encounter_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO parent_status FROM public.encounters WHERE id = OLD.encounter_id;
    IF parent_status IN ('signed', 'discarded') THEN
      RAISE EXCEPTION 'encounter % is %; its % cannot be changed', OLD.encounter_id, parent_status, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO parent_status FROM public.encounters WHERE id = NEW.encounter_id;
    IF parent_status IN ('signed', 'discarded') THEN
      RAISE EXCEPTION 'encounter % is %; its % cannot be changed', NEW.encounter_id, parent_status, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- AI text is recorded into a note only while the note is an unsigned draft.
CREATE TRIGGER note_insertions_only_into_drafts BEFORE INSERT ON note_insertions
  FOR EACH ROW EXECUTE FUNCTION encounter_child_reject_if_signed();
--> statement-breakpoint
CREATE FUNCTION encounter_status_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.encounter_status_events (encounter_id, visit_id, from_status, to_status, source, reason, actor_user_id)
    VALUES (NEW.id, NEW.visit_id, NULL, NEW.status, coalesce(lifecycle_setting('source'), 'consultation_start'), NULL, lifecycle_actor());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.encounter_status_events (encounter_id, visit_id, from_status, to_status, source, reason, actor_user_id)
    VALUES (NEW.id, NEW.visit_id, OLD.status, NEW.status, coalesce(lifecycle_setting('source'), 'unspecified'),
            CASE WHEN NEW.status = 'discarded' THEN NEW.discard_reason ELSE lifecycle_setting('reason') END, lifecycle_actor());
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER encounters_status_history AFTER INSERT OR UPDATE OF status ON encounters
  FOR EACH ROW EXECUTE FUNCTION encounter_status_record();
--> statement-breakpoint

-- Status history starts here: one baseline event per existing visit and
-- consultation (actor unknown), so every history has a clear starting point.
INSERT INTO visit_status_events (visit_id, from_status, to_status, source, reason, actor_user_id, changed_at)
SELECT id, NULL, status, 'history_start', NULL, NULL, status_changed_at FROM visits;
--> statement-breakpoint
INSERT INTO encounter_status_events (encounter_id, visit_id, from_status, to_status, source, reason, actor_user_id, changed_at)
SELECT id, visit_id, NULL, status, 'history_start', NULL, NULL, coalesce(signed_at, updated_at) FROM encounters;
--> statement-breakpoint
CREATE TRIGGER visit_status_events_append_only BEFORE UPDATE OR DELETE ON visit_status_events
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER visit_status_events_no_truncate BEFORE TRUNCATE ON visit_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER encounter_status_events_append_only BEFORE UPDATE OR DELETE ON encounter_status_events
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER encounter_status_events_no_truncate BEFORE TRUNCATE ON encounter_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Amendments: only for signed records, timestamped by the database, and
--    linked into a per-record SHA-256 chain that starts at the signed
--    record's content_hash. Canonical text (scheme adaxai.amendment.v1):
--    jsonb array [scheme, encounter_id, seq, prev_hash, author_id,
--    created_at (UTC, microseconds), reason, content] as text. The API
--    verifier rebuilds this text independently (encounters/verify.ts).
--    Amendments from before this migration keep NULL seq and hash.
-- ---------------------------------------------------------------------------
CREATE FUNCTION amendment_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  parent record;
  last_hash text;
  total integer;
BEGIN
  SELECT status, content_hash INTO parent FROM public.encounters WHERE id = NEW.encounter_id FOR UPDATE;
  IF parent.status IS DISTINCT FROM 'signed' THEN
    RAISE EXCEPTION 'amendments are added only to signed consultations' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO total FROM public.encounter_amendments WHERE encounter_id = NEW.encounter_id;
  SELECT a.content_hash INTO last_hash FROM public.encounter_amendments a
   WHERE a.encounter_id = NEW.encounter_id AND a.seq IS NOT NULL ORDER BY a.seq DESC LIMIT 1;
  NEW.created_at := now();
  NEW.seq := total + 1;
  NEW.prev_hash := coalesce(last_hash, parent.content_hash);
  NEW.hash_scheme := 'adaxai.amendment.v1';
  NEW.content_hash := encode(sha256(convert_to(jsonb_build_array(
    NEW.hash_scheme, NEW.encounter_id, NEW.seq, NEW.prev_hash, NEW.author_id,
    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), NEW.reason, NEW.content)::text, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER encounter_amendments_chain BEFORE INSERT ON encounter_amendments
  FOR EACH ROW EXECUTE FUNCTION amendment_chain();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Audit log hash chain (chain version 1). Every new event gets the next
--    chain_seq, the previous event's row_hash as prev_hash (64 zeros for the
--    first) and row_hash = SHA-256 of its canonical text: the jsonb array
--    [chain_version, chain_seq, prev_hash, id, occurred_at (UTC, microseconds),
--    actor_user_id, actor_role, action, outcome, entity_type, entity_id,
--    patient_id, request_id, ip, user_agent, details, facility_id] as text.
--    Appends are serialised by a transaction-scoped advisory lock, so the
--    chain holds committed events only, in commit order; occurred_at is the
--    database clock. The verifier (audit/chain.ts) rebuilds the canonical
--    text independently of this function. Events from before this migration
--    are not rewritten: the audit.chain_start event records their count, last
--    id and a SHA-256 digest of their canonical texts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION audit_event_canonical(e audit_events) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_array(e.chain_version, e.chain_seq, e.prev_hash, e.id,
    to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.actor_user_id, e.actor_role, e.action, e.outcome, e.entity_type, e.entity_id,
    e.patient_id, e.request_id, e.ip, e.user_agent, e.details, e.facility_id)::text
$$;
--> statement-breakpoint
CREATE FUNCTION audit_events_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  head_seq bigint;
  head_hash text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'audit events are written only under READ COMMITTED (the chain head must be current)' USING ERRCODE = 'AX001';
  END IF;
  PERFORM pg_advisory_xact_lock(4206943, 1);
  SELECT chain_seq, row_hash INTO head_seq, head_hash
    FROM public.audit_events WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
  NEW.occurred_at := now();
  NEW.chain_version := 1;
  NEW.chain_seq := coalesce(head_seq, 0) + 1;
  NEW.prev_hash := coalesce(head_hash, repeat('0', 64));
  NEW.row_hash := encode(sha256(convert_to(public.audit_event_canonical(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_hash_chain BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_chain();
--> statement-breakpoint
INSERT INTO audit_events (action, outcome, entity_type, details)
SELECT 'audit.chain_start', 'success', 'audit_log', jsonb_build_object(
  'chainVersion', 1,
  'legacyEvents', count(*),
  'legacyLastId', max(e.id),
  'legacyDigest', encode(sha256(convert_to(coalesce(string_agg(audit_event_canonical(e), E'\n' ORDER BY e.id), ''), 'UTF8')), 'hex'))
FROM audit_events e;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Privileges. Append-only tables are protected by triggers; in addition
--    the application role must not hold UPDATE, DELETE or TRUNCATE on them.
--    The migrator and `db:provision` apply meta.enforce_append_only(<app role>)
--    after granting, so re-provisioning cannot restore those privileges.
-- ---------------------------------------------------------------------------
CREATE TABLE meta.append_only_tables (table_name text PRIMARY KEY);
--> statement-breakpoint
INSERT INTO meta.append_only_tables (table_name) VALUES
  ('audit_events'), ('encounter_amendments'), ('note_insertions'), ('visit_status_events'), ('encounter_status_events'),
  ('transcript_segments'), ('ai_evidence'), ('ai_review_actions'), ('evaluation_runs'), ('dataset_memberships'), ('clinical_images');
--> statement-breakpoint
CREATE FUNCTION meta.enforce_append_only(app_role text) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  t text;
  n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RETURN 0;
  END IF;
  FOR t IN SELECT table_name FROM meta.append_only_tables ORDER BY 1 LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM %I', t, app_role);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
