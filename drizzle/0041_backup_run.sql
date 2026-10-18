-- Revisada à mão (M9-05, ADR 0033): sem FKs; o executor do backup grava com a role hub_backup (INSERT só aqui) e o Worker só lê.
CREATE TABLE "backup_run" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backup_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"migrations" integer NOT NULL,
	"pg_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_run_objectKey_unique" UNIQUE("object_key"),
	CONSTRAINT "backup_run_kind_check" CHECK ("backup_run"."kind" in ('daily', 'release')),
	CONSTRAINT "backup_run_sha256_check" CHECK ("backup_run"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "backup_run_size_check" CHECK ("backup_run"."size_bytes" > 0 and "backup_run"."migrations" >= 0)
);
--> statement-breakpoint
CREATE INDEX "backup_run_created_idx" ON "backup_run" USING btree ("created_at");