-- Revisada à mão: FKs sem o prefixo "public". Convite de Staff (M1-04): token só em hash, e-mail em minúsculas, um convite pendente por e-mail, grants iniciais só delegáveis.
CREATE TABLE "staff_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'support' NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" text,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitation_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "staff_invitation_role_check" CHECK ("staff_invitation"."role" = 'support'),
	CONSTRAINT "staff_invitation_status_check" CHECK ("staff_invitation"."status" in ('pending', 'accepted', 'revoked')),
	CONSTRAINT "staff_invitation_email_lower_check" CHECK ("staff_invitation"."email" = lower("staff_invitation"."email"))
);
--> statement-breakpoint
CREATE TABLE "staff_invitation_grant" (
	"invitation_id" uuid NOT NULL,
	"capability" text NOT NULL,
	CONSTRAINT "staff_invitation_grant_invitation_id_capability_pk" PRIMARY KEY("invitation_id","capability"),
	CONSTRAINT "staff_invitation_grant_capability_check" CHECK ("staff_invitation_grant"."capability" in ('course.edit', 'access.grant', 'enrollment.support_edit', 'refund.execute', 'finance.review', 'finance.view', 'certificate.reissue', 'discussion.moderate', 'help.edit', 'audit.view', 'ops.queue'))
);
--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation_grant" ADD CONSTRAINT "staff_invitation_grant_invitation_id_staff_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "staff_invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitation_pending_email_idx" ON "staff_invitation" USING btree ("email") WHERE "staff_invitation"."status" = 'pending';