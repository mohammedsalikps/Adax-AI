CREATE TABLE "consultation_draft_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"section" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"support" text NOT NULL,
	"rationale" text,
	"uncertainty" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs_confirmation" boolean DEFAULT false NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"final_text" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_draft_items_section_check" CHECK ("consultation_draft_items"."section" in ('summary', 'presenting_problem', 'symptoms', 'observations', 'relevant_history', 'allergies', 'medications', 'potential_considerations', 'potential_investigations', 'potential_medication_considerations', 'missing_information', 'uncertainties')),
	CONSTRAINT "consultation_draft_items_support_check" CHECK ("consultation_draft_items"."support" in ('supported', 'inferred', 'not_found', 'conflicting', 'outdated')),
	CONSTRAINT "consultation_draft_items_decision_check" CHECK ("consultation_draft_items"."decision" in ('pending', 'accepted', 'edited', 'rejected', 'deferred')),
	CONSTRAINT "consultation_draft_items_text_check" CHECK (length(btrim("consultation_draft_items"."text")) between 1 and 400)
);
--> statement-breakpoint
CREATE TABLE "consultation_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"phase" text,
	"insufficient" boolean DEFAULT false NOT NULL,
	"job_id" uuid,
	"run_id" uuid,
	"idempotency_key" text,
	"prompt_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"rules_version" text NOT NULL,
	"checks_version" text NOT NULL,
	"provider" text,
	"model" text,
	"runtime" text,
	"weights_sha256" text,
	"locality" text,
	"context_sha256" text NOT NULL,
	"context_manifest" jsonb NOT NULL,
	"source_count" integer NOT NULL,
	"omitted_count" integer DEFAULT 0 NOT NULL,
	"record_check" jsonb NOT NULL,
	"validation" jsonb,
	"error_code" text,
	"error_message" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"requested_by" uuid NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "consultation_drafts_status_check" CHECK ("consultation_drafts"."status" in ('generating', 'ready', 'partial', 'failed', 'unavailable', 'cancelled')),
	CONSTRAINT "consultation_drafts_phase_check" CHECK ("consultation_drafts"."phase" is null or "consultation_drafts"."phase" in ('queued', 'running')),
	CONSTRAINT "consultation_drafts_locality_check" CHECK ("consultation_drafts"."locality" is null or "consultation_drafts"."locality" in ('local', 'external')),
	CONSTRAINT "consultation_drafts_version_check" CHECK ("consultation_drafts"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "consultation_draft_items" ADD CONSTRAINT "consultation_draft_items_draft_id_consultation_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."consultation_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_draft_items" ADD CONSTRAINT "consultation_draft_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_drafts" ADD CONSTRAINT "consultation_drafts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_drafts" ADD CONSTRAINT "consultation_drafts_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_drafts" ADD CONSTRAINT "consultation_drafts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_drafts" ADD CONSTRAINT "consultation_drafts_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_drafts" ADD CONSTRAINT "consultation_drafts_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_drafts" ADD CONSTRAINT "consultation_drafts_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultation_draft_items_draft_idx" ON "consultation_draft_items" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consultation_drafts_version_uq" ON "consultation_drafts" USING btree ("encounter_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "consultation_drafts_one_generating_uq" ON "consultation_drafts" USING btree ("encounter_id") WHERE status = 'generating';--> statement-breakpoint
CREATE UNIQUE INDEX "consultation_drafts_idempotency_uq" ON "consultation_drafts" USING btree ("requested_by","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "consultation_drafts_encounter_idx" ON "consultation_drafts" USING btree ("encounter_id","created_at");
--> statement-breakpoint
-- A consultation draft is made once: while it is being generated its status and result fields change; once it has ended nothing in it changes, and
-- who it is for and what it was made from never change at all. It is never deleted.
CREATE FUNCTION consultation_drafts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consultation drafts cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'generating' THEN
    RAISE EXCEPTION 'a finished consultation draft cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.encounter_id IS DISTINCT FROM OLD.encounter_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.prompt_id IS DISTINCT FROM OLD.prompt_id
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.rules_version IS DISTINCT FROM OLD.rules_version
     OR NEW.checks_version IS DISTINCT FROM OLD.checks_version
     OR NEW.context_sha256 IS DISTINCT FROM OLD.context_sha256
     OR NEW.context_manifest IS DISTINCT FROM OLD.context_manifest
     OR NEW.record_check IS DISTINCT FROM OLD.record_check
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'the inputs of a consultation draft cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consultation_drafts_guard BEFORE UPDATE OR DELETE ON consultation_drafts
  FOR EACH ROW EXECUTE FUNCTION consultation_drafts_guard();
--> statement-breakpoint
CREATE TRIGGER consultation_drafts_no_truncate BEFORE TRUNCATE ON consultation_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint

-- The statements of a draft: what the model wrote never changes; only the doctor's decision is recorded, once (the shared review guard of
-- migration 0011). Nothing is deleted.
CREATE TRIGGER consultation_draft_items_review_guard BEFORE UPDATE OR DELETE ON consultation_draft_items
  FOR EACH ROW EXECUTE FUNCTION ai_review_guard('decision');
--> statement-breakpoint
CREATE TRIGGER consultation_draft_items_no_truncate BEFORE TRUNCATE ON consultation_draft_items
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
