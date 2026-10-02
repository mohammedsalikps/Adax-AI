CREATE TYPE "public"."diagnosis_kind" AS ENUM('provisional', 'primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('in_progress', 'signed');--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"description" text NOT NULL,
	"code" text,
	"kind" "diagnosis_kind" DEFAULT 'primary' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounter_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"status" "encounter_status" DEFAULT 'in_progress' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"chief_complaint" text DEFAULT '' NOT NULL,
	"history" text DEFAULT '' NOT NULL,
	"past_history" text DEFAULT '' NOT NULL,
	"examination" text DEFAULT '' NOT NULL,
	"assessment" text DEFAULT '' NOT NULL,
	"plan" text DEFAULT '' NOT NULL,
	"follow_up" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_snapshot" jsonb,
	"content_hash" text,
	CONSTRAINT "encounters_visit_id_unique" UNIQUE("visit_id")
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"drug_name" text NOT NULL,
	"strength" text DEFAULT '' NOT NULL,
	"form" text DEFAULT '' NOT NULL,
	"dose" text NOT NULL,
	"route" text DEFAULT 'Oral' NOT NULL,
	"frequency" text NOT NULL,
	"duration" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD CONSTRAINT "encounter_amendments_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD CONSTRAINT "encounter_amendments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnoses_encounter_idx" ON "diagnoses" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "amendments_encounter_idx" ON "encounter_amendments" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "encounters_patient_idx" ON "encounters" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "encounters_doctor_status_idx" ON "encounters" USING btree ("doctor_id","status");--> statement-breakpoint
CREATE INDEX "prescription_items_encounter_idx" ON "prescription_items" USING btree ("encounter_id");