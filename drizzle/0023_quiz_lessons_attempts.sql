CREATE TABLE "quiz_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"earned_points" integer NOT NULL,
	"total_points" integer NOT NULL,
	"score_percent" integer NOT NULL,
	"passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempt_number_unique" UNIQUE("user_id","lesson_id","number"),
	CONSTRAINT "quiz_attempt_number_check" CHECK ("quiz_attempt"."number" >= 1),
	CONSTRAINT "quiz_attempt_score_check" CHECK ("quiz_attempt"."earned_points" >= 0 and "quiz_attempt"."earned_points" <= "quiz_attempt"."total_points" and "quiz_attempt"."score_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "lesson" DROP CONSTRAINT "lesson_kind_check";--> statement-breakpoint
ALTER TABLE "lesson_completion" DROP CONSTRAINT "lesson_completion_method_check";--> statement-breakpoint
ALTER TABLE "lesson_draft" DROP CONSTRAINT "lesson_draft_kind_check";--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "quiz" jsonb;--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD COLUMN "quiz" jsonb;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_enrollment_fk" FOREIGN KEY ("user_id","course_id") REFERENCES "enrollment"("user_id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_lesson_fk" FOREIGN KEY ("lesson_id","course_id") REFERENCES "lesson"("id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_quiz_check" CHECK (("lesson"."kind" = 'quiz') = ("lesson"."quiz" is not null));--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_quiz_size_check" CHECK ("lesson"."quiz" is null or octet_length("lesson"."quiz"::text) <= 200000);--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_kind_check" CHECK ("lesson"."kind" in ('text', 'video', 'quiz'));--> statement-breakpoint
ALTER TABLE "lesson_completion" ADD CONSTRAINT "lesson_completion_method_check" CHECK ("lesson_completion"."method" in ('manual', 'video', 'quiz'));--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_quiz_check" CHECK ("lesson_draft"."kind" = 'quiz' or "lesson_draft"."quiz" is null);--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_quiz_size_check" CHECK ("lesson_draft"."quiz" is null or octet_length("lesson_draft"."quiz"::text) <= 200000);--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_kind_check" CHECK ("lesson_draft"."kind" in ('text', 'video', 'quiz'));--> statement-breakpoint
CREATE FUNCTION quiz_attempt_append_only() RETURNS trigger AS $$
BEGIN
	-- O histórico de tentativas é append-only: nada se reescreve nem se apaga (nem em cascata).
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'quiz_attempt_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	RAISE EXCEPTION 'quiz_attempt_immutable' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quiz_attempt_append_only_trg BEFORE UPDATE OR DELETE ON "quiz_attempt" FOR EACH ROW EXECUTE FUNCTION quiz_attempt_append_only();
