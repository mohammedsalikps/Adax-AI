-- Clinical record integrity, enforced in the database (defence in depth: the
-- API checks these rules too, but even the application role cannot bypass
-- them because it does not own the tables or their triggers).

-- 1. A signed encounter can never be updated or deleted.
CREATE FUNCTION encounter_reject_if_signed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'encounter % is signed and cannot be changed; add an amendment instead', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER encounters_immutable_when_signed
  BEFORE UPDATE OR DELETE ON encounters
  FOR EACH ROW EXECUTE FUNCTION encounter_reject_if_signed();
--> statement-breakpoint

-- 2. Diagnoses and prescription items of a signed encounter are frozen too.
CREATE FUNCTION encounter_child_reject_if_signed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status encounter_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO parent_status FROM encounters WHERE id = OLD.encounter_id;
    IF parent_status = 'signed' THEN
      RAISE EXCEPTION 'encounter % is signed; its % cannot be changed', OLD.encounter_id, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO parent_status FROM encounters WHERE id = NEW.encounter_id;
    IF parent_status = 'signed' THEN
      RAISE EXCEPTION 'encounter % is signed; its % cannot be changed', NEW.encounter_id, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER diagnoses_frozen_when_signed
  BEFORE INSERT OR UPDATE OR DELETE ON diagnoses
  FOR EACH ROW EXECUTE FUNCTION encounter_child_reject_if_signed();
--> statement-breakpoint
CREATE TRIGGER prescription_items_frozen_when_signed
  BEFORE INSERT OR UPDATE OR DELETE ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION encounter_child_reject_if_signed();
--> statement-breakpoint

-- 3. Amendments are append-only.
CREATE FUNCTION amendments_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'encounter_amendments is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER encounter_amendments_append_only
  BEFORE UPDATE OR DELETE ON encounter_amendments
  FOR EACH ROW EXECUTE FUNCTION amendments_reject_change();
--> statement-breakpoint
CREATE TRIGGER encounter_amendments_no_truncate
  BEFORE TRUNCATE ON encounter_amendments
  FOR EACH STATEMENT EXECUTE FUNCTION amendments_reject_change();
--> statement-breakpoint
CREATE TRIGGER encounters_no_truncate
  BEFORE TRUNCATE ON encounters
  FOR EACH STATEMENT EXECUTE FUNCTION amendments_reject_change();
--> statement-breakpoint

-- 4. Foreign keys that could not be declared earlier (tables now exist).
ALTER TABLE users ADD CONSTRAINT users_patient_id_patients_id_fk
  FOREIGN KEY (patient_id) REFERENCES patients(id);
--> statement-breakpoint
CREATE UNIQUE INDEX users_patient_id_uq ON users (patient_id) WHERE patient_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consents_encounter_id_encounters_id_fk
  FOREIGN KEY (encounter_id) REFERENCES encounters(id);
