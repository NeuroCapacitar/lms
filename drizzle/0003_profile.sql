-- Revisada à mão: FK sem o prefixo "public" (testes em schemas isolados) e, no fim, o gatilho que cria o perfil na MESMA
-- transação do usuário (nenhum usuário sem perfil) e o preenchimento dos usuários que já existiam.
CREATE TABLE "profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"certificate_name" text,
	"certificate_name_confirmed_at" timestamp with time zone,
	"theme" text DEFAULT 'system' NOT NULL,
	"auto_advance" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_theme_check" CHECK ("profile"."theme" in ('system', 'light', 'dark'))
);
--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION create_profile_for_user() RETURNS trigger AS $$
BEGIN
	INSERT INTO "profile" ("user_id", "display_name")
	VALUES (NEW."id", coalesce(nullif(btrim(NEW."name"), ''), split_part(NEW."email", '@', 1)))
	ON CONFLICT ("user_id") DO NOTHING;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER user_create_profile AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION create_profile_for_user();
--> statement-breakpoint
INSERT INTO "profile" ("user_id", "display_name")
SELECT "id", coalesce(nullif(btrim("name"), ''), split_part("email", '@', 1)) FROM "user"
ON CONFLICT ("user_id") DO NOTHING;
