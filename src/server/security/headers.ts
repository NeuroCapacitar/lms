import { createMiddleware } from 'hono/factory';

/**
 * Cabeçalhos de segurança das respostas do Worker (a API). Os arquivos estáticos NÃO passam pelo
 * Worker: eles recebem os seus cabeçalhos de `public/_headers` (a política da página fica lá).
 * A API devolve JSON, então a CSP aqui é a mais fechada possível.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  // Sem `includeSubDomains` enquanto o domínio definitivo não existe (M0-09/M10).
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

export function securityHeaders() {
  return createMiddleware(async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      c.header(name, value);
    }
  });
}
