ALTER TYPE "public"."consent_type" ADD VALUE 'clinical_photography';--> statement-breakpoint
ALTER TYPE "public"."consent_type" ADD VALUE 'ai_image_analysis';--> statement-breakpoint
CREATE TABLE "ai_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"source_ref" text NOT NULL,
	"provenance" text NOT NULL,
	"excerpt" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"input" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"idempotency_key" text,
	"data_origin" text NOT NULL,
	"settings_sha256" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_jobs_status_check" CHECK ("ai_jobs"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "ai_jobs_origin_check" CHECK ("ai_jobs"."data_origin" in ('clinical', 'synthetic'))
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"capability" text NOT NULL,
	"first_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"urgency" text DEFAULT 'routine' NOT NULL,
	"text" text NOT NULL,
	"rationale" text NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unsupported" boolean DEFAULT false NOT NULL,
	"instruction" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"final_text" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"action" text NOT NULL,
	"text" text,
	"reason" text,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings_snapshots" (
	"sha256" text PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"transcript_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"attribution" text NOT NULL,
	"certainty" text NOT NULL,
	"uncertainty_reason" text,
	"negated" boolean DEFAULT false NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"final_text" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"file_id" uuid NOT NULL,
	"preview_file_id" uuid NOT NULL,
	"image_type" text NOT NULL,
	"source" text NOT NULL,
	"body_site" text,
	"description" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	"data_origin" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_memberships" (
	"export_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"export_local_id" text NOT NULL,
	CONSTRAINT "dataset_memberships_export_id_entity_type_entity_id_pk" PRIMARY KEY("export_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid,
	"pipeline_version" text NOT NULL,
	"non_clinical" boolean NOT NULL,
	"metrics" jsonb NOT NULL,
	"report_markdown" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"final_text" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"rules_version" text NOT NULL,
	"suggestion" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transcript_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"label" text NOT NULL,
	"speaker" text,
	"speaker_source" text DEFAULT 'none' NOT NULL,
	"text" text NOT NULL,
	"chunk_index" integer,
	"start_ms" integer,
	"end_ms" integer,
	"confidence" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER COLUMN "encounter_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transcripts" ALTER COLUMN "segments" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "status" text DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_settings_sha256_ai_settings_snapshots_sha256_fk" FOREIGN KEY ("settings_sha256") REFERENCES "public"."ai_settings_snapshots"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_actions" ADD CONSTRAINT "ai_review_actions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_actions" ADD CONSTRAINT "ai_review_actions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_actions" ADD CONSTRAINT "ai_review_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_facts" ADD CONSTRAINT "clinical_facts_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_facts" ADD CONSTRAINT "clinical_facts_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_facts" ADD CONSTRAINT "clinical_facts_transcript_id_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_facts" ADD CONSTRAINT "clinical_facts_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_facts" ADD CONSTRAINT "clinical_facts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_facts" ADD CONSTRAINT "clinical_facts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_images" ADD CONSTRAINT "clinical_images_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_images" ADD CONSTRAINT "clinical_images_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_images" ADD CONSTRAINT "clinical_images_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_images" ADD CONSTRAINT "clinical_images_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_images" ADD CONSTRAINT "clinical_images_preview_file_id_files_id_fk" FOREIGN KEY ("preview_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_images" ADD CONSTRAINT "clinical_images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_memberships" ADD CONSTRAINT "dataset_memberships_export_id_thermal_dataset_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."thermal_dataset_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_analyses" ADD CONSTRAINT "image_analyses_image_id_clinical_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."clinical_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_analyses" ADD CONSTRAINT "image_analyses_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_analyses" ADD CONSTRAINT "image_analyses_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_analyses" ADD CONSTRAINT "image_analyses_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_suggestions" ADD CONSTRAINT "routing_suggestions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_suggestions" ADD CONSTRAINT "routing_suggestions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_suggestions" ADD CONSTRAINT "routing_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_suggestions" ADD CONSTRAINT "routing_suggestions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcript_id_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_evidence_subject_idx" ON "ai_evidence" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_encounter_idx" ON "ai_jobs" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_patient_idx" ON "ai_jobs" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_created_idx" ON "ai_jobs" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_idempotency_uq" ON "ai_jobs" USING btree ("created_by","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_uq" ON "ai_models" USING btree ("provider","model","capability");--> statement-breakpoint
CREATE INDEX "ai_recommendations_encounter_idx" ON "ai_recommendations" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "ai_review_actions_subject_idx" ON "ai_review_actions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ai_review_actions_encounter_idx" ON "ai_review_actions" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "clinical_facts_encounter_idx" ON "clinical_facts" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "clinical_facts_job_idx" ON "clinical_facts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "clinical_images_patient_idx" ON "clinical_images" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "clinical_images_encounter_idx" ON "clinical_images" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "evaluation_runs_kind_idx" ON "evaluation_runs" USING btree ("facility_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "image_analyses_image_idx" ON "image_analyses" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "routing_suggestions_visit_idx" ON "routing_suggestions" USING btree ("visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_segments_label_uq" ON "transcript_segments" USING btree ("transcript_id","label");--> statement-breakpoint
CREATE INDEX "transcript_segments_order_idx" ON "transcript_segments" USING btree ("transcript_id","chunk_index","seq");--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_job_idx" ON "ai_runs" USING btree ("job_id");--> statement-breakpoint
-- Data: transcript segments move from the JSON column into rows.
INSERT INTO transcript_segments (transcript_id, seq, label, speaker, speaker_source, text, created_at)
SELECT t.id, s.ord::int, s.seg->>'id', nullif(s.seg->>'speaker', ''),
       CASE WHEN coalesce(s.seg->>'speaker', '') = '' THEN 'none' ELSE 'typed_label' END,
       s.seg->>'text', t.created_at
FROM transcripts t
CROSS JOIN LATERAL jsonb_array_elements(t.segments) WITH ORDINALITY AS s(seg, ord)
WHERE t.segments IS NOT NULL;
--> statement-breakpoint
UPDATE ai_runs r SET patient_id = e.patient_id FROM encounters e WHERE e.id = r.encounter_id AND r.patient_id IS NULL;
--> statement-breakpoint
-- Data: stored thermal dataset evaluations become evaluation runs.
INSERT INTO evaluation_runs (facility_id, kind, subject_id, pipeline_version, non_clinical, metrics, report_markdown, created_by, created_at)
SELECT x.facility_id, 'thermal_dataset', x.id, coalesce(x.evaluation->>'pipelineVersion', 'unknown'),
       coalesce((x.evaluation->>'nonClinical')::boolean, true), x.evaluation, x.evaluation_markdown, x.created_by, x.evaluated_at
FROM thermal_dataset_exports x
WHERE x.evaluated_at IS NOT NULL;
--> statement-breakpoint
-- Append-only tables: evidence, review history, transcript segments,
-- evaluation results and dataset membership are records of what happened.
CREATE FUNCTION reject_change_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transcript_segments_append_only BEFORE UPDATE OR DELETE ON transcript_segments
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER ai_evidence_append_only BEFORE UPDATE OR DELETE ON ai_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER ai_review_actions_append_only BEFORE UPDATE OR DELETE ON ai_review_actions
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER evaluation_runs_append_only BEFORE UPDATE OR DELETE ON evaluation_runs
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER dataset_memberships_append_only BEFORE UPDATE OR DELETE ON dataset_memberships
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER clinical_images_append_only BEFORE UPDATE OR DELETE ON clinical_images
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
-- AI outputs awaiting review: what the AI produced never changes; only the
-- review columns may be set, and only while the item is pending or deferred.
-- TG_ARGV[0] names the status column.
CREATE FUNCTION ai_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  col text := TG_ARGV[0];
  review_cols text[] := ARRAY[TG_ARGV[0], 'final_text', 'decided_by', 'decided_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - review_cols) IS DISTINCT FROM (to_jsonb(OLD) - review_cols) THEN
    RAISE EXCEPTION 'AI output cannot be changed; record a review decision instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(OLD)->>col) NOT IN ('pending', 'deferred') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'this AI output has already been reviewed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clinical_facts_review_guard BEFORE UPDATE OR DELETE ON clinical_facts
  FOR EACH ROW EXECUTE FUNCTION ai_review_guard('status');
--> statement-breakpoint
CREATE TRIGGER ai_recommendations_review_guard BEFORE UPDATE OR DELETE ON ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION ai_review_guard('status');
--> statement-breakpoint
CREATE TRIGGER image_analyses_review_guard BEFORE UPDATE OR DELETE ON image_analyses
  FOR EACH ROW EXECUTE FUNCTION ai_review_guard('status');
--> statement-breakpoint
CREATE TRIGGER ai_draft_items_review_guard BEFORE UPDATE OR DELETE ON ai_draft_items
  FOR EACH ROW EXECUTE FUNCTION ai_review_guard('decision');
--> statement-breakpoint
-- Routing suggestions: the suggestion itself never changes; staff review it once.
CREATE FUNCTION routing_suggestion_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  review_cols text[] := ARRAY['status', 'reviewed_by', 'reviewed_at', 'review_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'routing suggestions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - review_cols) IS DISTINCT FROM (to_jsonb(OLD) - review_cols) OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'routing suggestions are reviewed once and never changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER routing_suggestions_guard BEFORE UPDATE OR DELETE ON routing_suggestions
  FOR EACH ROW EXECUTE FUNCTION routing_suggestion_guard();
