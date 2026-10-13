CREATE TABLE "help_faq_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"question" text NOT NULL,
	"answer" jsonb NOT NULL,
	"position" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_faq_item_category_check" CHECK ("help_faq_item"."category" in ('conta', 'acesso', 'curso', 'certificado', 'pagamento', 'outro')),
	CONSTRAINT "help_faq_item_state_check" CHECK ("help_faq_item"."state" in ('draft', 'published')),
	CONSTRAINT "help_faq_item_question_check" CHECK (char_length("help_faq_item"."question") between 1 and 300 and "help_faq_item"."question" = btrim("help_faq_item"."question")),
	CONSTRAINT "help_faq_item_answer_size_check" CHECK (octet_length("help_faq_item"."answer"::text) <= 100000),
	CONSTRAINT "help_faq_item_position_check" CHECK ("help_faq_item"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "support_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"course_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_request_category_check" CHECK ("support_request"."category" in ('conta', 'acesso', 'curso', 'certificado', 'pagamento', 'outro')),
	CONSTRAINT "support_request_message_check" CHECK (char_length("support_request"."message") between 1 and 2000 and "support_request"."message" = btrim("support_request"."message"))
);
--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "help_faq_item_state_idx" ON "help_faq_item" USING btree ("state","position");--> statement-breakpoint
CREATE INDEX "support_request_user_idx" ON "support_request" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_request_created_idx" ON "support_request" USING btree ("created_at");