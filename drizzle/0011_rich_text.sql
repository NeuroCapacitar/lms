-- Revisada à mão (M2-05): a descrição do curso passa de texto simples a texto rico (jsonb, nulo = sem descrição).
-- O gerador não escreve o USING: um texto não vazio vira um documento de UM parágrafo (nada se perde) e o
-- vazio vira nulo. Ninguém tem dados nessa coluna fora de testes (as migrations 0009 e 0010 ainda não estão
-- no Staging). Também limita em 100 KB todo conteúdo rico gravado (o servidor valida a allowlist; o banco, o tamanho).
ALTER TABLE "course_draft" ALTER COLUMN "description" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "course_draft" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "course_draft" ALTER COLUMN "description" SET DATA TYPE jsonb USING (
	CASE WHEN "description" = '' THEN NULL ELSE jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
		jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', "description"))))) END
);--> statement-breakpoint
ALTER TABLE "course_content" ALTER COLUMN "description" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "course_content" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "course_content" ALTER COLUMN "description" SET DATA TYPE jsonb USING (
	CASE WHEN "description" = '' THEN NULL ELSE jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
		jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', "description"))))) END
);--> statement-breakpoint
ALTER TABLE "course_content" ADD CONSTRAINT "course_content_description_size_check" CHECK ("course_content"."description" is null or octet_length("course_content"."description"::text) <= 100000);--> statement-breakpoint
ALTER TABLE "course_draft" ADD CONSTRAINT "course_draft_description_size_check" CHECK ("course_draft"."description" is null or octet_length("course_draft"."description"::text) <= 100000);--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_body_size_check" CHECK ("lesson"."body" is null or octet_length("lesson"."body"::text) <= 100000);--> statement-breakpoint
ALTER TABLE "lesson_draft" ADD CONSTRAINT "lesson_draft_body_size_check" CHECK ("lesson_draft"."body" is null or octet_length("lesson_draft"."body"::text) <= 100000);
