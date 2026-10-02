ALTER TABLE "audit_events" ADD COLUMN "facility_id" uuid;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "withdraw_reason" text;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "withdrawn_via" text;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_superseded_by_consents_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "audit_events_facility_idx" ON "audit_events" USING btree ("facility_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_one_active_ongoing_uq" ON "consents" USING btree ("patient_id","type") WHERE status = 'granted' and scope = 'ongoing';--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_status_check" CHECK ("consents"."status" in ('granted', 'withdrawn', 'superseded'));--> statement-breakpoint
-- A consent record is never deleted or rewritten. A granted consent ends once:
-- withdrawn (who, when, why, how) or superseded by a renewal under newer wording.
CREATE FUNCTION consent_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  end_cols text[] := ARRAY['status', 'withdrawn_at', 'withdrawn_by', 'withdraw_reason', 'withdrawn_via', 'superseded_by'];
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'granted' OR NEW.status NOT IN ('withdrawn', 'superseded')
     OR (to_jsonb(NEW) - end_cols) IS DISTINCT FROM (to_jsonb(OLD) - end_cols) THEN
    RAISE EXCEPTION 'consent records can only be ended once (withdrawn or superseded)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consents_guard BEFORE UPDATE OR DELETE ON consents
  FOR EACH ROW EXECUTE FUNCTION consent_guard();
