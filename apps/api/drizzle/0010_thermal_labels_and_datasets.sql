CREATE TABLE "thermal_dataset_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"summary" jsonb NOT NULL,
	"evaluation" jsonb,
	"evaluation_markdown" text,
	"evaluated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermal_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"roi_label" text,
	"code" text NOT NULL,
	"reference_standard" text NOT NULL,
	"certainty" text NOT NULL,
	"note" text,
	"taxonomy_version" text NOT NULL,
	"labelled_by" uuid NOT NULL,
	"labelled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdraw_reason" text,
	CONSTRAINT "thermal_labels_scope_check" CHECK (("thermal_labels"."scope" = 'capture' and "thermal_labels"."roi_label" is null) or ("thermal_labels"."scope" = 'roi' and "thermal_labels"."roi_label" is not null))
);
--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD COLUMN "data_origin" text DEFAULT 'synthetic' NOT NULL;--> statement-breakpoint
ALTER TABLE "thermal_dataset_exports" ADD CONSTRAINT "thermal_dataset_exports_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_dataset_exports" ADD CONSTRAINT "thermal_dataset_exports_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_dataset_exports" ADD CONSTRAINT "thermal_dataset_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_labels" ADD CONSTRAINT "thermal_labels_capture_id_thermal_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."thermal_captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_labels" ADD CONSTRAINT "thermal_labels_labelled_by_users_id_fk" FOREIGN KEY ("labelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_labels" ADD CONSTRAINT "thermal_labels_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thermal_labels_capture_idx" ON "thermal_labels" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thermal_labels_one_active_per_rater" ON "thermal_labels" USING btree ("capture_id","labelled_by",coalesce(lower("roi_label"), '')) WHERE "thermal_labels"."withdrawn_at" is null;--> statement-breakpoint
ALTER TABLE "thermal_captures" ADD CONSTRAINT "thermal_captures_data_origin_check" CHECK ("thermal_captures"."data_origin" in ('clinical', 'synthetic', 'public_sample'));--> statement-breakpoint
-- Labels only on approved captures; once written, a label's content never
-- changes and it is never deleted. The single permitted change is withdrawal
-- (once, with who, when and why).
CREATE FUNCTION thermal_label_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'thermal labels cannot be deleted; withdraw instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status FROM thermal_captures WHERE id = NEW.capture_id;
    IF parent_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'only approved thermal captures can be labelled'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new label cannot be withdrawn already'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only a first withdrawal, with all three withdrawal fields.
  IF OLD.withdrawn_at IS NOT NULL
     OR NEW.withdrawn_at IS NULL OR NEW.withdrawn_by IS NULL OR coalesce(NEW.withdraw_reason, '') = ''
     OR (NEW.id, NEW.capture_id, NEW.scope, NEW.roi_label, NEW.code, NEW.reference_standard, NEW.certainty,
         NEW.note, NEW.taxonomy_version, NEW.labelled_by, NEW.labelled_at)
        IS DISTINCT FROM
        (OLD.id, OLD.capture_id, OLD.scope, OLD.roi_label, OLD.code, OLD.reference_standard, OLD.certainty,
         OLD.note, OLD.taxonomy_version, OLD.labelled_by, OLD.labelled_at) THEN
    RAISE EXCEPTION 'thermal labels are immutable; only a single withdrawal is allowed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER thermal_labels_guard
  BEFORE INSERT OR UPDATE OR DELETE ON thermal_labels
  FOR EACH ROW EXECUTE FUNCTION thermal_label_guard();
--> statement-breakpoint
-- Dataset exports are a record of what left the system: never deleted, and
-- only the evaluation report may be (re)attached.
CREATE FUNCTION thermal_dataset_export_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (NEW.id, NEW.facility_id, NEW.file_id, NEW.summary, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.facility_id, OLD.file_id, OLD.summary, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'dataset export records cannot be changed or deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER thermal_dataset_exports_guard
  BEFORE UPDATE OR DELETE ON thermal_dataset_exports
  FOR EACH ROW EXECUTE FUNCTION thermal_dataset_export_guard();
