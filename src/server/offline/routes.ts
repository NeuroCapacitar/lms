import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { AuthVars } from '../auth/types';
import { syncRequestSchema } from '../../features/pwa/offline-sync';
import { issueOfflineLease } from './lease-store';
import { applyOfflineOperations } from './sync-store';

/**
 * Offline do aluno (M8-02, M8-03): `POST /api/offline/lease` e `POST /api/offline/sync`. Sessão e aceite dos termos (o portão é registrado antes, em
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

  /**
   * Sincroniza o outbox (M8-03): lote ORDENADO de comandos da allowlist (hoje só concluir aula de texto), cada um pelo mesmo
   * caso de uso do online e idempotente por (pessoa, clientOperationId). A pessoa é SEMPRE a da sessão; `expectedUserId` só trava:
   * sessão de outra pessoa = 409 e NADA é aplicado. 200 com um resultado por item (`applied`, `duplicate`, `rejected`).
   */
  routes.post('/offline/sync', deps.withDatabase, async (c) => {
    c.header('Cache-Control', 'no-store');
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = syncRequestSchema().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    if (
      parsed.data.expectedUserId !== undefined &&
      parsed.data.expectedUserId !== session.user.id
    ) {
      return c.json({ error: { code: 'wrong_account' } }, 409);
    }
    const results = await applyOfflineOperations(
      c.var.db,
      session.user.id,
      parsed.data.operations,
      deps.clock ? { clock: deps.clock } : {},
    );
    return c.json({ results });
  });

  return routes;
}
