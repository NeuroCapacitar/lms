import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { AuthVars } from '../auth/types';
import { issueOfflineLease } from './lease-store';

/**
 * Offline do aluno (M8-02): `POST /api/offline/lease`. Sessão e aceite dos termos (o portão é registrado antes, em
 * `auth/routes.ts`), CSRF global. Sem corpo: o usuário vem da sessão, nunca do pedido. Staff recebe 403
 * `offline_not_available`: Staff é só online. A resposta nunca é cacheada.
 */
export function offlineRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  /** Relógio (testes). O padrão é o do servidor. */
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const now = () => (deps.clock ?? (() => new Date()))();

  routes.post('/offline/lease', deps.withDatabase, async (c) => {
    c.header('Cache-Control', 'no-store');
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const result = await issueOfflineLease(c.var.db, session.user.id, now());
    if (result.kind === 'staff') {
      return c.json({ error: { code: 'offline_not_available' } }, 403);
    }
    return c.json(result.lease);
  });

  return routes;
}
