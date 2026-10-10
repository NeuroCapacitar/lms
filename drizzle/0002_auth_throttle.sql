-- Revisada à mão. Contadores de janela fixa do pedido de link (M1-06); a chave guarda só hashes.
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
