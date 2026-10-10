import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { withDatabase } from '../db/client';

/**
 * Composição HTTP do Worker. Aqui só entram adapters de entrada; regras de negócio
 * ficam em `src/features` e nunca importam Hono (ver docs/architecture.md).
 */
export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/api/health/live', (c) => c.json({ status: 'ok' }));

  // Pronto = consegue consultar o banco do ambiente. Sem detalhes na resposta.
  // Atenção: acorda o Neon Free; a proteção do endpoint chega com o Operations Center (M4/M9).
  app.get('/api/health/ready', async (c) => {
    try {
      await withDatabase(c.env.HYPERDRIVE, (db) => db.execute(sql`select 1`));
      return c.json({ status: 'ok' });
    } catch (error) {
      console.error('ready_failed', error instanceof Error ? error.name : 'unknown');
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  // Qualquer /api desconhecida devolve JSON, nunca o HTML da SPA.
  app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));

  // Sem detalhes do erro na resposta; o registro estruturado entra no M0-08.
  app.onError((err, c) => {
    console.error('unhandled_error', err.name);
    return c.json({ error: { code: 'internal_error' } }, 500);
  });

  return app;
}
