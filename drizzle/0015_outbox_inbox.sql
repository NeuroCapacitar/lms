-- Revisada à mão (M4-01): outbox (intenções) e inbox (eventos externos) em Postgres, a fonte da verdade (ADR 0006).
-- Lease por linha com fencing (`lease_version`); os CHECKs impedem estado de lease incoerente e payload fora do contrato.
CREATE TABLE "inbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"correlation_id" text NOT NULL,
	"last_error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "inbox_event_provider_check" CHECK ("inbox_event"."provider" in ('asaas', 'resend')),
	CONSTRAINT "inbox_event_event_id_check" CHECK (length("inbox_event"."event_id") between 1 and 200),
	CONSTRAINT "inbox_event_state_check" CHECK ("inbox_event"."state" in ('pending', 'leased', 'delivered', 'failed', 'dead', 'superseded')),
	CONSTRAINT "inbox_event_attempts_check" CHECK ("inbox_event"."attempts" >= 0),
	CONSTRAINT "inbox_event_correlation_check" CHECK (length("inbox_event"."correlation_id") between 1 and 100),
	CONSTRAINT "inbox_event_lease_check" CHECK (("inbox_event"."state" = 'leased') = ("inbox_event"."lease_owner" is not null and "inbox_event"."lease_until" is not null)),
	CONSTRAINT "inbox_event_finished_check" CHECK (("inbox_event"."state" in ('delivered', 'failed', 'dead', 'superseded')) = ("inbox_event"."finished_at" is not null)),
	CONSTRAINT "inbox_event_payload_check" CHECK (jsonb_typeof("inbox_event"."payload") = 'object'),
	CONSTRAINT "inbox_event_payload_size_check" CHECK (octet_length("inbox_event"."payload"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "outbox_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"queue" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"correlation_id" text NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "outbox_message_kind_check" CHECK (length("outbox_message"."kind") between 1 and 100),
	CONSTRAINT "outbox_message_queue_check" CHECK ("outbox_message"."queue" in ('finance', 'general')),
	CONSTRAINT "outbox_message_dedupe_key_check" CHECK (length("outbox_message"."dedupe_key") between 1 and 200),
	CONSTRAINT "outbox_message_state_check" CHECK ("outbox_message"."state" in ('pending', 'leased', 'delivered', 'failed', 'dead', 'superseded')),
	CONSTRAINT "outbox_message_attempts_check" CHECK ("outbox_message"."attempts" >= 0),
	CONSTRAINT "outbox_message_correlation_check" CHECK (length("outbox_message"."correlation_id") between 1 and 100),
	CONSTRAINT "outbox_message_lease_check" CHECK (("outbox_message"."state" = 'leased') = ("outbox_message"."lease_owner" is not null and "outbox_message"."lease_until" is not null)),
	CONSTRAINT "outbox_message_finished_check" CHECK (("outbox_message"."state" in ('delivered', 'failed', 'dead', 'superseded')) = ("outbox_message"."finished_at" is not null)),
	CONSTRAINT "outbox_message_payload_check" CHECK (jsonb_typeof("outbox_message"."payload") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_event_provider_event_idx" ON "inbox_event" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "inbox_event_claimable_idx" ON "inbox_event" USING btree ("available_at") WHERE "inbox_event"."state" in ('pending', 'leased');--> statement-breakpoint
CREATE INDEX "inbox_event_finished_idx" ON "inbox_event" USING btree ("state","finished_at") WHERE "inbox_event"."finished_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_message_dedupe_key_idx" ON "outbox_message" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_message_claimable_idx" ON "outbox_message" USING btree ("priority","available_at") WHERE "outbox_message"."state" in ('pending', 'leased');--> statement-breakpoint
CREATE INDEX "outbox_message_finished_idx" ON "outbox_message" USING btree ("state","finished_at") WHERE "outbox_message"."finished_at" is not null;