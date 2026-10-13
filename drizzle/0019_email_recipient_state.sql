-- Revisada à mão (M4-07): supressão por destinatário, chave = HMAC do endereço normalizado (nunca o endereço).
CREATE TABLE "email_recipient_state" (
	"recipient_hash" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'suppressed' NOT NULL,
	"reason" text NOT NULL,
	"source_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_recipient_state_hash_check" CHECK ("email_recipient_state"."recipient_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_recipient_state_state_check" CHECK ("email_recipient_state"."state" = 'suppressed'),
	CONSTRAINT "email_recipient_state_reason_check" CHECK ("email_recipient_state"."reason" in ('hard_bounce', 'complaint'))
);
