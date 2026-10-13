import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import {
  evaluateAlerts,
  pauseBodySchema,
  requeueBodySchema,
  type LaneName,
} from '../../features/ops/operations';
import { requireCapability } from '../auth/authorization';
import { requireRecentAuth } from '../auth/reauth';
import type { AuthVars } from '../auth/types';
import { publishIntents } from '../async/publisher';
import {
  intentState,
  loadOperationsSnapshot,
  requeueProblemItem,
  setQueuePaused,
} from './operations-store';

type OpsContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Operations Center (M4-05), sob `/api/staff/operations`. LEITURA com `staff.read` (toda a Staff): nunca
 * devolve payload, e-mail, nome, token nem segredo. AÇÕES, cada uma conferida no servidor a cada
 * requisição, com reautenticação recente, motivo obrigatório e auditoria na mesma transação:
 * reenfileirar um item `dead`/`failed` exige `ops.queue` (grant do Admin ao Suporte); pausar ou retomar uma
 * fila (kill switch) exige `system.maintenance` (só Admin).
 */
export function operationsRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const actor = (c: OpsContext) => c.var.access!.userId;

  routes.get('/operations', deps.withDatabase, requireCapability('staff.read'), async (c) => {
    const snapshot = await loadOperationsSnapshot(c.var.db);
    c.header('cache-control', 'no-store');
    return c.json({ snapshot, alerts: evaluateAlerts(snapshot) });
  });

  routes.post(
    '/operations/outbox/:id/requeue',
    deps.withDatabase,
    requireCapability('ops.queue'),
    requireRecentAuth(),
    async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'invalid_request' } }, 400);
      const parsed = requeueBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);

      const requeued = await requeueProblemItem(c.var.db, {
        id,
        actorId: actor(c),
        reason: parsed.data.reason,
      });
      if (!requeued) {
        const state = await intentState(c.var.db, id);
        return state === undefined
          ? c.json({ error: { code: 'not_found' } }, 404)
          : c.json({ error: { code: 'not_requeueable' } }, 409);
      }
      // Acelera: publica já. Se falhar, não faz mal (o Cron republica o que ficou pending).
      const publish = publishIntents(c.env, [
        { id, kind: requeued.kind, correlationId: requeued.correlationId },
      ]);
      try {
        c.executionCtx.waitUntil(publish);
      } catch {
        await publish;
      }
      return c.json({ ok: true });
    },
  );

  routes.post(
    '/operations/queues/:lane/pause',
    deps.withDatabase,
    requireCapability('system.maintenance'),
    requireRecentAuth(),
    async (c) => {
      const lane = c.req.param('lane');
      if (lane !== 'finance' && lane !== 'general') {
        return c.json({ error: { code: 'not_found' } }, 404);
      }
      const parsed = pauseBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      await setQueuePaused(c.var.db, {
        lane: lane as LaneName,
        paused: parsed.data.paused,
        actorId: actor(c),
        reason: parsed.data.reason,
      });
      return c.json({ ok: true });
    },
  );

  return routes;
}
