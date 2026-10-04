CREATE TABLE "mana_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"encounter_id" uuid,
	"patient_id" uuid,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus" text,
	"data_origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mana_message_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"patient_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mana_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"text" text,
	"parent_id" uuid,
	"asked_by" uuid NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"phase" text,
	"plan" jsonb,
	"answer" jsonb,
	"error_code" text,
	"error_message" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"provider" text,
	"model" text,
	"runtime" text,
	"weights_sha256" text,
	"locality" text,
	"plan_prompt_id" text,
	"answer_prompt_id" text,
	"schema_version" text,
	"checks_version" text,
	"tools_version" text,
	"validation" jsonb,
	"job_id" uuid,
	"plan_run_id" uuid,
	"answer_run_id" uuid,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mana_messages_role_check" CHECK ("mana_messages"."role" in ('doctor', 'mana')),
	CONSTRAINT "mana_messages_status_check" CHECK ("mana_messages"."status" in ('pending', 'ready', 'refused', 'unverified', 'failed', 'unavailable', 'cancelled')),
	CONSTRAINT "mana_messages_text_check" CHECK ("mana_messages"."text" is null or length(btrim("mana_messages"."text")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "mana_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"status" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"patient_id" uuid,
	"source_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mana_conversations" ADD CONSTRAINT "mana_conversations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_conversations" ADD CONSTRAINT "mana_conversations_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_conversations" ADD CONSTRAINT "mana_conversations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_conversations" ADD CONSTRAINT "mana_conversations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_message_sources" ADD CONSTRAINT "mana_message_sources_message_id_mana_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mana_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_message_sources" ADD CONSTRAINT "mana_message_sources_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_messages" ADD CONSTRAINT "mana_messages_conversation_id_mana_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."mana_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_messages" ADD CONSTRAINT "mana_messages_parent_id_mana_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."mana_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_messages" ADD CONSTRAINT "mana_messages_asked_by_users_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_messages" ADD CONSTRAINT "mana_messages_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_messages" ADD CONSTRAINT "mana_messages_plan_run_id_ai_runs_id_fk" FOREIGN KEY ("plan_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_messages" ADD CONSTRAINT "mana_messages_answer_run_id_ai_runs_id_fk" FOREIGN KEY ("answer_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_tool_calls" ADD CONSTRAINT "mana_tool_calls_message_id_mana_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mana_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mana_tool_calls" ADD CONSTRAINT "mana_tool_calls_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mana_conversations_doctor_idx" ON "mana_conversations" USING btree ("doctor_id","encounter_id","updated_at");--> statement-breakpoint
CREATE INDEX "mana_conversations_facility_idx" ON "mana_conversations" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mana_message_sources_uq" ON "mana_message_sources" USING btree ("message_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "mana_messages_seq_uq" ON "mana_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "mana_messages_one_pending_uq" ON "mana_messages" USING btree ("conversation_id") WHERE role = 'mana' and status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "mana_messages_idempotency_uq" ON "mana_messages" USING btree ("asked_by","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "mana_messages_conversation_idx" ON "mana_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "mana_tool_calls_message_idx" ON "mana_tool_calls" USING btree ("message_id","position");
--> statement-breakpoint

-- Mana AI conversations are kept as they were made. A conversation belongs to one doctor of one clinic for good (who it is, where and when it
-- began never change; the patients shown in it and the one most recently discussed do). Nothing is deleted.
CREATE FUNCTION mana_conversations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Mana conversations cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR NEW.encounter_id IS DISTINCT FROM OLD.encounter_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'who a Mana conversation belongs to cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mana_conversations_guard BEFORE UPDATE OR DELETE ON mana_conversations
  FOR EACH ROW EXECUTE FUNCTION mana_conversations_guard();
--> statement-breakpoint
CREATE TRIGGER mana_conversations_no_truncate BEFORE TRUNCATE ON mana_conversations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint

-- A message is made once: while an answer is pending its progress and result fields change; once it has ended nothing in it changes, and what the
-- doctor asked never changes at all. Nothing is deleted.
CREATE FUNCTION mana_messages_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Mana messages cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a finished Mana message cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.asked_by IS DISTINCT FROM OLD.asked_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'what was asked of Mana, and by whom, cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mana_messages_guard BEFORE UPDATE OR DELETE ON mana_messages
  FOR EACH ROW EXECUTE FUNCTION mana_messages_guard();
--> statement-breakpoint
CREATE TRIGGER mana_messages_no_truncate BEFORE TRUNCATE ON mana_messages
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint

-- What a question ran, and the records an answer rests on, are written once.
CREATE TRIGGER mana_tool_calls_append_only BEFORE UPDATE OR DELETE ON mana_tool_calls
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER mana_tool_calls_no_truncate BEFORE TRUNCATE ON mana_tool_calls
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER mana_message_sources_append_only BEFORE UPDATE OR DELETE ON mana_message_sources
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER mana_message_sources_no_truncate BEFORE TRUNCATE ON mana_message_sources
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
