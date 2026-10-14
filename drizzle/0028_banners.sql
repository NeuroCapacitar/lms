CREATE TABLE "login_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_media_state_check" CHECK ("login_media"."state" in ('draft', 'published')),
	CONSTRAINT "login_media_position_check" CHECK ("login_media"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "panel_banner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"alt" text NOT NULL,
	"link_url" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"position" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panel_banner_state_check" CHECK ("panel_banner"."state" in ('draft', 'published')),
	CONSTRAINT "panel_banner_alt_check" CHECK (char_length("panel_banner"."alt") between 1 and 200 and "panel_banner"."alt" = btrim("panel_banner"."alt")),
	CONSTRAINT "panel_banner_link_check" CHECK ("panel_banner"."link_url" is null or char_length("panel_banner"."link_url") between 1 and 500),
	CONSTRAINT "panel_banner_window_check" CHECK ("panel_banner"."starts_at" is null or "panel_banner"."ends_at" is null or "panel_banner"."ends_at" > "panel_banner"."starts_at"),
	CONSTRAINT "panel_banner_position_check" CHECK ("panel_banner"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "media_asset" DROP CONSTRAINT "media_asset_purpose_check";--> statement-breakpoint
ALTER TABLE "media_reference" DROP CONSTRAINT "media_reference_owner_check";--> statement-breakpoint
ALTER TABLE "login_media" ADD CONSTRAINT "login_media_media_id_media_asset_id_fk" FOREIGN KEY ("media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_banner" ADD CONSTRAINT "panel_banner_media_id_media_asset_id_fk" FOREIGN KEY ("media_id") REFERENCES "media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_media_state_idx" ON "login_media" USING btree ("state","position");--> statement-breakpoint
CREATE INDEX "panel_banner_state_idx" ON "panel_banner" USING btree ("state","position");--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_purpose_check" CHECK ("media_asset"."purpose" in ('course_cover', 'course_banner', 'panel_banner', 'login_media', 'lesson_material', 'certificate_asset'));--> statement-breakpoint
ALTER TABLE "media_reference" ADD CONSTRAINT "media_reference_owner_check" CHECK ("media_reference"."owner_type" in ('course_draft', 'course_content', 'lesson', 'panel_banner', 'login_media'));