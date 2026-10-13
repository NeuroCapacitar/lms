-- Revisada à mão (M4-02): chaves de operação; hoje só o kill switch por fila. Ausência da linha = não pausada.
CREATE TABLE "system_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_flag_key_check" CHECK ("system_flag"."key" ~ '^[a-z][a-z0-9_.]{0,99}$')
);
