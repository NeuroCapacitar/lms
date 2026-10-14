ALTER TABLE "purchase_order" ADD COLUMN "reconcile_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "reconcile_next_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "purchase_order_reconcile_idx" ON "purchase_order" USING btree ("reconcile_next_at") WHERE "purchase_order"."status" = 'pending';