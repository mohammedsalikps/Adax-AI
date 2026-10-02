ALTER TYPE "public"."consent_type" ADD VALUE 'ai_record_assistant';--> statement-breakpoint
CREATE TABLE "mana_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"asked_by" uuid NOT NULL,
	"question" text NOT NULL,
	"intent" text NOT NULL,
	"rules_version" text NOT NULL,
	"record_answer" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"generation_status" text NOT NULL,
	"generation_reason" text,
	"generation_retryable" boolean DEFAULT false NOT NULL,
	"generated" jsonb,
	"job_id" uuid,
	"run_id" uuid,
	"idempotency_key" text,
	"data_origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mana_questions_generation_check" CHECK ("mana_questions"."generation_status" in ('pending', 'succeeded', 'failed', 'unavailable', 'consent_required', 'not_requested'))
);
--> statement-breakpoint
CREATE TABLE "note_insertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"section" text NOT NULL,
	"text" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"produced_by" text,
	"inserted_by" uuid NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mana_questions" ADD CONSTRAINT "mana_questions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_questions" ADD CONSTRAINT "mana_questions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_questions" ADD CONSTRAINT "mana_questions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_questions" ADD CONSTRAINT "mana_questions_asked_by_users_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_questions" ADD CONSTRAINT "mana_questions_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_questions" ADD CONSTRAINT "mana_questions_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_insertions" ADD CONSTRAINT "note_insertions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_insertions" ADD CONSTRAINT "note_insertions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_insertions" ADD CONSTRAINT "note_insertions_inserted_by_users_id_fk" FOREIGN KEY ("inserted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mana_questions_patient_idx" ON "mana_questions" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mana_questions_idempotency_uq" ON "mana_questions" USING btree ("asked_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "note_insertions_encounter_idx" ON "note_insertions" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "note_insertions_subject_idx" ON "note_insertions" USING btree ("subject_type","subject_id");--> statement-breakpoint
-- A Mana answer is written once. Only its AI-generated part may be completed,
-- and only while that part is pending or failed (a retry); nothing is deleted.
CREATE FUNCTION mana_question_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  gen_cols text[] := ARRAY['generation_status', 'generation_reason', 'generation_retryable', 'generated', 'job_id', 'run_id', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' OR OLD.generation_status NOT IN ('pending', 'failed')
     OR (to_jsonb(NEW) - gen_cols) IS DISTINCT FROM (to_jsonb(OLD) - gen_cols) THEN
    RAISE EXCEPTION 'Mana answers cannot be changed; only a pending or failed AI summary can be completed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mana_questions_guard BEFORE UPDATE OR DELETE ON mana_questions
  FOR EACH ROW EXECUTE FUNCTION mana_question_guard();
--> statement-breakpoint
CREATE TRIGGER note_insertions_append_only BEFORE UPDATE OR DELETE ON note_insertions
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
