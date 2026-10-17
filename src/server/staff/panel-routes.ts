import { Hono, type MiddlewareHandler } from 'hono';

import { hasCapability } from '../../features/identity/capabilities';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { loadStaffPanel } from './panel-store';

/**
 * Painel de fatos (M9-01), sob `/api/staff/panel`. `staff.read` (toda a Staff) vê as contagens gerais; os pedidos só vão com
 * `finance.view` e as denúncias com `discussion.moderate` (a resposta marca `restricted` e NÃO traz esses números). Só contagens.
 */
export function staffPanelRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  routes.get('/panel', deps.withDatabase, requireCapability('staff.read'), async (c) => {
    const access = c.var.access!;
    const panel = await loadStaffPanel(c.var.db, {
      finance: hasCapability(access, 'finance.view'),
      moderation: hasCapability(access, 'discussion.moderate'),
    });
    c.header('cache-control', 'no-store');
    return c.json(panel);
  });
  return routes;
}
