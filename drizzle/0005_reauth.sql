-- Revisada à mão: FKs sem o prefixo "public" (testes em schemas isolados). Desafio de reautenticação (uso único, hash) e prova por sessão.
CREATE TABLE "reauth_challenge" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reauth_proof" (
	"session_id" text PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reauth_challenge" ADD CONSTRAINT "reauth_challenge_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reauth_challenge" ADD CONSTRAINT "reauth_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reauth_proof" ADD CONSTRAINT "reauth_proof_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reauth_challenge_session_idx" ON "reauth_challenge" USING btree ("session_id");