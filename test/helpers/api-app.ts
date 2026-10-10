import { Hono } from 'hono';

import { authRoutes, type AuthRouteOverrides } from '../../src/server/auth/routes.ts';
import { csrfProtection } from '../../src/server/security/csrf.ts';
import { securityHeaders } from '../../src/server/security/headers.ts';

/** `/api` como no Worker: cabeçalhos de segurança e CSRF antes das rotas de identidade. */
export function apiApp(overrides: AuthRouteOverrides = {}) {
  return new Hono<{ Bindings: Env }>()
    .use('/api/*', securityHeaders())
    .use('/api/*', csrfProtection())
    .route('/api', authRoutes(overrides));
}
