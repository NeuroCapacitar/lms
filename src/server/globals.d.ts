/** Constantes substituídas pelo Vite no build (ver vite.config.ts). */
declare const __RELEASE_ID__: string;
declare const __APP_ENV__: string;

/** Segredos e variáveis que não saem do `wrangler types` (valores só no Cloudflare). */
interface Env {
  /** DSN do projeto Sentry do Worker. Segredo por ambiente; ausente = Sentry desligado. */
  SENTRY_DSN?: string;
  /** Segredo do Better Auth (ADR 0029). Obrigatório; Worker Secret por ambiente. */
  BETTER_AUTH_SECRET: string;
}
