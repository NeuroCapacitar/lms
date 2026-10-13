-- Revisada à mão (M4-08): livro-razão da cota do Resend (por dia UTC) e o dia reservado em email_message.
CREATE TABLE "email_send_ledger" (
	"day" date PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_send_ledger_count_check" CHECK ("email_send_ledger"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "quota_reserved_day" date;