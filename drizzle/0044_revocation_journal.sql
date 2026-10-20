-- Revisada à mão: o gatilho no fim (ver o comentário).
CREATE TABLE "revocation_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" bigint NOT NULL,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"user_id" text,
	"course_id" uuid,
	"category" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"exported_at" timestamp with time zone,
	"export_key" text,
	CONSTRAINT "revocation_journal_auditId_unique" UNIQUE("audit_id"),
	CONSTRAINT "revocation_journal_action_check" CHECK ("revocation_journal"."action" in ('certificate.revoke', 'entitlement.revoke', 'enrollment.suspend', 'enrollment.reinstate', 'account.suspend', 'account.reactivate')),
	CONSTRAINT "revocation_journal_export_check" CHECK (("revocation_journal"."exported_at" is null) = ("revocation_journal"."export_key" is null))
);
--> statement-breakpoint
CREATE INDEX "revocation_journal_pending_idx" ON "revocation_journal" USING btree ("audit_id") WHERE "revocation_journal"."exported_at" is null;--> statement-breakpoint
-- Revisada à mão (M9-05, ADR 0034). O diário nasce de um gatilho em audit_log: toda revogação ou suspensão, por QUALQUER caminho (tela, reembolso,
-- futuro), cai no diário na MESMA transação, sem depender de cada função lembrar de registrar. Só ids, a ação e o instante: o motivo e a nota ficam na
-- auditoria. A conversão de course_id só acontece se o texto for um uuid (a auditoria nunca falha por causa do diário).
CREATE FUNCTION revocation_journal_capture() RETURNS trigger AS $$
DECLARE
	uid text;
	cid uuid;
BEGIN
	IF NEW.action IN ('account.suspend', 'account.reactivate') THEN
		uid := NEW.target_id;
	ELSE
		uid := NEW.details->>'userId';
	END IF;
	IF NEW.details->>'courseId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
		cid := (NEW.details->>'courseId')::uuid;
	END IF;
	INSERT INTO revocation_journal (audit_id, action, target_id, user_id, course_id, category, occurred_at)
	VALUES (NEW.id, NEW.action, NEW.target_id, uid, cid,
		CASE WHEN NEW.action = 'certificate.revoke' THEN NEW.details->>'category' END, NEW.at);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Reconstrução: o que já foi revogado ou suspenso ANTES desta migration também entra no diário (e, portanto, no registro fora do banco).
INSERT INTO revocation_journal (audit_id, action, target_id, user_id, course_id, category, occurred_at)
SELECT a.id, a.action, a.target_id,
	CASE WHEN a.action IN ('account.suspend', 'account.reactivate') THEN a.target_id ELSE a.details->>'userId' END,
	CASE WHEN a.details->>'courseId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (a.details->>'courseId')::uuid END,
	CASE WHEN a.action = 'certificate.revoke' THEN a.details->>'category' END, a.at
FROM audit_log a
WHERE a.action IN ('certificate.revoke', 'entitlement.revoke', 'enrollment.suspend', 'enrollment.reinstate', 'account.suspend', 'account.reactivate')
ON CONFLICT (audit_id) DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER audit_log_revocation_journal AFTER INSERT ON "audit_log" FOR EACH ROW
	WHEN (NEW.action IN ('certificate.revoke', 'entitlement.revoke', 'enrollment.suspend', 'enrollment.reinstate', 'account.suspend', 'account.reactivate'))
	EXECUTE FUNCTION revocation_journal_capture();
