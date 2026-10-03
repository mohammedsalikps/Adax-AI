CREATE TYPE "public"."condition_status" AS ENUM('active', 'controlled', 'resolved', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."investigation_status" AS ENUM('final', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."medication_status" AS ENUM('current', 'stopped', 'entered_in_error');--> statement-breakpoint
CREATE TABLE "investigation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"test_name" text NOT NULL,
	"value_text" text NOT NULL,
	"value_number" numeric,
	"unit" text,
	"ref_low" numeric,
	"ref_high" numeric,
	"ref_text" text,
	"flag" text DEFAULT 'unknown' NOT NULL,
	"collected_on" date NOT NULL,
	"resulted_on" date,
	"status" "investigation_status" DEFAULT 'final' NOT NULL,
	"note" text,
	"status_reason" text,
	"source" text DEFAULT 'clinician_entered' NOT NULL,
	"data_origin" text NOT NULL,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigation_results_text_check" CHECK (length(btrim(test_name)) between 1 and 120 and length(btrim(value_text)) between 1 and 60 and length(coalesce(unit, '')) <= 20 and length(coalesce(ref_text, '')) <= 60 and length(coalesce(note, '')) <= 300 and length(coalesce(status_reason, '')) <= 200),
	CONSTRAINT "investigation_results_flag_check" CHECK (flag in ('normal', 'low', 'high', 'abnormal', 'unknown')),
	CONSTRAINT "investigation_results_range_check" CHECK (ref_low is null or ref_high is null or ref_low <= ref_high),
	CONSTRAINT "investigation_results_dates_check" CHECK (resulted_on is null or resulted_on >= collected_on),
	CONSTRAINT "investigation_results_error_reason_check" CHECK (status <> 'entered_in_error' or length(btrim(coalesce(status_reason, ''))) >= 3),
	CONSTRAINT "investigation_results_source_check" CHECK (source in ('clinician_entered') and data_origin in ('synthetic', 'clinical'))
);
--> statement-breakpoint
CREATE TABLE "patient_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"since_year" integer NOT NULL,
	"since_month" integer,
	"status" "condition_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"status_reason" text,
	"source" text DEFAULT 'clinician_entered' NOT NULL,
	"data_origin" text NOT NULL,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_conditions_since_check" CHECK (since_year between 1900 and 2200 and (since_month is null or since_month between 1 and 12)),
	CONSTRAINT "patient_conditions_text_check" CHECK (length(btrim(name)) between 1 and 120 and length(coalesce(note, '')) <= 300 and length(coalesce(status_reason, '')) <= 200),
	CONSTRAINT "patient_conditions_code_check" CHECK (code is null or code ~ '^[A-Z][0-9][0-9A-Z]([.][0-9A-Z]{1,4})?$'),
	CONSTRAINT "patient_conditions_error_reason_check" CHECK (status <> 'entered_in_error' or length(btrim(coalesce(status_reason, ''))) >= 3),
	CONSTRAINT "patient_conditions_source_check" CHECK (source in ('clinician_entered') and data_origin in ('synthetic', 'clinical'))
);
--> statement-breakpoint
CREATE TABLE "patient_history_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "patient_history_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"patient_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_history_events_entity_check" CHECK (entity_type in ('condition', 'medication', 'investigation') and action in ('created', 'status_changed'))
);
--> statement-breakpoint
CREATE TABLE "patient_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"drug_name" text NOT NULL,
	"strength" text,
	"form" text,
	"dose" text NOT NULL,
	"route" text,
	"frequency" text NOT NULL,
	"started_on" date,
	"stopped_on" date,
	"status" "medication_status" DEFAULT 'current' NOT NULL,
	"reason" text,
	"status_reason" text,
	"source" text DEFAULT 'clinician_entered' NOT NULL,
	"data_origin" text NOT NULL,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_medications_text_check" CHECK (length(btrim(drug_name)) between 1 and 120 and length(btrim(dose)) between 1 and 60 and length(btrim(frequency)) between 1 and 60 and length(coalesce(reason, '')) <= 200 and length(coalesce(status_reason, '')) <= 200),
	CONSTRAINT "patient_medications_dates_check" CHECK (stopped_on is null or started_on is null or stopped_on >= started_on),
	CONSTRAINT "patient_medications_stop_check" CHECK (status <> 'stopped' or length(btrim(coalesce(status_reason, ''))) >= 3),
	CONSTRAINT "patient_medications_stopped_on_check" CHECK (stopped_on is null or status in ('stopped', 'entered_in_error')),
	CONSTRAINT "patient_medications_error_reason_check" CHECK (status <> 'entered_in_error' or length(btrim(coalesce(status_reason, ''))) >= 3),
	CONSTRAINT "patient_medications_source_check" CHECK (source in ('clinician_entered') and data_origin in ('synthetic', 'clinical'))
);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "data_origin" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "investigation_results" ADD CONSTRAINT "investigation_results_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_results" ADD CONSTRAINT "investigation_results_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_history_events" ADD CONSTRAINT "patient_history_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_history_events" ADD CONSTRAINT "patient_history_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigation_results_patient_idx" ON "investigation_results" USING btree ("patient_id","collected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_results_dedup_uq" ON "investigation_results" USING btree ("patient_id",lower("test_name"),"collected_on",lower("value_text")) WHERE status = 'final';--> statement-breakpoint
CREATE INDEX "patient_conditions_patient_idx" ON "patient_conditions" USING btree ("patient_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_conditions_open_name_uq" ON "patient_conditions" USING btree ("patient_id",lower("name")) WHERE status in ('active', 'controlled');--> statement-breakpoint
CREATE INDEX "patient_history_events_patient_idx" ON "patient_history_events" USING btree ("patient_id","id");--> statement-breakpoint
CREATE INDEX "patient_history_events_entity_idx" ON "patient_history_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "patient_medications_patient_idx" ON "patient_medications" USING btree ("patient_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_medications_current_uq" ON "patient_medications" USING btree ("patient_id",lower("drug_name"),lower(coalesce("strength", '')),lower("dose"),lower("frequency")) WHERE status = 'current';--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_data_origin_check" CHECK (data_origin in ('unspecified', 'synthetic', 'clinical'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Slice V1: longitudinal patient history (docs/DOCTOR_APP_PLAN.md).
-- Additive: new tables, plus one new column on patients. Nothing is removed.
-- ---------------------------------------------------------------------------

-- 1. Records made in the seeded synthetic facility are synthetic; any other record keeps 'unspecified'
--    (the system never guesses that something is clinical).
UPDATE patients SET data_origin = 'synthetic'
 WHERE data_origin = 'unspecified' AND facility_id IN (SELECT id FROM facilities WHERE name LIKE '%(synthetic)');
--> statement-breakpoint

-- 2. History entries are never deleted and their content never changes. Only the status (and what explains it) can,
--    and "entered in error" is final. Same rule for the application role and for anyone else.
CREATE FUNCTION patient_conditions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'History entries are never deleted; mark an entry as entered in error instead' USING ERRCODE = 'AX008';
  END IF;
  IF OLD.status = 'entered_in_error' THEN
    RAISE EXCEPTION 'An entry marked as entered in error cannot be changed' USING ERRCODE = 'AX008';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'status_reason', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'status_reason', 'updated_at']) THEN
    RAISE EXCEPTION 'The content of a history entry cannot be changed; mark it as entered in error and enter a new one' USING ERRCODE = 'AX008';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER patient_conditions_guard BEFORE UPDATE OR DELETE ON patient_conditions
  FOR EACH ROW EXECUTE FUNCTION patient_conditions_guard();
--> statement-breakpoint

CREATE FUNCTION patient_medications_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'History entries are never deleted; mark an entry as entered in error instead' USING ERRCODE = 'AX008';
  END IF;
  IF OLD.status = 'entered_in_error' THEN
    RAISE EXCEPTION 'An entry marked as entered in error cannot be changed' USING ERRCODE = 'AX008';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'status_reason', 'stopped_on', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'status_reason', 'stopped_on', 'updated_at']) THEN
    RAISE EXCEPTION 'The content of a history entry cannot be changed; mark it as entered in error and enter a new one' USING ERRCODE = 'AX008';
  END IF;
  -- A stopped medicine is not restarted (enter a new one) and its stop details do not change; it can only be marked as an error.
  IF OLD.status = 'stopped' AND (NEW.status NOT IN ('stopped', 'entered_in_error') OR (NEW.status = 'stopped' AND (NEW.stopped_on IS DISTINCT FROM OLD.stopped_on OR NEW.status_reason IS DISTINCT FROM OLD.status_reason))) THEN
    RAISE EXCEPTION 'A stopped medicine cannot be restarted or changed; enter a new one' USING ERRCODE = 'AX008';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER patient_medications_guard BEFORE UPDATE OR DELETE ON patient_medications
  FOR EACH ROW EXECUTE FUNCTION patient_medications_guard();
--> statement-breakpoint

CREATE FUNCTION investigation_results_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'History entries are never deleted; mark an entry as entered in error instead' USING ERRCODE = 'AX008';
  END IF;
  IF OLD.status = 'entered_in_error' THEN
    RAISE EXCEPTION 'An entry marked as entered in error cannot be changed' USING ERRCODE = 'AX008';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'status_reason', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'status_reason', 'updated_at']) THEN
    RAISE EXCEPTION 'The content of a history entry cannot be changed; mark it as entered in error and enter a new one' USING ERRCODE = 'AX008';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER investigation_results_guard BEFORE UPDATE OR DELETE ON investigation_results
  FOR EACH ROW EXECUTE FUNCTION investigation_results_guard();
--> statement-breakpoint

-- 3. The change history of entries cannot be altered or emptied (migration 0019 policy: the application role keeps INSERT and SELECT only).
CREATE TRIGGER patient_history_events_append_only BEFORE UPDATE OR DELETE ON patient_history_events
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER patient_history_events_no_truncate BEFORE TRUNCATE ON patient_history_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
INSERT INTO meta.append_only_tables (table_name) VALUES ('patient_history_events') ON CONFLICT DO NOTHING;
