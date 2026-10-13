-- Revisada à mão (M5-02): aula de vídeo (kind video + um video_asset), limiar de conclusão por curso, progresso de vídeo
-- (posição máxima monotônica e conclusão com evidência imutáveis por gatilho) e método de conclusão "video".
CREATE TABLE "video_progress" (
	"user_id" text NOT NULL,
	"lesson_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"max_position" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer NOT NULL,
	"last_session_id" text,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_progress_pk" PRIMARY KEY("user_id","lesson_id"),
	CONSTRAINT "video_progress_position_check" CHECK ("video_progress"."max_position" >= 0),
	CONSTRAINT "video_progress_position_duration_check" CHECK ("video_progress"."max_position" <= "video_progress"."duration_seconds"),
	CONSTRAINT "video_progress_duration_check" CHECK ("video_progress"."duration_seconds" between 1 and 86400),
	CONSTRAINT "video_progress_seq_check" CHECK ("video_progress"."last_seq" >= 0),
	CONSTRAINT "video_progress_completion_check" CHECK (("video_progress"."completed_at" is null) = ("video_progress"."evidence" is null))
);
--> statement-breakpoint
ALTER TABLE "lesson" DROP CONSTRAINT "lesson_kind_check";--> statement-breakpoint
ALTER TABLE "lesson_completion" DROP CONSTRAINT "lesson_completion_method_check";--> statement-breakpoint
ALTER TABLE "lesson_draft" DROP CONSTRAINT "lesson_draft_kind_check";--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "video_completion_percent" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "video_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD COLUMN "video_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_video_asset_id_video_asset_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "video_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_enrollment_fk" FOREIGN KEY ("user_id","course_id") REFERENCES "enrollment"("user_id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_lesson_fk" FOREIGN KEY ("lesson_id","course_id") REFERENCES "lesson"("id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_video_asset_id_video_asset_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "video_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_video_asset_id_video_asset_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "video_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_video_completion_percent_check" CHECK ("course"."video_completion_percent" between 50 and 100);--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_video_asset_check" CHECK (("lesson"."kind" = 'video') = ("lesson"."video_asset_id" is not null));--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_kind_check" CHECK ("lesson"."kind" in ('text', 'video'));--> statement-breakpoint
ALTER TABLE "lesson_completion" ADD CONSTRAINT "lesson_completion_method_check" CHECK ("lesson_completion"."method" in ('manual', 'video'));--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_video_asset_check" CHECK ("lesson_draft"."kind" = 'video' or "lesson_draft"."video_asset_id" is null);--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_kind_check" CHECK ("lesson_draft"."kind" in ('text', 'video'));--> statement-breakpoint
CREATE FUNCTION video_progress_guard() RETURNS trigger AS $$
BEGIN
	-- A posição máxima só SOBE (seek para trás não a reduz); trocar o vídeo da aula reinicia a linha.
	IF NEW.video_asset_id IS NOT DISTINCT FROM OLD.video_asset_id AND NEW.max_position < OLD.max_position THEN
		RAISE EXCEPTION 'video_progress_position_not_decreasable' USING ERRCODE = 'restrict_violation';
	END IF;
	-- Concluído, a conclusão e a evidência não mudam mais.
	IF OLD.completed_at IS NOT NULL AND (NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.evidence IS DISTINCT FROM OLD.evidence) THEN
		RAISE EXCEPTION 'video_progress_completion_immutable' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER video_progress_guard_trg BEFORE UPDATE ON "video_progress" FOR EACH ROW EXECUTE FUNCTION video_progress_guard();
