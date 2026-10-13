-- Revisada à mão (M4-03): lease e última execução de cada job do Cron, uma linha por nome.
CREATE TABLE "job_run" (
	"name" text PRIMARY KEY NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_status" text,
	"last_count" integer,
	"last_duration_ms" integer,
	"last_error_code" text,
	CONSTRAINT "job_run_name_check" CHECK ("job_run"."name" ~ '^[a-z][a-z0-9_.-]{0,99}$'),
	CONSTRAINT "job_run_status_check" CHECK ("job_run"."last_status" in ('ok', 'error')),
	CONSTRAINT "job_run_lease_check" CHECK (("job_run"."lease_owner" is null) = ("job_run"."lease_until" is null))
);
