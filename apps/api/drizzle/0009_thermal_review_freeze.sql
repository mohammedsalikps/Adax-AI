-- Once a doctor has reviewed (approved or rejected) a thermal capture, the
-- capture and its regions of interest are frozen. The only permitted change
-- to a capture is the review itself: draft -> approved/rejected.
CREATE FUNCTION thermal_capture_reject_if_reviewed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'thermal capture % has been reviewed and cannot be changed', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER thermal_captures_frozen_after_review
  BEFORE UPDATE OR DELETE ON thermal_captures
  FOR EACH ROW EXECUTE FUNCTION thermal_capture_reject_if_reviewed();
--> statement-breakpoint
CREATE FUNCTION thermal_roi_reject_if_reviewed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM thermal_captures
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.capture_id ELSE NEW.capture_id END;
  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'thermal capture has been reviewed; its regions cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER thermal_rois_frozen_after_review
  BEFORE INSERT OR UPDATE OR DELETE ON thermal_rois
  FOR EACH ROW EXECUTE FUNCTION thermal_roi_reject_if_reviewed();
