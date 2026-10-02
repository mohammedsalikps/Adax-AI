CREATE TABLE "thermal_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"raw_file_id" uuid NOT NULL,
	"matrix_file_id" uuid NOT NULL,
	"visible_file_id" uuid,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"min_c" numeric(6, 2) NOT NULL,
	"max_c" numeric(6, 2) NOT NULL,
	"mean_c" numeric(6, 2) NOT NULL,
	"camera" jsonb NOT NULL,
	"parameters" jsonb NOT NULL,
	"extractor" jsonb NOT NULL,
	"protocol" jsonb NOT NULL,
	"pair_stats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermal_rois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_id" uuid NOT NULL,
	"label" text NOT NULL,
	"shape" text NOT NULL,
	"x" numeric(10, 2) NOT NULL,
	"y" numeric(10, 2) NOT NULL,
	"width" numeric(10, 2) NOT NULL,
	"height" numeric(10, 2) NOT NULL,
	"pair_with" text,
	"stats" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_raw_file_id_files_id_fk" FOREIGN KEY ("raw_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_matrix_file_id_files_id_fk" FOREIGN KEY ("matrix_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_visible_file_id_files_id_fk" FOREIGN KEY ("visible_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_rois" ADD CONSTRAINT "thermal_rois_capture_id_thermal_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."thermal_captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_rois" ADD CONSTRAINT "thermal_rois_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thermal_captures_patient_idx" ON "thermal_captures" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "thermal_captures_encounter_idx" ON "thermal_captures" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "thermal_rois_capture_idx" ON "thermal_rois" USING btree ("capture_id");