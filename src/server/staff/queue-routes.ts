import { Hono, type MiddlewareHandler } from 'hono';

import { auditQuerySchema } from '../../features/staff/audit';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { readAuditPage } from './audit-store';
import { loadStaffQueue } from './queue-store';

/**
 * Fila operacional e leitura da auditoria (M9-01), sob `/api/staff`. A fila (`staff.read`) mostra cada tipo só a quem pode vê-lo e a
 * ação só a quem tem o grant. A auditoria (`audit.view`) é só leitura, paginada por cursor; filtros por ação e alvo, todos validados.
 */
export function staffQueueRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get('/queue', deps.withDatabase, requireCapability('staff.read'), async (c) => {
    const queue = await loadStaffQueue(c.var.db, c.var.access!);
    c.header('cache-control', 'no-store');
    return c.json(queue);
  });

  routes.get('/audit', deps.withDatabase, requireCapability('audit.view'), async (c) => {
    const parsed = auditQuerySchema().safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const page = await readAuditPage(c.var.db, parsed.data);
    c.header('cache-control', 'no-store');
    return c.json(page);
  });

  return routes;
}
