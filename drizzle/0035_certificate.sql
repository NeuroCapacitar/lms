CREATE TABLE "certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"pdf_key" text,
	"pdf_sha256" text,
	"predecessor_id" uuid,
	"render_attempts" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_status_check" CHECK ("certificate"."status" in ('awaiting_name', 'queued', 'rendering', 'ready', 'failed', 'revoked', 'superseded')),
	CONSTRAINT "certificate_code_check" CHECK ("certificate"."code" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "certificate_pdf_check" CHECK (("certificate"."pdf_key" is null) = ("certificate"."pdf_sha256" is null) and ("certificate"."status" <> 'ready' or "certificate"."pdf_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "certificate_policy" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_completion_fk" FOREIGN KEY ("user_id","course_id") REFERENCES "course_completion"("user_id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_predecessor_fk" FOREIGN KEY ("predecessor_id") REFERENCES "certificate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_policy" ADD CONSTRAINT "certificate_policy_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_code_idx" ON "certificate" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_original_idx" ON "certificate" USING btree ("user_id","course_id") WHERE "certificate"."predecessor_id" is null;--> statement-breakpoint
CREATE INDEX "certificate_status_idx" ON "certificate" USING btree ("status","created_at");
--> statement-breakpoint
CREATE FUNCTION certificate_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'certificate_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id
		OR NEW.user_id <> OLD.user_id
		OR NEW.course_id <> OLD.course_id
		OR NEW.code <> OLD.code
		OR NEW.predecessor_id IS DISTINCT FROM OLD.predecessor_id
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'certificate_identity_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status <> 'awaiting_name' AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
		RAISE EXCEPTION 'certificate_snapshot_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.pdf_key IS NOT NULL AND (NEW.pdf_key IS DISTINCT FROM OLD.pdf_key OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
		RAISE EXCEPTION 'certificate_pdf_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status IN ('revoked', 'superseded') AND NEW.status <> OLD.status THEN
		RAISE EXCEPTION 'certificate_status_final' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status = 'ready' AND NEW.status NOT IN ('ready', 'revoked', 'superseded') THEN
		RAISE EXCEPTION 'certificate_ready_is_final' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER certificate_guard_trg BEFORE UPDATE OR DELETE ON "certificate" FOR EACH ROW EXECUTE FUNCTION certificate_guard();
