import { createMiddleware } from 'hono/factory';

import { hasCapability, type Capability } from '../../features/identity/capabilities';
import { loadAccess } from './access-store';
import type { AuthVars } from './types';

/**
 * Exige uma capability, decidida no SERVIDOR a cada requisição (papéis, grants e suspensão são
 * lidos do banco; nada de cache). Deny-by-default: sem sessão 401; conta suspensa ou sem a
 * capability 403 com código próprio. Vai depois do middleware que abre o banco.
 */
export function requireCapability(capability: Capability) {
  return createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const access = await loadAccess(c.var.db, session.user.id);
    if (access.suspended) return c.json({ error: { code: 'account_suspended' } }, 403);
    if (!hasCapability(access, capability)) return c.json({ error: { code: 'forbidden' } }, 403);
    c.set('access', access);
    await next();
  });
}
