CREATE TABLE "media_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"visibility" text NOT NULL,
	"state" text DEFAULT 'pending_upload' NOT NULL,
	"declared_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"content_type" text,
	"size" integer,
	"width" integer,
	"height" integer,
	"sha256" text,
	"storage_key" text NOT NULL,
	"public_key" text,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"rejected_reason" text,
	"deleted_at" timestamp with time zone,
	"storage_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_storageKey_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_asset_purpose_check" CHECK ("media_asset"."purpose" in ('course_cover', 'course_banner', 'lesson_material', 'certificate_asset')),
	CONSTRAINT "media_asset_visibility_check" CHECK ("media_asset"."visibility" in ('public', 'private')),
	CONSTRAINT "media_asset_state_check" CHECK ("media_asset"."state" in ('pending_upload', 'ready', 'rejected', 'deleted')),
	CONSTRAINT "media_asset_ready_check" CHECK ("media_asset"."state" <> 'ready' or ("media_asset"."sha256" is not null and "media_asset"."size" is not null and "media_asset"."content_type" is not null and "media_asset"."confirmed_at" is not null)),
	CONSTRAINT "media_asset_public_key_check" CHECK ("media_asset"."public_key" is null or "media_asset"."visibility" = 'public'),
	CONSTRAINT "media_asset_size_check" CHECK ("media_asset"."declared_size" > 0 and ("media_asset"."size" is null or "media_asset"."size" > 0))
);
--> statement-breakpoint
CREATE TABLE "media_reference" (
	"media_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"slot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_reference_pk" PRIMARY KEY("owner_type","owner_id","slot"),
	CONSTRAINT "media_reference_owner_check" CHECK ("media_reference"."owner_type" in ('course_draft', 'course_content', 'lesson'))
);
--> statement-breakpoint
ALTER TABLE "course_content" ADD COLUMN "cover_media_id" uuid;--> statement-breakpoint
ALTER TABLE "course_content" ADD COLUMN "banner_media_id" uuid;--> statement-breakpoint
ALTER TABLE "course_draft" ADD COLUMN "cover_media_id" uuid;--> statement-breakpoint
ALTER TABLE "course_draft" ADD COLUMN "banner_media_id" uuid;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_reference" ADD CONSTRAINT "media_reference_media_id_media_asset_id_fk" FOREIGN KEY ("media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_asset_state_idx" ON "media_asset" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "media_reference_media_idx" ON "media_reference" USING btree ("media_id");--> statement-breakpoint
ALTER TABLE "course_content" ADD CONSTRAINT "course_content_cover_media_id_media_asset_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_content" ADD CONSTRAINT "course_content_banner_media_id_media_asset_id_fk" FOREIGN KEY ("banner_media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_draft" ADD CONSTRAINT "course_draft_cover_media_id_media_asset_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_draft" ADD CONSTRAINT "course_draft_banner_media_id_media_asset_id_fk" FOREIGN KEY ("banner_media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;