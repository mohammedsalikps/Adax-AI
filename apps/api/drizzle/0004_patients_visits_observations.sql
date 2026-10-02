CREATE TYPE "public"."allergy_severity" AS ENUM('mild', 'moderate', 'severe', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."consent_method" AS ENUM('verbal', 'written', 'digital');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('data_processing', 'ai_recording', 'thermal_imaging', 'device_monitoring', 'portal_access', 'research_use');--> statement-breakpoint
CREATE TYPE "public"."observation_source" AS ENUM('manual', 'device');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."visit_priority" AS ENUM('normal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('waiting', 'in_triage', 'ready', 'in_consultation', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."vital_kind" AS ENUM('heart_rate', 'respiratory_rate', 'systolic_bp', 'diastolic_bp', 'temperature', 'spo2', 'weight', 'height', 'blood_glucose', 'pain_score');--> statement-breakpoint
CREATE SEQUENCE "public"."patient_mrn_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "allergies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"substance" text NOT NULL,
	"reaction" text,
	"severity" "allergy_severity" DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"type" "consent_type" NOT NULL,
	"status" text DEFAULT 'granted' NOT NULL,
	"method" "consent_method" NOT NULL,
	"scope" text DEFAULT 'ongoing' NOT NULL,
	"encounter_id" uuid,
	"version" text DEFAULT '2026-10-v1' NOT NULL,
	"notes" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid
);
--> statement-breakpoint
CREATE TABLE "daily_token_counters" (
	"facility_id" uuid NOT NULL,
	"visit_date" date NOT NULL,
	"last_token" integer NOT NULL,
	CONSTRAINT "daily_token_counters_facility_id_visit_date_pk" PRIMARY KEY("facility_id","visit_date")
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"kind" "vital_kind" NOT NULL,
	"value" numeric(8, 2) NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "observation_source" DEFAULT 'manual' NOT NULL,
	"validation_status" text DEFAULT 'manual_entry' NOT NULL,
	"device_id" uuid,
	"recorded_by" uuid,
	"entered_in_error" boolean DEFAULT false NOT NULL,
	"entered_in_error_reason" text,
	"entered_in_error_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_activation_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"mrn" "citext" DEFAULT 'ADX-' || lpad(nextval('patient_mrn_seq')::text, 6, '0') NOT NULL,
	"given_name" text NOT NULL,
	"family_name" text,
	"search_name" text GENERATED ALWAYS AS (lower(given_name || ' ' || coalesce(family_name, ''))) STORED,
	"date_of_birth" date NOT NULL,
	"date_of_birth_estimated" boolean DEFAULT false NOT NULL,
	"sex" "sex" NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"abha_number" text,
	"blood_group" text,
	"preferred_language" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"no_known_allergies" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_mrn_unique" UNIQUE("mrn")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"assigned_doctor_id" uuid,
	"visit_date" date NOT NULL,
	"token_number" integer NOT NULL,
	"status" "visit_status" DEFAULT 'waiting' NOT NULL,
	"priority" "visit_priority" DEFAULT 'normal' NOT NULL,
	"chief_complaint" text,
	"status_reason" text,
	"created_by" uuid,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_token_counters" ADD CONSTRAINT "daily_token_counters_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_entered_in_error_by_users_id_fk" FOREIGN KEY ("entered_in_error_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_activation_codes" ADD CONSTRAINT "patient_activation_codes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_activation_codes" ADD CONSTRAINT "patient_activation_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_assigned_doctor_id_users_id_fk" FOREIGN KEY ("assigned_doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allergies_patient_idx" ON "allergies" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "consents_patient_idx" ON "consents" USING btree ("patient_id","type");--> statement-breakpoint
CREATE INDEX "observations_patient_kind_idx" ON "observations" USING btree ("patient_id","kind","measured_at");--> statement-breakpoint
CREATE INDEX "observations_visit_idx" ON "observations" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "activation_codes_patient_idx" ON "patient_activation_codes" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patients_search_name_trgm" ON "patients" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "patients_phone_idx" ON "patients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "patients_dob_idx" ON "patients" USING btree ("date_of_birth");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_token_uq" ON "visits" USING btree ("facility_id","visit_date","token_number");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_one_open_per_day_uq" ON "visits" USING btree ("patient_id","visit_date") WHERE status in ('waiting', 'in_triage', 'ready', 'in_consultation');--> statement-breakpoint
CREATE INDEX "visits_date_status_idx" ON "visits" USING btree ("facility_id","visit_date","status");--> statement-breakpoint
CREATE INDEX "visits_patient_idx" ON "visits" USING btree ("patient_id");