-- Revisada à mão (M5-01): conexões com providers de vídeo (segredo cifrado AES-GCM, chave mestra fora do banco) e assets de vídeo.
CREATE TABLE "video_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"mode" text NOT NULL,
	"state" text DEFAULT 'processing' NOT NULL,
	"duration_seconds" integer,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_asset_provider_check" CHECK ("video_asset"."provider" in ('jmvstream', 'panda', 'cloudflare_stream', 'mux', 'youtube', 'vimeo')),
	CONSTRAINT "video_asset_mode_check" CHECK ("video_asset"."mode" in ('managed', 'referenced')),
	CONSTRAINT "video_asset_state_check" CHECK ("video_asset"."state" in ('processing', 'ready', 'error', 'unavailable')),
	CONSTRAINT "video_asset_external_id_check" CHECK (length("video_asset"."external_id") between 1 and 200),
	CONSTRAINT "video_asset_duration_check" CHECK ("video_asset"."duration_seconds" is null or "video_asset"."duration_seconds" between 1 and 86400),
	CONSTRAINT "video_asset_capabilities_check" CHECK (jsonb_typeof("video_asset"."capabilities") = 'object')
);
--> statement-breakpoint
CREATE TABLE "video_provider_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"ciphertext" text,
	"nonce" text,
	"key_version" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_provider_connection_provider_check" CHECK ("video_provider_connection"."provider" in ('jmvstream', 'panda', 'cloudflare_stream', 'mux', 'youtube', 'vimeo')),
	CONSTRAINT "video_provider_connection_status_check" CHECK ("video_provider_connection"."status" in ('active', 'disabled')),
	CONSTRAINT "video_provider_connection_label_check" CHECK (length("video_provider_connection"."label") between 1 and 80),
	CONSTRAINT "video_provider_connection_secret_check" CHECK (("video_provider_connection"."ciphertext" is null) = ("video_provider_connection"."nonce" is null) and ("video_provider_connection"."ciphertext" is null) = ("video_provider_connection"."key_version" is null)),
	CONSTRAINT "video_provider_connection_key_version_check" CHECK ("video_provider_connection"."key_version" is null or "video_provider_connection"."key_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "video_asset" ADD CONSTRAINT "video_asset_connection_id_video_provider_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "video_provider_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_provider_connection" ADD CONSTRAINT "video_provider_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_asset_provider_external_idx" ON "video_asset" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "video_provider_connection_provider_idx" ON "video_provider_connection" USING btree ("provider","status");