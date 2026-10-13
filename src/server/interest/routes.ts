import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { registerInterestSchema } from '../../features/interest/interest';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import {
  AlreadyEnrolledError,
  CourseAlreadyOpenError,
  InterestCourseNotFoundError,
  InterestNotFoundError,
  interestStats,
  listMyInterests,
  registerInterest,
  withdrawInterest,
} from './store';

type InterestContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(c: InterestContext, error: unknown): Response {
  if (error instanceof InterestCourseNotFoundError || error instanceof InterestNotFoundError) {
    return c.json({ error: { code: 'not_found' } }, 404);
  }
  if (error instanceof CourseAlreadyOpenError) {
    return c.json({ error: { code: 'course_already_open' } }, 409);
  }
  if (error instanceof AlreadyEnrolledError) {
    return c.json({ error: { code: 'already_enrolled' } }, 409);
  }
  throw error;
}

/**
 * Interesse em cursos ainda não abertos (M5-06), da PESSOA AUTENTICADA, sob `/api/me/course-interests` (o
 * portão de `/me/*` exige sessão e termos). Só ela mexe nos próprios interesses; não há como registrar o de
 * outra pessoa nem de um e-mail solto (leads externos nunca viram interesse). O que a pessoa pode retirar,
 * ela retira aqui ("na conta"): não há descadastro por token no e-mail.
 */
export function interestRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get('/me/course-interests', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    c.header('Cache-Control', 'no-store');
    return c.json({ interests: await listMyInterests(c.var.db, session.user.id) });
  });

  routes.post('/me/course-interests', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = registerInterestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    try {
      const result = await registerInterest(c.var.db, {
        userId: session.user.id,
        courseId: parsed.data.courseId,
        ...(deps.clock ? { clock: deps.clock } : {}),
      });
      return c.json(result, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/me/course-interests/:courseId/withdraw', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const courseId = c.req.param('courseId');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    c.header('Cache-Control', 'no-store');
    try {
      await withdrawInterest(c.var.db, { userId: session.user.id, courseId });
      return c.json({ status: 'withdrawn' });
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

/** Contagens por curso e por ciclo para a Staff (`staff.read`): nunca a lista de pessoas nem e-mails. */
export function interestStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get(
    '/courses/:id/interests',
    deps.withDatabase,
    requireCapability('staff.read'),
    async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
      c.header('Cache-Control', 'no-store');
      return c.json(await interestStats(c.var.db, id));
    },
  );

  return routes;
}
