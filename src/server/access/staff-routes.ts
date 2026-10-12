import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import {
  adjustGrantSchema,
  enrolleeQuerySchema,
  manualGrantSchema,
  suspendEnrollmentSchema,
} from '../../features/access/manual-enrollment';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { SourceRefConflictError } from './entitlement-store';
import {
  CourseMissingError,
  EntitlementMissingError,
  NotAdjustableError,
  NotEnrolledError,
  UserNotFoundError,
  adjustManualGrant,
  grantManualEnrollment,
  listEnrollees,
  reinstateEnrollment,
  suspendEnrollment,
} from './manual-enrollment';

type StaffContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID = /^[A-Za-z0-9_-]{8,64}$/;

function failure(c: StaffContext, error: unknown): Response {
  if (error instanceof UserNotFoundError) return c.json({ error: { code: 'user_not_found' } }, 404);
  if (error instanceof CourseMissingError)
    return c.json({ error: { code: 'course_not_found' } }, 404);
  if (error instanceof NotEnrolledError) return c.json({ error: { code: 'not_enrolled' } }, 404);
  if (error instanceof EntitlementMissingError) {
    return c.json({ error: { code: 'entitlement_not_found' } }, 404);
  }
  if (error instanceof NotAdjustableError)
    return c.json({ error: { code: 'not_adjustable' } }, 409);
  if (error instanceof SourceRefConflictError) {
    return c.json({ error: { code: 'request_id_conflict' } }, 409);
  }
  throw error;
}

/**
 * Matrícula manual, suspensão e lista de inscritos (M3-06), sob `/api/staff`. Cada rota confere a
 * capability NO SERVIDOR, a cada requisição: `access.grant` matricula, suspende e reativa;
 * `enrollment.support_edit` ajusta o prazo de matrícula manual; a lista é leitura básica da Staff
 * (`staff.read`, sem grant). A matrícula não cria usuário, não cria Order nem Payment.
 */
export function enrollmentStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const actor = (c: StaffContext) => c.var.access!.userId;
  const clock = deps.clock ? { clock: deps.clock } : {};

  routes.get(
    '/courses/:courseId/enrollments',
    deps.withDatabase,
    requireCapability('staff.read'),
    async (c) => {
      const courseId = c.req.param('courseId');
      if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
      const query = enrolleeQuerySchema.parse({
        page: c.req.query('page'),
        pageSize: c.req.query('pageSize'),
      });
      const page = await listEnrollees(c.var.db, courseId, {
        ...query,
        now: (deps.clock ?? (() => new Date()))(),
      });
      return c.json(page);
    },
  );

  routes.post('/enrollments', deps.withDatabase, requireCapability('access.grant'), async (c) => {
    const body = manualGrantSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const result = await grantManualEnrollment(c.var.db, {
        actorId: actor(c),
        ...body.data,
        ...clock,
      });
      return c.json(
        {
          status: result.created ? 'enrolled' : 'already_enrolled',
          userId: result.userId,
          expiresAt: result.effectiveExpiresAt ? result.effectiveExpiresAt.toISOString() : null,
        },
        result.created ? 201 : 200,
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post(
    '/courses/:courseId/enrollments/:userId/suspend',
    deps.withDatabase,
    requireCapability('access.grant'),
    async (c) => {
      const { courseId, userId } = c.req.param();
      if (!UUID.test(courseId) || !USER_ID.test(userId)) {
        return c.json({ error: { code: 'not_found' } }, 404);
      }
      const body = suspendEnrollmentSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        const result = await suspendEnrollment(c.var.db, {
          actorId: actor(c),
          userId,
          courseId,
          reason: body.data.reason,
          ...clock,
        });
        return c.json({ status: result.changed ? 'suspended' : 'already_suspended' });
      } catch (error) {
        return failure(c, error);
      }
    },
  );

  routes.post(
    '/courses/:courseId/enrollments/:userId/reinstate',
    deps.withDatabase,
    requireCapability('access.grant'),
    async (c) => {
      const { courseId, userId } = c.req.param();
      if (!UUID.test(courseId) || !USER_ID.test(userId)) {
        return c.json({ error: { code: 'not_found' } }, 404);
      }
      try {
        const result = await reinstateEnrollment(c.var.db, { actorId: actor(c), userId, courseId });
        return c.json({ status: result.changed ? 'reinstated' : 'not_suspended' });
      } catch (error) {
        return failure(c, error);
      }
    },
  );

  routes.post(
    '/entitlements/:id/adjust',
    deps.withDatabase,
    requireCapability('enrollment.support_edit'),
    async (c) => {
      const entitlementId = c.req.param('id');
      if (!UUID.test(entitlementId)) return c.json({ error: { code: 'not_found' } }, 404);
      const body = adjustGrantSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        const result = await adjustManualGrant(c.var.db, {
          actorId: actor(c),
          entitlementId,
          ...body.data,
          ...clock,
        });
        return c.json({
          status: result.adjusted ? 'adjusted' : 'unchanged',
          entitlementId: result.entitlementId,
          expiresAt: result.expiresAt.toISOString(),
        });
      } catch (error) {
        return failure(c, error);
      }
    },
  );

  return routes;
}
