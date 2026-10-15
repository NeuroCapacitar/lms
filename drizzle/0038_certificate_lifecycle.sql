ALTER TABLE "certificate" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "revoked_by" text;--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "revocation_category" text;--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "revocation_note" text;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_successor_idx" ON "certificate" USING btree ("predecessor_id") WHERE "certificate"."predecessor_id" is not null;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_revoked_check" CHECK (("certificate"."status" = 'revoked') = ("certificate"."revoked_at" is not null));