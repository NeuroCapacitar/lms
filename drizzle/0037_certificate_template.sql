CREATE TABLE "certificate_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"layout" jsonb NOT NULL,
	"background_media_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_template_status_check" CHECK ("certificate_template"."status" in ('draft', 'published', 'superseded')),
	CONSTRAINT "certificate_template_published_check" CHECK (("certificate_template"."status" = 'draft') = ("certificate_template"."published_at" is null)),
	CONSTRAINT "certificate_template_version_check" CHECK ("certificate_template"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "media_reference" DROP CONSTRAINT "media_reference_owner_check";--> statement-breakpoint
ALTER TABLE "certificate_template" ADD CONSTRAINT "certificate_template_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template" ADD CONSTRAINT "certificate_template_background_media_id_media_asset_id_fk" FOREIGN KEY ("background_media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template" ADD CONSTRAINT "certificate_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_template_draft_idx" ON "certificate_template" USING btree ("course_id") WHERE "certificate_template"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_template_published_idx" ON "certificate_template" USING btree ("course_id") WHERE "certificate_template"."status" = 'published';--> statement-breakpoint
ALTER TABLE "media_reference" ADD CONSTRAINT "media_reference_owner_check" CHECK ("media_reference"."owner_type" in ('course_draft', 'course_content', 'lesson', 'panel_banner', 'login_media', 'certificate_signatory', 'certificate_template'));
--> statement-breakpoint
CREATE FUNCTION certificate_template_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status <> 'draft' THEN
			RAISE EXCEPTION 'certificate_template_not_deletable' USING ERRCODE = 'restrict_violation';
		END IF;
		RETURN OLD;
	END IF;
	IF NEW.id <> OLD.id OR NEW.course_id <> OLD.course_id OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'certificate_template_identity_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status <> 'draft' AND (NEW.layout IS DISTINCT FROM OLD.layout OR NEW.background_media_id IS DISTINCT FROM OLD.background_media_id OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
		RAISE EXCEPTION 'certificate_template_frozen' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.status <> OLD.status AND NOT ((OLD.status = 'draft' AND NEW.status = 'published') OR (OLD.status = 'published' AND NEW.status = 'superseded')) THEN
		RAISE EXCEPTION 'certificate_template_status_final' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER certificate_template_guard_trg BEFORE UPDATE OR DELETE ON "certificate_template" FOR EACH ROW EXECUTE FUNCTION certificate_template_guard();
