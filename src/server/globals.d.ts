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
  /** Caixa de suporte (destino do modelo `support-request`). Endereço de equipe, não de aluno; Worker Secret. */
  SUPPORT_INBOX_EMAIL?: string;
  /** Segredo do endpoint do webhook do Resend (`whsec_…`, Svix). Worker Secret por ambiente; ausente = o webhook recusa tudo. */
  RESEND_WEBHOOK_SECRET?: string;
  /** Chave do HMAC que identifica o destinatário na supressão (M4-07). Worker Secret por ambiente, mín. 32 caracteres. */
  EMAIL_HASH_KEY?: string;
  /**
   * Cofre das chaves que cifram os segredos de vídeo (M5-01): `1:<base64 de 32 bytes>,2:<base64>`; a versão
   * mais alta cifra e as demais só abrem o antigo. Worker Secret por ambiente; nunca no banco nem no repo.
   * Perdida = as conexões precisam ser recadastradas.
   */
  VIDEO_SECRETS_MASTER_KEY?: string;
  /**
   * Mídia (M5-07). Os dois buckets do R2 e as credenciais do token de API do R2 (para o PUT pré-assinado).
   * TODOS opcionais: sem qualquer um deles a mídia fica desligada (503 `media_not_configured`). Os bindings só
   * entram no `wrangler.jsonc` depois que os buckets existirem (ver docs/operations/media.md).
   */
  MEDIA_PRIVATE?: R2Bucket;
  MEDIA_PUBLIC?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Nome do bucket PRIVADO no endpoint S3 (o nome, não o binding). */
  R2_PRIVATE_BUCKET_NAME?: string;
  /** Domínio público da mídia (capa e banner), na zona Cloudflare; ausente = sem imagem pública. Variável, não segredo. */
  MEDIA_PUBLIC_BASE_URL?: string;
  /** Chave de API do Asaas do ambiente (SEGREDO do Worker; sandbox em Staging). Ausente = compra desligada (503). */
  ASAAS_API_KEY?: string;
  /** Token do webhook do Asaas (SEGREDO do Worker; 32 a 255 caracteres, igual ao cadastrado na conta). Ausente = webhook recusa com 500. */
  ASAAS_WEBHOOK_TOKEN?: string;
  /** Base da API do Asaas (variável, não segredo); padrão: o sandbox. */
  ASAAS_API_BASE_URL?: string;
}
