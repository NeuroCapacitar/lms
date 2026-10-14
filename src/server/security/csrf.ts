import { createMiddleware } from 'hono/factory';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Caminhos que NÃO passam pelo CSRF (hoje os webhooks do Resend, M4-07, que autentica por assinatura Svix, e do Asaas, M6-03, que autentica por token). Webhooks de provedores (M4/M6) entram aqui,
 * um a um e de forma EXPLÍCITA, porque se autenticam por token próprio e não por cookie.
 */
const CSRF_EXEMPT_PATHS: readonly string[] = ['/api/webhooks/resend', '/api/webhooks/asaas'];

function isJson(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * CSRF próprio para a API JSON (o `hono/csrf` só cobre formulários). Toda mutação (POST, PUT,
 * PATCH, DELETE) exige:
 *   1. origem confiável: `Origin` igual a `APP_BASE_URL`; sem `Origin`, só `Sec-Fetch-Site:
 *      same-origin`. `Origin: null`, origem diferente ou nenhum dos dois cabeçalhos = recusado;
 *   2. `Content-Type: application/json`: um formulário ou um `fetch` simples entre origens só
 *      consegue `text/plain`, `multipart` ou `urlencoded`, que o navegador envia sem pré-verificação.
 * GET, HEAD e OPTIONS passam: nenhuma rota GET altera estado.
 */
export function csrfProtection() {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || CSRF_EXEMPT_PATHS.includes(c.req.path)) {
      await next();
      return;
    }
    const origin = c.req.header('origin');
    const fetchSite = c.req.header('sec-fetch-site');
    const trusted =
      origin !== undefined ? origin === c.env.APP_BASE_URL : fetchSite === 'same-origin';
    if (!trusted) {
      return c.json({ error: { code: 'csrf_rejected' } }, 403);
    }
    if (!isJson(c.req.header('content-type'))) {
      return c.json({ error: { code: 'unsupported_media_type' } }, 415);
    }
    await next();
  });
}
