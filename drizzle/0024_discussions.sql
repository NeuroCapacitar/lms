CREATE TABLE "discussion_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" text NOT NULL,
	"author_role" text DEFAULT 'student' NOT NULL,
	"body" text NOT NULL,
	"state" text DEFAULT 'visible' NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discussion_post_id_lesson_unique" UNIQUE("id","lesson_id"),
	CONSTRAINT "discussion_post_state_check" CHECK ("discussion_post"."state" in ('visible', 'hidden', 'deleted')),
	CONSTRAINT "discussion_post_role_check" CHECK ("discussion_post"."author_role" in ('student', 'staff')),
	CONSTRAINT "discussion_post_body_check" CHECK (char_length("discussion_post"."body") between 1 and 2000 and "discussion_post"."body" = btrim("discussion_post"."body")),
	CONSTRAINT "discussion_post_not_own_parent_check" CHECK ("discussion_post"."parent_id" is distinct from "discussion_post"."id")
);
--> statement-breakpoint
CREATE TABLE "discussion_report" (
	"post_id" uuid NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "discussion_report_pk" PRIMARY KEY("post_id","reporter_id"),
	CONSTRAINT "discussion_report_reason_check" CHECK ("discussion_report"."reason" is null or char_length("discussion_report"."reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "discussion_post" ADD CONSTRAINT "discussion_post_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_post" ADD CONSTRAINT "discussion_post_lesson_fk" FOREIGN KEY ("lesson_id","course_id") REFERENCES "lesson"("id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_post" ADD CONSTRAINT "discussion_post_parent_fk" FOREIGN KEY ("parent_id","lesson_id") REFERENCES "discussion_post"("id","lesson_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_report" ADD CONSTRAINT "discussion_report_post_id_discussion_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "discussion_post"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_report" ADD CONSTRAINT "discussion_report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discussion_post_lesson_idx" ON "discussion_post" USING btree ("lesson_id","created_at");--> statement-breakpoint
CREATE INDEX "discussion_post_author_idx" ON "discussion_post" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "discussion_report_open_idx" ON "discussion_report" USING btree ("post_id") WHERE "discussion_report"."resolved_at" is null;--> statement-breakpoint
CREATE FUNCTION discussion_post_guard() RETURNS trigger AS $$
DECLARE
	parent_parent uuid;
BEGIN
	IF TG_OP = 'INSERT' THEN
		-- Um nível só: a resposta não tem resposta.
		IF NEW.parent_id IS NOT NULL THEN
			SELECT parent_id INTO parent_parent FROM discussion_post WHERE id = NEW.parent_id;
			IF parent_parent IS NOT NULL THEN
				RAISE EXCEPTION 'discussion_reply_to_reply' USING ERRCODE = 'restrict_violation';
			END IF;
		END IF;
		RETURN NEW;
	END IF;
	-- Update: aula, autor, papel, pai e criação nunca mudam; só o texto (edição) e o estado (moderação).
	IF NEW.lesson_id IS DISTINCT FROM OLD.lesson_id OR NEW.course_id IS DISTINCT FROM OLD.course_id
		OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.author_role IS DISTINCT FROM OLD.author_role
		OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'discussion_post_immutable_fields' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER discussion_post_guard_trg BEFORE INSERT OR UPDATE ON "discussion_post" FOR EACH ROW EXECUTE FUNCTION discussion_post_guard();
