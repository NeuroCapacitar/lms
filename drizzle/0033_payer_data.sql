ALTER TABLE "payment" ADD COLUMN "payer_document_ciphertext" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "payer_document_nonce" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "payer_document_key_version" integer;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "payer_document_masked" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "payer_info_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_payer_document_check" CHECK (("payment"."payer_document_ciphertext" is null and "payment"."payer_document_nonce" is null and "payment"."payer_document_key_version" is null and "payment"."payer_document_masked" is null) or ("payment"."payer_document_ciphertext" is not null and "payment"."payer_document_nonce" is not null and "payment"."payer_document_key_version" is not null and "payment"."payer_document_masked" is not null));