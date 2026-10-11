-- Revisada à mão: FKs sem o prefixo "public" e, no fim, os gatilhos que mantêm as invariantes do catálogo
-- no banco (M2-01): slug só muda antes da primeira publicação, curso publicado nunca volta a rascunho,
-- Offer não troca de Course, não muda de modalidade depois do rascunho e "arquivada" é terminal.
CREATE TABLE "course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"sequence_mode" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_slug_unique" UNIQUE("slug"),
	CONSTRAINT "course_slug_format_check" CHECK ("course"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("course"."slug") between 3 and 80),
	CONSTRAINT "course_title_check" CHECK (char_length(btrim("course"."title")) between 1 and 200),
	CONSTRAINT "course_sequence_mode_check" CHECK ("course"."sequence_mode" in ('guided', 'free')),
	CONSTRAINT "course_status_check" CHECK ("course"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"access_months" integer NOT NULL,
	"max_installments" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_name_check" CHECK (char_length(btrim("offer"."name")) between 1 and 120),
	CONSTRAINT "offer_kind_check" CHECK ("offer"."kind" in ('free', 'paid')),
	CONSTRAINT "offer_currency_check" CHECK ("offer"."currency" = 'BRL'),
	CONSTRAINT "offer_price_check" CHECK (("offer"."kind" = 'free' and "offer"."price_cents" = 0) or ("offer"."kind" = 'paid' and "offer"."price_cents" > 0)),
	CONSTRAINT "offer_access_months_check" CHECK ("offer"."access_months" between 1 and 600),
	CONSTRAINT "offer_installments_check" CHECK ("offer"."max_installments" between 1 and 12 and ("offer"."kind" = 'paid' or "offer"."max_installments" = 1)),
	CONSTRAINT "offer_status_check" CHECK ("offer"."status" in ('draft', 'active', 'paused', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_course_id_idx" ON "offer" USING btree ("course_id");--> statement-breakpoint
CREATE FUNCTION course_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.status = 'published' THEN NEW.first_published_at := now(); END IF;
		RETURN NEW;
	END IF;
	IF OLD.first_published_at IS NOT NULL THEN
		-- A primeira publicação é um fato durável: o slug (base das URLs) congela e o curso nunca volta a rascunho.
		IF NEW.slug <> OLD.slug THEN
			RAISE EXCEPTION 'slug_locked' USING ERRCODE = 'restrict_violation';
		END IF;
		IF NEW.status = 'draft' THEN
			RAISE EXCEPTION 'course_back_to_draft' USING ERRCODE = 'restrict_violation';
		END IF;
		NEW.first_published_at := OLD.first_published_at;
	ELSIF NEW.status = 'published' THEN
		NEW.first_published_at := now();
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER course_guard BEFORE INSERT OR UPDATE ON "course" FOR EACH ROW EXECUTE FUNCTION course_guard();
--> statement-breakpoint
CREATE FUNCTION offer_guard() RETURNS trigger AS $$
BEGIN
	IF NEW.course_id <> OLD.course_id THEN
		RAISE EXCEPTION 'offer_course_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status = 'archived' THEN
		-- Arquivada é terminal: nada muda (a história comercial fica como foi).
		RAISE EXCEPTION 'offer_archived' USING ERRCODE = 'restrict_violation';
	END IF;
	IF OLD.status <> 'draft' AND NEW.kind <> OLD.kind THEN
		RAISE EXCEPTION 'offer_kind_locked' USING ERRCODE = 'restrict_violation';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offer_guard BEFORE UPDATE ON "offer" FOR EACH ROW EXECUTE FUNCTION offer_guard();
