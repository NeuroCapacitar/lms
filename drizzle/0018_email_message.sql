-- Revisada à mão (M4-04): rastro dos e-mails transacionais; sem corpo, sem destinatário em claro e sem token.
-- FK sem o prefixo "public" (o schema de teste usa search_path), como nas migrations anteriores.
CREATE TABLE "email_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"template" text NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_user_id" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"first_attempt_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_message_dedupe_key_check" CHECK (length("email_message"."dedupe_key") between 1 and 200),
	CONSTRAINT "email_message_recipient_kind_check" CHECK ("email_message"."recipient_kind" in ('user', 'support_inbox')),
	CONSTRAINT "email_message_state_check" CHECK ("email_message"."state" in ('queued', 'sending', 'accepted', 'acceptance_unknown', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'suppressed', 'blocked')),
	CONSTRAINT "email_message_variables_check" CHECK (jsonb_typeof("email_message"."variables") = 'object')
);
--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_message_dedupe_key_idx" ON "email_message" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_message_recipient_idx" ON "email_message" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_message_provider_idx" ON "email_message" USING btree ("provider_message_id");