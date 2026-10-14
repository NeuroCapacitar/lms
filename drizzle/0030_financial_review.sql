CREATE TABLE "financial_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"provider_payment_id" text,
	"type" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_review_type_check" CHECK ("financial_review"."type" in ('amount_mismatch', 'terminal_conflict', 'event_anomaly', 'partial_refund', 'uncertain_result', 'unknown_checkout', 'duplicate_purchase')),
	CONSTRAINT "financial_review_state_check" CHECK ("financial_review"."state" in ('open', 'resolved')),
	CONSTRAINT "financial_review_resolved_check" CHECK (("financial_review"."state" = 'open' and "financial_review"."resolved_at" is null) or ("financial_review"."state" = 'resolved' and "financial_review"."resolved_at" is not null and "financial_review"."resolution" is not null))
);
--> statement-breakpoint
ALTER TABLE "financial_review" ADD CONSTRAINT "financial_review_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_review" ADD CONSTRAINT "financial_review_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_review_open_idx" ON "financial_review" USING btree ("type",coalesce("provider_payment_id", ''),coalesce("order_id"::text, '')) WHERE "financial_review"."state" = 'open';--> statement-breakpoint
CREATE INDEX "financial_review_state_idx" ON "financial_review" USING btree ("state","created_at");