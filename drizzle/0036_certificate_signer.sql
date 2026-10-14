CREATE TABLE "certificate_issuer" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"legal_name" text NOT NULL,
	"cnpj" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_issuer_singleton_check" CHECK ("certificate_issuer"."singleton"),
	CONSTRAINT "certificate_issuer_cnpj_check" CHECK ("certificate_issuer"."cnpj" ~ '^[0-9]{14}$'),
	CONSTRAINT "certificate_issuer_name_check" CHECK (char_length("certificate_issuer"."legal_name") between 3 and 200)
);
--> statement-breakpoint
CREATE TABLE "certificate_signatory" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"signature_media_id" uuid,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_signatory_name_check" CHECK (char_length("certificate_signatory"."name") between 2 and 120),
	CONSTRAINT "certificate_signatory_title_check" CHECK (char_length("certificate_signatory"."title") between 2 and 120)
);
--> statement-breakpoint
ALTER TABLE "media_reference" DROP CONSTRAINT "media_reference_owner_check";--> statement-breakpoint
ALTER TABLE "certificate_issuer" ADD CONSTRAINT "certificate_issuer_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signatory" ADD CONSTRAINT "certificate_signatory_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signatory" ADD CONSTRAINT "certificate_signatory_signature_media_id_media_asset_id_fk" FOREIGN KEY ("signature_media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signatory" ADD CONSTRAINT "certificate_signatory_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_reference" ADD CONSTRAINT "media_reference_owner_check" CHECK ("media_reference"."owner_type" in ('course_draft', 'course_content', 'lesson', 'panel_banner', 'login_media', 'certificate_signatory'));