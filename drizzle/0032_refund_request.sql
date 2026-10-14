CREATE TABLE "refund_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"failure_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_request_state_check" CHECK ("refund_request"."state" in ('requested', 'submitting', 'submitted', 'unknown', 'awaiting_external_authorization', 'done', 'failed')),
	CONSTRAINT "refund_request_reason_check" CHECK (char_length("refund_request"."reason") between 5 and 500),
	CONSTRAINT "refund_request_done_check" CHECK (("refund_request"."state" = 'done') = ("refund_request"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_request_active_idx" ON "refund_request" USING btree ("order_id") WHERE "refund_request"."state" not in ('done', 'failed');--> statement-breakpoint
CREATE INDEX "refund_request_state_idx" ON "refund_request" USING btree ("state","created_at");
--> statement-breakpoint
CREATE FUNCTION refund_request_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'refund_request_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id
		OR NEW.order_id <> OLD.order_id
		OR NEW.payment_id <> OLD.payment_id
		OR NEW.requested_by <> OLD.requested_by
		OR NEW.reason <> OLD.reason
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'refund_request_identity_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.state = 'done' AND NEW.state <> 'done' THEN
		RAISE EXCEPTION 'refund_request_done_is_final' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER refund_request_guard_trg BEFORE UPDATE OR DELETE ON "refund_request" FOR EACH ROW EXECUTE FUNCTION refund_request_guard();
