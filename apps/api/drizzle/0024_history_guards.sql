-- Slice V1, after review of 0023 (which had already been applied to the development database, so it is not edited).
-- Additive and idempotent in effect: it replaces one trigger function and adds three triggers. No data is changed.

-- 1. A medicine that is marked as entered in error keeps the stop date it had: the error reason may replace the explanation
--    (the history event keeps the stop reason), but the date is part of what was recorded. Also true of a medicine that was
--    never stopped: no date can appear on its way to "entered in error".
CREATE OR REPLACE FUNCTION patient_medications_guard() RETURNS trigger
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
  IF NEW.status = 'entered_in_error' AND NEW.stopped_on IS DISTINCT FROM OLD.stopped_on THEN
    RAISE EXCEPTION 'The stop date of a medicine cannot change when it is marked as entered in error' USING ERRCODE = 'AX008';
  END IF;
  -- A stopped medicine is not restarted (enter a new one) and its stop details do not change; it can only be marked as an error.
  IF OLD.status = 'stopped' AND (NEW.status NOT IN ('stopped', 'entered_in_error') OR (NEW.status = 'stopped' AND (NEW.stopped_on IS DISTINCT FROM OLD.stopped_on OR NEW.status_reason IS DISTINCT FROM OLD.status_reason))) THEN
    RAISE EXCEPTION 'A stopped medicine cannot be restarted or changed; enter a new one' USING ERRCODE = 'AX008';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- 2. "Never deleted" also means the tables cannot be emptied (the application role has no TRUNCATE privilege; this covers the
--    owner and the superuser too, except under session_replication_role = replica, which the test reset uses on disposable databases).
CREATE TRIGGER patient_conditions_no_truncate BEFORE TRUNCATE ON patient_conditions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER patient_medications_no_truncate BEFORE TRUNCATE ON patient_medications
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
--> statement-breakpoint
CREATE TRIGGER investigation_results_no_truncate BEFORE TRUNCATE ON investigation_results
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change_append_only();
