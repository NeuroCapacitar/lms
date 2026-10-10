import { Hono } from 'hono';

/**
 * Composição HTTP do Worker. Aqui só entram adapters de entrada; regras de negócio
 * ficam em `src/features` e nunca importam Hono (ver docs/architecture.md).
 */
export function createApp() {
  const app = new Hono();

  app.get('/api/health/live', (c) => c.json({ status: 'ok' }));

  // Qualquer /api desconhecida devolve JSON, nunca o HTML da SPA.
  app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));

  // Sem detalhes do erro na resposta; o registro estruturado entra no M0-08.
  app.onError((err, c) => {
    console.error('unhandled_error', err.name);
    return c.json({ error: { code: 'internal_error' } }, 500);
  });

  return app;
}
