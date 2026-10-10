-- Revisada à mão: FKs sem o prefixo "public" e, no fim, os gatilhos que tornam audit_log APPEND-ONLY (UPDATE, DELETE e TRUNCATE recusados).
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_grant" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_grant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"capability" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "staff_grant_capability_check" CHECK ("staff_grant"."capability" in ('course.edit', 'access.grant', 'enrollment.support_edit', 'refund.execute', 'finance.review', 'finance.view', 'certificate.reissue', 'discussion.moderate', 'help.edit', 'audit.view', 'ops.queue'))
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_role_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "user_role_role_check" CHECK ("user_role"."role" in ('support', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "user_suspension" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_suspension_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"suspended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_by" text,
	"reason" text,
	"lifted_at" timestamp with time zone,
	"lifted_by" text
);
--> statement-breakpoint
ALTER TABLE "staff_grant" ADD CONSTRAINT "staff_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_grant" ADD CONSTRAINT "staff_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_grant" ADD CONSTRAINT "staff_grant_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_suspension" ADD CONSTRAINT "user_suspension_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_suspension" ADD CONSTRAINT "user_suspension_suspended_by_user_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_suspension" ADD CONSTRAINT "user_suspension_lifted_by_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_grant_active_idx" ON "staff_grant" USING btree ("user_id","capability") WHERE "staff_grant"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_active_idx" ON "user_role" USING btree ("user_id","role") WHERE "user_role"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_suspension_active_idx" ON "user_suspension" USING btree ("user_id") WHERE "user_suspension"."lifted_at" is null;--> statement-breakpoint
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log é append-only: % recusado', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
