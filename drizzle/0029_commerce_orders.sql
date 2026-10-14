CREATE TABLE "checkout_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"state" text DEFAULT 'creating' NOT NULL,
	"provider_session_id" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_session_providerSessionId_unique" UNIQUE("provider_session_id"),
	CONSTRAINT "checkout_session_state_check" CHECK ("checkout_session"."state" in ('creating', 'open', 'unknown', 'failed', 'expired', 'completed')),
	CONSTRAINT "checkout_session_open_check" CHECK ("checkout_session"."state" <> 'open' or ("checkout_session"."provider_session_id" is not null and "checkout_session"."checkout_url" is not null)),
	CONSTRAINT "checkout_session_url_check" CHECK ("checkout_session"."checkout_url" is null or ("checkout_session"."checkout_url" like 'https://%' and char_length("checkout_session"."checkout_url") <= 2048))
);
--> statement-breakpoint
CREATE TABLE "financial_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"payment_id" uuid,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"provider_event_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_event_kind_check" CHECK (char_length("financial_event"."kind") between 1 and 80),
	CONSTRAINT "financial_event_source_check" CHECK ("financial_event"."source" in ('webhook', 'reconciliation', 'api', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"checkout_session_id" uuid,
	"provider" text DEFAULT 'asaas' NOT NULL,
	"provider_payment_id" text NOT NULL,
	"installment_id" text,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider_status" text NOT NULL,
	"paid_at" timestamp with time zone,
	"payer_name" text,
	"payer_document" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_payment_unique" UNIQUE("provider","provider_payment_id"),
	CONSTRAINT "payment_provider_check" CHECK ("payment"."provider" = 'asaas'),
	CONSTRAINT "payment_method_check" CHECK ("payment"."method" in ('pix', 'card')),
	CONSTRAINT "payment_amount_check" CHECK ("payment"."amount_cents" > 0),
	CONSTRAINT "payment_provider_payment_id_check" CHECK (char_length("payment"."provider_payment_id") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"offer_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"course_title" text NOT NULL,
	"offer_name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"access_months" integer NOT NULL,
	"max_installments" integer NOT NULL,
	"payment_methods" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_user_attempt_unique" UNIQUE("user_id","attempt_id"),
	CONSTRAINT "purchase_order_status_check" CHECK ("purchase_order"."status" in ('pending', 'paid', 'expired', 'canceled', 'refund_requested', 'refunded', 'disputed', 'review')),
	CONSTRAINT "purchase_order_currency_check" CHECK ("purchase_order"."currency" = 'BRL'),
	CONSTRAINT "purchase_order_price_check" CHECK ("purchase_order"."price_cents" >= 1000),
	CONSTRAINT "purchase_order_access_months_check" CHECK ("purchase_order"."access_months" between 1 and 600),
	CONSTRAINT "purchase_order_installments_check" CHECK ("purchase_order"."max_installments" between 1 and 12 and "purchase_order"."max_installments" <= "purchase_order"."price_cents" / 1000),
	CONSTRAINT "purchase_order_methods_check" CHECK (cardinality("purchase_order"."payment_methods") >= 1 and "purchase_order"."payment_methods" <@ array['pix', 'card']::text[]),
	CONSTRAINT "purchase_order_snapshot_text_check" CHECK (char_length(btrim("purchase_order"."course_title")) >= 1 and char_length(btrim("purchase_order"."offer_name")) >= 1)
);
--> statement-breakpoint
ALTER TABLE "checkout_session" ADD CONSTRAINT "checkout_session_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_event" ADD CONSTRAINT "financial_event_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_event" ADD CONSTRAINT "financial_event_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_checkout_session_id_checkout_session_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_offer_course_fk" FOREIGN KEY ("offer_id","course_id") REFERENCES "offer"("id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_session_active_idx" ON "checkout_session" USING btree ("order_id") WHERE "checkout_session"."state" in ('creating', 'open', 'unknown');--> statement-breakpoint
CREATE INDEX "checkout_session_state_expires_idx" ON "checkout_session" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_event_evidence_idx" ON "financial_event" USING btree ("kind","provider_event_id") WHERE "financial_event"."provider_event_id" is not null;--> statement-breakpoint
CREATE INDEX "financial_event_order_idx" ON "financial_event" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "financial_event_payment_idx" ON "financial_event" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_order_idx" ON "payment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_user_status_idx" ON "purchase_order" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "purchase_order_status_expires_idx" ON "purchase_order" USING btree ("status","expires_at");--> statement-breakpoint
CREATE FUNCTION purchase_order_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'purchase_order_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id
		OR NEW.user_id <> OLD.user_id
		OR NEW.offer_id <> OLD.offer_id
		OR NEW.course_id <> OLD.course_id
		OR NEW.attempt_id <> OLD.attempt_id
		OR NEW.course_title <> OLD.course_title
		OR NEW.offer_name <> OLD.offer_name
		OR NEW.price_cents <> OLD.price_cents
		OR NEW.currency <> OLD.currency
		OR NEW.access_months <> OLD.access_months
		OR NEW.max_installments <> OLD.max_installments
		OR NEW.payment_methods <> OLD.payment_methods
		OR NEW.expires_at <> OLD.expires_at
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'order_snapshot_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
		RAISE EXCEPTION 'order_refunded_is_final' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER purchase_order_guard_trg BEFORE UPDATE OR DELETE ON "purchase_order" FOR EACH ROW EXECUTE FUNCTION purchase_order_guard();
--> statement-breakpoint
CREATE FUNCTION checkout_session_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'checkout_session_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id OR NEW.order_id <> OLD.order_id OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'checkout_session_key_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER checkout_session_guard_trg BEFORE UPDATE OR DELETE ON "checkout_session" FOR EACH ROW EXECUTE FUNCTION checkout_session_guard();
--> statement-breakpoint
CREATE FUNCTION payment_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'payment_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id
		OR NEW.order_id <> OLD.order_id
		OR NEW.provider <> OLD.provider
		OR NEW.provider_payment_id <> OLD.provider_payment_id
		OR NEW.method <> OLD.method
		OR NEW.amount_cents <> OLD.amount_cents
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'payment_identity_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_guard_trg BEFORE UPDATE OR DELETE ON "payment" FOR EACH ROW EXECUTE FUNCTION payment_guard();
--> statement-breakpoint
CREATE FUNCTION financial_event_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'financial_event é append-only: % recusado', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER financial_event_no_update_delete BEFORE UPDATE OR DELETE ON "financial_event" FOR EACH ROW EXECUTE FUNCTION financial_event_append_only();
