-- Revisada à mão (M3-04): FK sem o prefixo "public" e, no fim, o gatilho: a conclusão do curso é APPEND-ONLY
-- (não se reescreve nem se apaga), então o histórico (e o certificado do M7) não some se o currículo mudar.
CREATE TABLE "course_completion" (
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"required_total" integer NOT NULL,
	CONSTRAINT "course_completion_pk" PRIMARY KEY("user_id","course_id"),
	CONSTRAINT "course_completion_total_check" CHECK ("course_completion"."required_total" > 0)
);
--> statement-breakpoint
ALTER TABLE "course_completion" ADD CONSTRAINT "course_completion_enrollment_fk" FOREIGN KEY ("user_id","course_id") REFERENCES "enrollment"("user_id","course_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION course_completion_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'course_completion_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	RAISE EXCEPTION 'course_completion_immutable' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER course_completion_guard_trg BEFORE UPDATE OR DELETE ON "course_completion" FOR EACH ROW EXECUTE FUNCTION course_completion_guard();
