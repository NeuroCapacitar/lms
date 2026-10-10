/**
 * Padrões de dado pessoal e credencial que NUNCA podem sair em log nem em relatório de erro
 * (ADR 0028). Puro: usado pelo servidor (evlog), pelo servidor (Sentry) e pelo SPA (Sentry).
 */
export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Caminho de link mágico ou convite: o segmento depois do prefixo é o token. */
export const ACCESS_LINK_PATTERN = /\/(?:magic|invite|convite)\/([A-Za-z0-9_-]{12,})/g;

/** Chaves, em qualquer nível, cujo valor é credencial ou segredo. */
export const SECRET_KEY_PATHS = [
  '**.cookie',
  '**.set-cookie',
  '**.authorization',
  '**.token',
  '**.password',
  '**.secret',
  '**.apikey',
] as const;

export const REDACTED = '[REDACTED]';
