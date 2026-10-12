-- Revisada à mão (M3-03): FKs sem o prefixo "public"; a UNIQUE (id, course_id) da aula vem ANTES da FK composta que a usa;
-- e, no fim, o gatilho: a conclusão é APPEND-ONLY (não se reescreve nem se apaga), então o progresso histórico não some.
CREATE TABLE "lesson_completion" (
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "lesson_completion_pk" PRIMARY KEY("user_id","lesson_id"),
	CONSTRAINT "lesson_completion_method_check" CHECK ("lesson_completion"."method" = 'manual')
);
--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_id_course_unique" UNIQUE("id","course_id");--> statement-breakpoint
ALTER TABLE "lesson_completion" ADD CONSTRAINT "lesson_completion_enrollment_fk" FOREIGN KEY ("user_id","course_id") REFERENCES "enrollment"("user_id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_completion" ADD CONSTRAINT "lesson_completion_lesson_fk" FOREIGN KEY ("lesson_id","course_id") REFERENCES "lesson"("id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_completion_course_idx" ON "lesson_completion" USING btree ("user_id","course_id");
--> statement-breakpoint
CREATE FUNCTION lesson_completion_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'completion_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	RAISE EXCEPTION 'completion_immutable' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER lesson_completion_guard_trg BEFORE UPDATE OR DELETE ON "lesson_completion" FOR EACH ROW EXECUTE FUNCTION lesson_completion_guard();
