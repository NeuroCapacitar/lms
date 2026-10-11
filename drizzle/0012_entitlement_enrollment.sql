-- Revisada à mão (M3-01): FKs sem o prefixo "public"; a UNIQUE (id, course_id) da oferta vem ANTES da FK composta que a usa;
-- e, no fim, os gatilhos: a âncora da matrícula é imutável e a matrícula não se apaga; o direito (entitlement) não se apaga,
-- não se reescreve (só se REVOGA) e revogado é definitivo.
CREATE TABLE "enrollment" (
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"effective_expires_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"suspended_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_pk" PRIMARY KEY("user_id","course_id"),
	CONSTRAINT "enrollment_suspension_check" CHECK ("enrollment"."suspended_at" is not null or ("enrollment"."suspended_reason" is null and "enrollment"."suspended_by" is null))
);
--> statement-breakpoint
CREATE TABLE "entitlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"offer_id" uuid,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"revoked_by" text,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_source_check" CHECK ("entitlement"."source" in ('free_offer', 'purchase', 'admin_grant')),
	CONSTRAINT "entitlement_source_ref_check" CHECK (char_length("entitlement"."source_ref") between 1 and 200),
	CONSTRAINT "entitlement_window_check" CHECK ("entitlement"."expires_at" > "entitlement"."starts_at"),
	CONSTRAINT "entitlement_offer_required_check" CHECK ("entitlement"."source" = 'admin_grant' or "entitlement"."offer_id" is not null),
	CONSTRAINT "entitlement_revocation_check" CHECK (("entitlement"."revoked_at" is null and "entitlement"."revoked_reason" is null and "entitlement"."revoked_by" is null) or ("entitlement"."revoked_at" is not null and "entitlement"."revoked_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_id_course_unique" UNIQUE("id","course_id");--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_suspended_by_user_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_enrollment_fk" FOREIGN KEY ("user_id","course_id") REFERENCES "enrollment"("user_id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_offer_fk" FOREIGN KEY ("offer_id","course_id") REFERENCES "offer"("id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollment_course_idx" ON "enrollment" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_source_ref_idx" ON "entitlement" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "entitlement_person_course_idx" ON "entitlement" USING btree ("user_id","course_id");
--> statement-breakpoint
CREATE FUNCTION enrollment_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'enrollment_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.user_id <> OLD.user_id OR NEW.course_id <> OLD.course_id THEN
		RAISE EXCEPTION 'enrollment_key_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.anchor_at <> OLD.anchor_at THEN
		RAISE EXCEPTION 'anchor_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER enrollment_guard_trg BEFORE UPDATE OR DELETE ON "enrollment" FOR EACH ROW EXECUTE FUNCTION enrollment_guard();
--> statement-breakpoint
CREATE FUNCTION entitlement_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'entitlement_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id
		OR NEW.user_id <> OLD.user_id
		OR NEW.course_id <> OLD.course_id
		OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
		OR NEW.source <> OLD.source
		OR NEW.source_ref <> OLD.source_ref
		OR NEW.starts_at <> OLD.starts_at
		OR NEW.expires_at <> OLD.expires_at
		OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'entitlement_immutable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.revoked_at IS NOT NULL
		AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
			OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
			OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) THEN
		RAISE EXCEPTION 'revoked_is_final' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER entitlement_guard_trg BEFORE UPDATE OR DELETE ON "entitlement" FOR EACH ROW EXECUTE FUNCTION entitlement_guard();
