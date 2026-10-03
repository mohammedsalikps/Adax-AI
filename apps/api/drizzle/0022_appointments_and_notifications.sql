-- Slice 4: appointments, their status history, and the notification outbox.
-- Additive: new tables only. Nothing existing is changed except one new trigger
-- on visits (a checked-in appointment follows its visit's final status).
-- See docs/adr/0010.

-- btree_gist lets an exclusion constraint combine "same doctor / same patient" (=)
-- with "overlapping time" (&&), so double booking is refused by the database itself.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- timestamptz + interval is only STABLE in PostgreSQL; adding whole minutes is not
-- affected by timezone or DST, so this wrapper is honestly IMMUTABLE and can be indexed.
CREATE FUNCTION appointment_ends_at(start_at timestamptz, minutes integer) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT start_at + minutes * interval '1 minute' $$;
--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'checked_in', 'completed', 'cancelled', 'rescheduled', 'no_show');--> statement-breakpoint
CREATE TABLE "appointment_status_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "appointment_status_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"appointment_id" uuid NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"doctor_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"reason" text,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"status_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"visit_id" uuid,
	"rescheduled_from" uuid,
	"rescheduled_to" uuid,
	"idempotency_key" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_duration_check" CHECK (duration_minutes between 5 and 240),
	CONSTRAINT "appointments_slot_check" CHECK ((extract(epoch from scheduled_at)::bigint % 300) = 0),
	CONSTRAINT "appointments_reason_length" CHECK (length(coalesce(reason, '')) <= 300 and length(coalesce(status_reason, '')) <= 300),
	CONSTRAINT "appointments_visit_link_check" CHECK ((status in ('checked_in', 'completed') and visit_id is not null) or (status in ('booked', 'rescheduled') and visit_id is null) or status in ('cancelled', 'no_show')),
	CONSTRAINT "appointments_rescheduled_check" CHECK ((status = 'rescheduled') = (rescheduled_to is not null)),
	CONSTRAINT "appointments_cancel_reason_check" CHECK (status <> 'cancelled' or length(btrim(coalesce(status_reason, ''))) > 0),
	CONSTRAINT "appointments_not_self_check" CHECK (rescheduled_from is distinct from id and rescheduled_to is distinct from id)
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"notification_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"outcome" text NOT NULL,
	"code" text,
	"actor_user_id" uuid,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_attempts_outcome_check" CHECK (outcome in ('delivered', 'undeliverable', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"dedup_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_status_check" CHECK (status in ('queued', 'delivered', 'undeliverable', 'failed')),
	CONSTRAINT "notifications_channel_check" CHECK (channel in ('in_app')),
	CONSTRAINT "notifications_delivered_check" CHECK ((status = 'delivered') = (delivered_at is not null))
);
--> statement-breakpoint
ALTER TABLE "appointment_status_events" ADD CONSTRAINT "appointment_status_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_events" ADD CONSTRAINT "appointment_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_appointments_id_fk" FOREIGN KEY ("rescheduled_from") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Deferred: a rescheduled appointment names its replacement before the replacement row is inserted.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_to_appointments_id_fk" FOREIGN KEY ("rescheduled_to") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_status_events_appointment_idx" ON "appointment_status_events" USING btree ("appointment_id","id");--> statement-breakpoint
CREATE INDEX "appointments_facility_time_idx" ON "appointments" USING btree ("facility_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_time_idx" ON "appointments" USING btree ("patient_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_doctor_time_idx" ON "appointments" USING btree ("doctor_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_idempotency_uq" ON "appointments" USING btree ("facility_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_visit_uq" ON "appointments" USING btree ("visit_id") WHERE visit_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_rescheduled_from_uq" ON "appointments" USING btree ("rescheduled_from") WHERE rescheduled_from is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempts_uq" ON "notification_attempts" USING btree ("notification_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedup_uq" ON "notifications" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "notifications_patient_idx" ON "notifications" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_appointment_idx" ON "notifications" USING btree ("appointment_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. No double booking (database-enforced). A doctor, and a patient, each hold
--    a slot while an appointment is booked or checked in; the half-open range
--    [start, end) lets back-to-back appointments touch. An appointment without
--    a doctor holds no doctor slot (department capacity is not modelled).
-- ---------------------------------------------------------------------------
ALTER TABLE appointments ADD CONSTRAINT appointments_doctor_no_overlap EXCLUDE USING gist (
  doctor_id WITH =,
  tstzrange(scheduled_at, appointment_ends_at(scheduled_at, duration_minutes), '[)') WITH &&
) WHERE (doctor_id IS NOT NULL AND status IN ('booked', 'checked_in'));
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_patient_no_overlap EXCLUDE USING gist (
  patient_id WITH =,
  tstzrange(scheduled_at, appointment_ends_at(scheduled_at, duration_minutes), '[)') WITH &&
) WHERE (status IN ('booked', 'checked_in'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Appointment state machine.
--    booked -> checked_in | cancelled | rescheduled | no_show
--    checked_in -> completed | cancelled | no_show  (only as its visit ends)
--    Closed appointments (completed, cancelled, rescheduled, no_show) are frozen.
--    Apart from its status (and the visit it joined), a row never changes:
--    moving an appointment creates a new one. Rows are never deleted.
--    The acting user must be named (adaxai.actor_id), as for visits.
--    Mirrors APPOINTMENT_TRANSITIONS in packages/contracts/src/appointments.ts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION appointment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  f text;
  t text;
  actor uuid;
  changeable text[] := ARRAY['status', 'status_reason', 'version', 'visit_id', 'rescheduled_to', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    actor := lifecycle_actor();
    IF NEW.status <> 'booked' OR NEW.visit_id IS NOT NULL OR NEW.rescheduled_to IS NOT NULL OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'an appointment starts as booked, without a visit' USING ERRCODE = 'AX006';
    END IF;
    IF actor IS NOT NULL AND NEW.created_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'an appointment is created by the acting user' USING ERRCODE = 'AX006';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = NEW.patient_id AND p.facility_id = NEW.facility_id) THEN
      RAISE EXCEPTION 'the patient is not in the appointment''s facility' USING ERRCODE = 'AX006';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = NEW.department_id AND d.facility_id = NEW.facility_id) THEN
      RAISE EXCEPTION 'the department is not in the appointment''s facility' USING ERRCODE = 'AX006';
    END IF;
    IF NEW.doctor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.doctor_id AND u.role = 'doctor' AND u.facility_id = NEW.facility_id) THEN
      RAISE EXCEPTION 'the clinician is not a doctor of the appointment''s facility' USING ERRCODE = 'AX006';
    END IF;
    IF NEW.rescheduled_from IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.appointments o
       WHERE o.id = NEW.rescheduled_from AND o.status = 'rescheduled' AND o.rescheduled_to = NEW.id
         AND o.patient_id = NEW.patient_id AND o.facility_id = NEW.facility_id
    ) THEN
      RAISE EXCEPTION 'a replacement must follow an appointment that names it as rescheduled' USING ERRCODE = 'AX006';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'cancelled', 'rescheduled', 'no_show') THEN
    RAISE EXCEPTION 'appointment % is closed (%) and cannot be changed', OLD.id, OLD.status USING ERRCODE = 'AX007';
  END IF;
  IF (to_jsonb(NEW) - changeable) IS DISTINCT FROM (to_jsonb(OLD) - changeable) THEN
    RAISE EXCEPTION 'only the status of an appointment changes; reschedule to move it' USING ERRCODE = 'AX006';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF (to_jsonb(NEW) - ARRAY['version', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version', 'updated_at']) THEN
      RAISE EXCEPTION 'an appointment changes only together with its status' USING ERRCODE = 'AX006';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM lifecycle_actor();
  f := OLD.status::text;
  t := NEW.status::text;
  IF NOT (
       (f = 'booked' AND t IN ('checked_in', 'cancelled', 'rescheduled', 'no_show'))
    OR (f = 'checked_in' AND t IN ('completed', 'cancelled', 'no_show'))
  ) THEN
    RAISE EXCEPTION 'appointment % cannot move from % to %', OLD.id, f, t USING ERRCODE = 'AX006';
  END IF;
  IF t = 'checked_in' AND NEW.visit_id IS NULL THEN
    RAISE EXCEPTION 'checking in links the appointment to its visit' USING ERRCODE = 'AX006';
  END IF;
  IF f = 'checked_in' AND NEW.visit_id IS DISTINCT FROM OLD.visit_id THEN
    RAISE EXCEPTION 'a checked-in appointment keeps its visit' USING ERRCODE = 'AX006';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER appointments_guard BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointment_guard();
--> statement-breakpoint
CREATE FUNCTION appointment_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'appointments are never deleted; cancel or reschedule instead' USING ERRCODE = 'AX007';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER appointments_no_delete BEFORE DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointment_no_delete();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Status history: every booking and status change, with the acting user,
--    the source, the reason and the time. Append-only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION appointment_status_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.appointment_status_events (appointment_id, from_status, to_status, source, reason, actor_user_id)
    VALUES (NEW.id, NULL, NEW.status,
            coalesce(lifecycle_setting('source'), CASE WHEN NEW.rescheduled_from IS NOT NULL THEN 'reschedule' ELSE 'booking' END),
            lifecycle_setting('reason'), lifecycle_actor());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.appointment_status_events (appointment_id, from_status, to_status, source, reason, actor_user_id)
    VALUES (NEW.id, OLD.status, NEW.status, coalesce(lifecycle_setting('source'), 'unspecified'),
            CASE WHEN NEW.status IN ('cancelled', 'rescheduled') THEN NEW.status_reason ELSE lifecycle_setting('reason') END,
            lifecycle_actor());
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER appointments_status_history AFTER INSERT OR UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointment_status_record();
--> statement-breakpoint
CREATE TRIGGER appointment_status_events_append_only BEFORE UPDATE OR DELETE ON appointment_status_events
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER appointment_status_events_no_truncate BEFORE TRUNCATE ON appointment_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. A checked-in appointment follows its visit to the end: completed when the
--    consultation is signed, cancelled or no_show when the visit is closed in
--    the queue. One place, so no route can forget it. The appointment's own
--    history records it with source 'visit_status'.
-- ---------------------------------------------------------------------------
CREATE FUNCTION appointment_follow_visit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  prev_source text := lifecycle_setting('source');
  target public.appointment_status;
  why text;
BEGIN
  target := (CASE NEW.status WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'no_show' END)::public.appointment_status;
  why := CASE WHEN NEW.status = 'cancelled' THEN coalesce(nullif(btrim(NEW.status_reason), ''), 'The visit was cancelled') ELSE NULL END;
  PERFORM set_config('adaxai.source', 'visit_status', true);
  UPDATE public.appointments a
     SET status = target, status_reason = why, version = a.version + 1, updated_at = now()
   WHERE a.visit_id = NEW.id AND a.status = 'checked_in';
  PERFORM set_config('adaxai.source', coalesce(prev_source, ''), true);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER visits_appointment_follow AFTER UPDATE OF status ON visits
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'cancelled', 'no_show'))
  EXECUTE FUNCTION appointment_follow_visit();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Notifications: rows are never deleted; what was queued (kind, recipient,
--    appointment, content) never changes; a delivered message stays delivered;
--    only a delivered message can be read, once. Delivery attempts are appended.
-- ---------------------------------------------------------------------------
CREATE FUNCTION notification_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  changeable text[] := ARRAY['status', 'failure_code', 'attempts', 'last_attempt_at', 'delivered_at', 'read_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notifications are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - changeable) IS DISTINCT FROM (to_jsonb(OLD) - changeable) THEN
    RAISE EXCEPTION 'a queued notification cannot be rewritten' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'delivered' AND NEW.status <> 'delivered' THEN
    RAISE EXCEPTION 'a delivered notification stays delivered' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'the attempt count only grows' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    RAISE EXCEPTION 'the delivery time is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'a notification is read once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.read_at IS NOT NULL AND NEW.status <> 'delivered' THEN
    RAISE EXCEPTION 'only a delivered notification can be read' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notifications_guard BEFORE UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notification_guard();
--> statement-breakpoint
CREATE TRIGGER notification_attempts_append_only BEFORE UPDATE OR DELETE ON notification_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER notification_attempts_no_truncate BEFORE TRUNCATE ON notification_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint

-- The application role keeps INSERT and SELECT only on the append-only tables (migration 0019 policy).
INSERT INTO meta.append_only_tables (table_name) VALUES ('appointment_status_events'), ('notification_attempts') ON CONFLICT DO NOTHING;
