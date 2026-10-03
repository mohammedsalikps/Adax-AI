CREATE TABLE "transcript_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transcript_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"file_id" uuid,
	"offset_ms" integer NOT NULL,
	"duration_ms" integer,
	"language" text,
	"run_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_chunks_status_check" CHECK ("transcript_chunks"."status" in ('received', 'transcribed', 'failed')),
	CONSTRAINT "transcript_chunks_offset_check" CHECK ("transcript_chunks"."offset_ms" >= 0 and ("transcript_chunks"."duration_ms" is null or "transcript_chunks"."duration_ms" >= 0))
);
--> statement-breakpoint
CREATE TABLE "transcript_segment_speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"speaker" text NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_segment_speakers_check" CHECK ("transcript_segment_speakers"."speaker" in ('Doctor', 'Patient', 'Nurse', 'Relative', 'Attendant', 'Other', 'Unknown'))
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "locality" text;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "runtime" text;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "weights_sha256" text;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "avg_logprob" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "no_speech_prob" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_transcript_id_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segment_speakers" ADD CONSTRAINT "transcript_segment_speakers_segment_id_transcript_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."transcript_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segment_speakers" ADD CONSTRAINT "transcript_segment_speakers_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_chunks_part_uq" ON "transcript_chunks" USING btree ("transcript_id","chunk_index");--> statement-breakpoint
CREATE INDEX "transcript_segment_speakers_segment_idx" ON "transcript_segment_speakers" USING btree ("segment_id","assigned_at");--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_one_live_uq" ON "transcripts" USING btree ("encounter_id") WHERE status = 'live';--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_locality_check" CHECK ("ai_runs"."locality" is null or "ai_runs"."locality" in ('local', 'external'));--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_end_reason_check" CHECK ("transcripts"."end_reason" is null or "transcripts"."end_reason" in ('doctor_stopped', 'consent_withdrawn', 'stale_replaced', 'error'));
--> statement-breakpoint

-- Who the doctor says spoke a line is evidence of a review: it can be added to, never changed or removed (policy of migration 0019:
-- the application role keeps INSERT and SELECT only). The latest row for a line is the reviewed speaker; earlier rows stay.
CREATE TRIGGER transcript_segment_speakers_append_only BEFORE UPDATE OR DELETE ON transcript_segment_speakers
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER transcript_segment_speakers_no_truncate BEFORE TRUNCATE ON transcript_segment_speakers
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
INSERT INTO meta.append_only_tables (table_name) VALUES ('transcript_segment_speakers') ON CONFLICT DO NOTHING;
