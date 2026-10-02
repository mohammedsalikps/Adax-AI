CREATE TABLE "auscultation_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"file_id" uuid NOT NULL,
	"device_id" uuid,
	"site" text NOT NULL,
	"note" text,
	"data_origin" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"integration" text DEFAULT 'not_integrated' NOT NULL,
	"notes" text,
	"ingest_token_hash" text,
	"token_created_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auscultation_recordings" ADD CONSTRAINT "auscultation_recordings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auscultation_recordings" ADD CONSTRAINT "auscultation_recordings_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auscultation_recordings" ADD CONSTRAINT "auscultation_recordings_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auscultation_recordings" ADD CONSTRAINT "auscultation_recordings_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auscultation_recordings" ADD CONSTRAINT "auscultation_recordings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auscultation_recordings" ADD CONSTRAINT "auscultation_recordings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auscultation_patient_idx" ON "auscultation_recordings" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_assignments_one_open_uq" ON "device_assignments" USING btree ("device_id") WHERE "device_assignments"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "device_assignments_patient_idx" ON "device_assignments" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_serial_uq" ON "devices" USING btree ("facility_id","serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uq" ON "devices" USING btree ("ingest_token_hash");--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER auscultation_recordings_append_only BEFORE UPDATE OR DELETE ON auscultation_recordings
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
-- An assignment is never deleted or rewritten; it can only be ended, once.
CREATE FUNCTION device_assignment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  end_cols text[] := ARRAY['ended_at', 'ended_by', 'end_reason'];
BEGIN
  IF TG_OP = 'DELETE' OR OLD.ended_at IS NOT NULL
     OR (to_jsonb(NEW) - end_cols) IS DISTINCT FROM (to_jsonb(OLD) - end_cols) THEN
    RAISE EXCEPTION 'device assignments can only be ended, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER device_assignments_guard BEFORE UPDATE OR DELETE ON device_assignments
  FOR EACH ROW EXECUTE FUNCTION device_assignment_guard();
