import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { toAccessDto } from '../../features/access/access';
import { isSuspended } from '../auth/access-store';
import type { AuthVars } from '../auth/types';
import { resolveAccess } from './entitlement-store';
import {
  EnrollmentSuspendedError,
  OfferNotFreeError,
  OfferUnavailableError,
  enrollInFreeOffer,
} from './free-enrollment';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enrollBodySchema = z.strictObject({ offerId: z.string().regex(UUID) });

/**
 * Rotas do aluno sobre o acesso a um curso (M3-02): `/api/courses/:id/...`. Autenticadas e com o
 * aceite dos termos em dia (o portão de `/courses/*` é registrado antes, em `auth/routes.ts`). O
 * servidor decide tudo: a interface só mostra o resultado.
 */
export function courseAccessRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  /** O estado de acesso da própria pessoa neste curso. */
  routes.get('/courses/:id/access', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const courseId = c.req.param('id');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    const access = await resolveAccess(c.var.db, session.user.id, courseId, new Date());
    return c.json(toAccessDto(access));
  });

  /**
   * Inscrição gratuita: a oferta é escolhida pelo corpo (`offerId`, a que a pessoa viu) e revalidada
   * no servidor. 201 criou o acesso; 200 já havia acesso válido (repetir é seguro).
   */
  routes.post('/courses/:id/enroll', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const courseId = c.req.param('id');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    const body = enrollBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    if (await isSuspended(c.var.db, session.user.id)) {
      return c.json({ error: { code: 'account_suspended' } }, 403);
    }
    try {
      const result = await enrollInFreeOffer(c.var.db, {
        userId: session.user.id,
        courseId,
        offerId: body.data.offerId,
      });
      return c.json(
        { status: result.status, access: toAccessDto(result.access) },
        result.status === 'enrolled' ? 201 : 200,
      );
    } catch (error) {
      if (error instanceof OfferUnavailableError) {
        return c.json({ error: { code: 'offer_unavailable' } }, 409);
      }
      if (error instanceof OfferNotFreeError) {
        return c.json({ error: { code: 'offer_not_free' } }, 409);
      }
      if (error instanceof EnrollmentSuspendedError) {
        return c.json({ error: { code: 'enrollment_suspended' } }, 403);
      }
      throw error;
    }
  });

  return routes;
}
