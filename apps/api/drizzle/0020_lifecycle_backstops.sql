-- Slice 3 review follow-ups. Additive: no existing row is changed.

-- 1. While the patient is with the doctor, the visit's department and doctor do
--    not change: the consultation's author is fixed (the API refuses first).
--    Moving into or out of "with doctor" (start, resume, sign, discard) is not
--    affected.
CREATE FUNCTION visit_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status = 'in_consultation' AND NEW.status = 'in_consultation'
     AND (NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.assigned_doctor_id IS DISTINCT FROM OLD.assigned_doctor_id) THEN
    RAISE EXCEPTION 'visit % is with the doctor; its department and doctor cannot change now', OLD.id USING ERRCODE = 'AX005';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER visits_assignment_guard BEFORE UPDATE OF department_id, assigned_doctor_id ON visits
  FOR EACH ROW EXECUTE FUNCTION visit_assignment_guard();
--> statement-breakpoint

-- 2. Stethoscope recordings are append-only by trigger (migration 0014); the
--    application role loses UPDATE, DELETE and TRUNCATE on them too.
INSERT INTO meta.append_only_tables (table_name) VALUES ('auscultation_recordings') ON CONFLICT DO NOTHING;
