ALTER TABLE "certificate" DROP CONSTRAINT "certificate_pdf_check";--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "pdf_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_pdf_check" CHECK ((("certificate"."pdf_key" is null) = ("certificate"."pdf_sha256" is null) or ("certificate"."status" = 'revoked' and "certificate"."pdf_purged_at" is not null and "certificate"."pdf_key" is null and "certificate"."pdf_sha256" is not null)) and ("certificate"."status" <> 'ready' or "certificate"."pdf_key" is not null) and ("certificate"."pdf_purged_at" is null or ("certificate"."status" = 'revoked' and "certificate"."pdf_key" is null)));
--> statement-breakpoint
-- M7-05: a ÚNICA forma de tirar o PDF e o nome de um certificado é a purga do REVOGADO depois do prazo. O guarda continua travando a
-- identidade, o snapshot, o PDF e o estado; só a transição de purga (pdf_purged_at nulo -> preenchido) passa, e só desta forma:
-- certificado revogado, PDF some e o SHA-256 FICA (tombstone), o snapshot muda SÓ no nome do titular, que vira '[removido]'.
-- Depois de purgado nada mais muda (a purga é definitiva).
CREATE OR REPLACE FUNCTION certificate_guard() RETURNS trigger AS $$
DECLARE
	purging boolean;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'certificate_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id
		OR NEW.user_id <> OLD.user_id
		OR NEW.course_id <> OLD.course_id
		OR NEW.code <> OLD.code
		OR NEW.predecessor_id IS DISTINCT FROM OLD.predecessor_id
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'certificate_identity_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.pdf_purged_at IS NOT NULL AND (
		NEW.pdf_purged_at IS DISTINCT FROM OLD.pdf_purged_at
		OR NEW.pdf_key IS NOT NULL
		OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
		OR NEW.snapshot IS DISTINCT FROM OLD.snapshot) THEN
		RAISE EXCEPTION 'certificate_purged_final' USING ERRCODE = 'restrict_violation';
	END IF;
	purging := OLD.pdf_purged_at IS NULL AND NEW.pdf_purged_at IS NOT NULL;
	IF purging THEN
		IF OLD.status <> 'revoked' OR NEW.status <> 'revoked'
			OR OLD.pdf_key IS NULL OR NEW.pdf_key IS NOT NULL
			OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 THEN
			RAISE EXCEPTION 'certificate_purge_invalid' USING ERRCODE = 'restrict_violation';
		END IF;
		IF (NEW.snapshot - 'holderName') IS DISTINCT FROM (OLD.snapshot - 'holderName')
			OR NEW.snapshot ->> 'holderName' IS DISTINCT FROM '[removido]' THEN
			RAISE EXCEPTION 'certificate_purge_snapshot' USING ERRCODE = 'restrict_violation';
		END IF;
	ELSE
		IF OLD.status <> 'awaiting_name' AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
			RAISE EXCEPTION 'certificate_snapshot_locked' USING ERRCODE = 'restrict_violation';
		END IF;
		IF OLD.pdf_key IS NOT NULL AND (NEW.pdf_key IS DISTINCT FROM OLD.pdf_key OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
			RAISE EXCEPTION 'certificate_pdf_locked' USING ERRCODE = 'restrict_violation';
		END IF;
	END IF;
	IF OLD.status IN ('revoked', 'superseded') AND NEW.status <> OLD.status THEN
		RAISE EXCEPTION 'certificate_status_final' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status = 'ready' AND NEW.status NOT IN ('ready', 'revoked', 'superseded') THEN
		RAISE EXCEPTION 'certificate_ready_is_final' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
