-- Revisada à mão (M2-02): FKs sem o prefixo "public" e, no fim, os gatilhos do currículo PUBLICADO: id e curso imutáveis,
-- nada é apagado (o que sai é aposentado com `retired_at`) e aposentado é definitivo (não volta, não muda).
CREATE TABLE "course_content" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"display_title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"workload_hours" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_content_workload_check" CHECK ("course_content"."workload_hours" is null or "course_content"."workload_hours" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "course_draft" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"display_title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"workload_hours" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_draft_workload_check" CHECK ("course_draft"."workload_hours" is null or "course_draft"."workload_hours" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "module" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"drip_days" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_id_course_unique" UNIQUE("id","course_id"),
	CONSTRAINT "module_drip_check" CHECK ("module"."drip_days" between 0 and 3650)
);
--> statement-breakpoint
CREATE TABLE "curriculum_state" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"draft_rev" integer DEFAULT 0 NOT NULL,
	"published_version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"body" jsonb,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_kind_check" CHECK ("lesson"."kind" = 'text')
);
--> statement-breakpoint
CREATE TABLE "lesson_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_draft_kind_check" CHECK ("lesson_draft"."kind" = 'text'),
	CONSTRAINT "lesson_draft_position_check" CHECK ("lesson_draft"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "module_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"drip_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_draft_id_course_unique" UNIQUE("id","course_id"),
	CONSTRAINT "module_draft_drip_check" CHECK ("module_draft"."drip_days" between 0 and 3650),
	CONSTRAINT "module_draft_position_check" CHECK ("module_draft"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "course_content" ADD CONSTRAINT "course_content_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_draft" ADD CONSTRAINT "course_draft_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_state" ADD CONSTRAINT "curriculum_state_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_module_fk" FOREIGN KEY ("module_id","course_id") REFERENCES "module"("id","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_module_fk" FOREIGN KEY ("module_id","course_id") REFERENCES "module_draft"("id","course_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_draft" ADD CONSTRAINT "module_draft_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "module_course_idx" ON "module" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "lesson_module_idx" ON "lesson" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "lesson_draft_module_idx" ON "lesson_draft" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "module_draft_course_idx" ON "module_draft" USING btree ("course_id","position");--> statement-breakpoint
CREATE FUNCTION published_curriculum_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'published_not_deletable' USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id <> OLD.id OR NEW.course_id <> OLD.course_id THEN
		RAISE EXCEPTION 'id_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.retired_at IS NOT NULL THEN
		RAISE EXCEPTION 'retired_is_final' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER module_guard BEFORE UPDATE OR DELETE ON "module" FOR EACH ROW EXECUTE FUNCTION published_curriculum_guard();
--> statement-breakpoint
CREATE TRIGGER lesson_guard BEFORE UPDATE OR DELETE ON "lesson" FOR EACH ROW EXECUTE FUNCTION published_curriculum_guard();
