/** Constantes substituídas pelo Vite no build (ver vite.config.ts). */
declare const __RELEASE_ID__: string;
declare const __APP_ENV__: string;

/** Segredos e variáveis que não saem do `wrangler types` (valores só no Cloudflare). */
interface Env {
  /** DSN do projeto Sentry do Worker. Segredo por ambiente; ausente = Sentry desligado. */
  SENTRY_DSN?: string;
  /** Segredo do Better Auth (ADR 0029). Obrigatório; Worker Secret por ambiente. */
  BETTER_AUTH_SECRET: string;
  /** Segredo do Turnstile (verificação do captcha no pedido de link). Worker Secret por ambiente. */
  TURNSTILE_SECRET_KEY: string;
  /** Chave da API do Resend. Ausente só é aceito em Development (e-mail falso). */
  RESEND_API_KEY?: string;
  /** Credenciais OAuth do Google (Worker Secrets, por ambiente). Ausentes = login com Google desligado. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Lista de destinatários permitidos, separados por vírgula (Staging). Worker Secret, não variável:
   * são e-mails de pessoas e não entram no repositório. Ausente = sem filtro.
   */
  EMAIL_ALLOWLIST?: string;
}
