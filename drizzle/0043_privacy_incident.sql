-- Revisada à mão (M9-06, ADR 0033): FK sem o prefixo "public" e, no fim, o gatilho que impede apagar o registro, trava a identidade e torna o ENCERRADO definitivo.
CREATE TABLE "privacy_incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"data_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"affected_count" integer,
	"detected_at" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"risk_assessment" text DEFAULT 'not_assessed' NOT NULL,
	"communication" text DEFAULT 'pending' NOT NULL,
	"communicated_at" timestamp with time zone,
	"actions_taken" text,
	"contained_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_incident_title_check" CHECK (char_length("privacy_incident"."title") between 3 and 120),
	CONSTRAINT "privacy_incident_description_check" CHECK (char_length("privacy_incident"."description") between 10 and 2000),
	CONSTRAINT "privacy_incident_category_check" CHECK ("privacy_incident"."category" in ('exposure', 'unauthorized_access', 'loss', 'alteration', 'misdelivery', 'other')),
	CONSTRAINT "privacy_incident_data_kinds_check" CHECK ("privacy_incident"."data_kinds" <@ array['name', 'email', 'payer_document', 'progress', 'certificate', 'discussion', 'credentials', 'other']::text[]),
	CONSTRAINT "privacy_incident_status_check" CHECK ("privacy_incident"."status" in ('open', 'contained', 'closed')),
	CONSTRAINT "privacy_incident_risk_check" CHECK ("privacy_incident"."risk_assessment" in ('not_assessed', 'low', 'relevant')),
	CONSTRAINT "privacy_incident_communication_check" CHECK ("privacy_incident"."communication" in ('pending', 'not_required', 'communicated')),
	CONSTRAINT "privacy_incident_communicated_check" CHECK (("privacy_incident"."communication" = 'communicated') = ("privacy_incident"."communicated_at" is not null)),
	CONSTRAINT "privacy_incident_closed_check" CHECK (("privacy_incident"."status" = 'closed') = ("privacy_incident"."closed_at" is not null)),
	CONSTRAINT "privacy_incident_close_decision_check" CHECK ("privacy_incident"."status" <> 'closed' or ("privacy_incident"."risk_assessment" <> 'not_assessed' and "privacy_incident"."communication" <> 'pending')),
	CONSTRAINT "privacy_incident_affected_check" CHECK ("privacy_incident"."affected_count" is null or "privacy_incident"."affected_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "privacy_incident" ADD CONSTRAINT "privacy_incident_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_incident_detected_idx" ON "privacy_incident" USING btree ("detected_at");
--> statement-breakpoint
-- Todo incidente fica (comunicado ou não) por pelo menos 5 anos: nada de DELETE nem TRUNCATE. A identidade (id, detecção, criação, autor)
-- não muda; só deixa de apontar para o autor se a conta dele for apagada (FK set null), e isso passa até em incidente encerrado.
-- Encerrado é definitivo.
CREATE FUNCTION privacy_incident_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
		RAISE EXCEPTION 'privacy_incident_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
		AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
		RETURN NEW;
	END IF;
	IF OLD.status = 'closed' THEN
		RAISE EXCEPTION 'privacy_incident_closed' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id
		OR NEW.detected_at <> OLD.detected_at
		OR NEW.created_at <> OLD.created_at
		OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
		RAISE EXCEPTION 'privacy_incident_identity_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER privacy_incident_guard_row BEFORE UPDATE OR DELETE ON "privacy_incident" FOR EACH ROW EXECUTE FUNCTION privacy_incident_guard();
--> statement-breakpoint
CREATE TRIGGER privacy_incident_guard_truncate BEFORE TRUNCATE ON "privacy_incident" FOR EACH STATEMENT EXECUTE FUNCTION privacy_incident_guard();
