CREATE TABLE "alert_state" (
	"code" text PRIMARY KEY NOT NULL,
	"severity" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_notified_at" timestamp with time zone,
	CONSTRAINT "alert_state_code_check" CHECK ("alert_state"."code" ~ '^[a-z][a-z0-9_:.-]{0,99}$'),
	CONSTRAINT "alert_state_severity_check" CHECK ("alert_state"."severity" in ('P0', 'P1', 'P2', 'P3'))
);
