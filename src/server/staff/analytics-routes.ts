import { Hono, type MiddlewareHandler } from 'hono';

import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { loadCourseAnalytics, loadOfferAnalytics } from './analytics-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Analytics first-party (M9-02), sob `/api/staff/analytics`. SOMENTE LEITURA, só contagens derivadas do que já existe (nenhum evento
 * novo). Aprendizagem de um curso: `staff.read` (o mesmo nível de "ver inscritos"). Funil das ofertas e conversão dos avisos:
 * `finance.view` (dado de venda). Sem CSV nem exportação.
 */
export function staffAnalyticsRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get(
    '/analytics/courses/:courseId',
    deps.withDatabase,
    requireCapability('staff.read'),
    async (c) => {
      const courseId = c.req.param('courseId');
      if (!UUID.test(courseId)) return c.json({ error: { code: 'invalid_request' } }, 400);
      const analytics = await loadCourseAnalytics(c.var.db, courseId);
      if (!analytics) return c.json({ error: { code: 'not_found' } }, 404);
      c.header('cache-control', 'no-store');
      return c.json(analytics);
    },
  );

  routes.get(
    '/analytics/offers',
    deps.withDatabase,
    requireCapability('finance.view'),
    async (c) => {
      c.header('cache-control', 'no-store');
      return c.json(await loadOfferAnalytics(c.var.db));
    },
  );

  return routes;
}
