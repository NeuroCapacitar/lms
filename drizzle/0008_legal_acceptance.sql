-- Revisada à mão: FKs sem o prefixo "public" e, no fim, as duas versões PROVISÓRIAS dos documentos
-- (texto jurídico PENDENTE do advogado do cliente). Sem elas ninguém teria o que aceitar; o texto
-- real entra como uma NOVA versão (nova linha), o que exige novo aceite no próximo acesso.
CREATE TABLE "legal_document_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"body" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_document_version_kind_check" CHECK ("legal_document_version"."kind" in ('terms', 'privacy'))
);
--> statement-breakpoint
CREATE TABLE "terms_acceptance" (
	"user_id" text NOT NULL,
	"document_version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"adult_declared" boolean NOT NULL,
	CONSTRAINT "terms_acceptance_user_id_document_version_id_pk" PRIMARY KEY("user_id","document_version_id"),
	CONSTRAINT "terms_acceptance_adult_check" CHECK ("terms_acceptance"."adult_declared" = true)
);
--> statement-breakpoint
ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_document_version_id_legal_document_version_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "legal_document_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_document_version_kind_version_idx" ON "legal_document_version" USING btree ("kind","version");--> statement-breakpoint
INSERT INTO "legal_document_version" ("kind", "version", "body", "effective_from") VALUES
('terms', 'provisorio-1', $body$TEXTO PROVISÓRIO: aguarda a redação do advogado do cliente. Não vale como documento jurídico.

Termos de Uso da plataforma NeuroCapacitar (versão provisória).

1. A NeuroCapacitar é uma plataforma de cursos online. O acesso é pessoal e intransferível.
2. O uso da plataforma é destinado a pessoas com 18 anos ou mais.
3. O conteúdo dos cursos não pode ser copiado, redistribuído nem revendido.
4. As condições de pagamento, prazo de acesso e reembolso serão detalhadas na versão definitiva.$body$, now()),
('privacy', 'provisorio-1', $body$TEXTO PROVISÓRIO: aguarda a redação do advogado do cliente. Não vale como documento jurídico.

Política de Privacidade da plataforma NeuroCapacitar (versão provisória).

1. Coletamos o mínimo necessário: e-mail, nome de exibição e o seu progresso nos cursos.
2. Não vendemos dados pessoais. Os dados são usados para prestar o serviço e emitir certificados.
3. Você pode pedir informações, correção ou exclusão dos seus dados por e-mail ao suporte.
4. Os detalhes de bases legais, prazos de guarda e operadores serão informados na versão definitiva.$body$, now());
