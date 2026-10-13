import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import {
  courseStatusBodySchema,
  createCourseSchema,
  createOfferSchema,
  offerStatusBodySchema,
  updateCourseSchema,
  updateOfferSchema,
} from '../../features/catalog/catalog';
import { saveDraftSchema } from '../../features/catalog/curriculum';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import {
  CourseArchivedError,
  CourseNotFoundError,
  InvalidOfferTermsError,
  InvalidTransitionError,
  OfferArchivedError,
  OfferNotFoundError,
  SlugLockedError,
  SlugTakenError,
  createCourse,
  createOffer,
  getStaffCourse,
  listStaffCourses,
  setCourseStatus,
  setOfferStatus,
  updateCourse,
  updateOffer,
} from './catalog-store';
import {
  UnknownVideoAssetError,
  VideoProviderNotVerifiedError,
  CurriculumCourseNotFoundError,
  CurriculumInvalidError,
  DraftConflictError,
  UnknownDraftIdError,
  getDraft,
  previewPublish,
  publishCurriculum,
  saveDraft,
} from './curriculum-store';

type CatalogContext = Context<{ Bindings: Env; Variables: AuthVars }>;

interface CatalogRouteDeps {
  /** Abre o banco e monta o Better Auth (o mesmo das demais rotas autenticadas). */
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Erros de domínio do catálogo viram respostas com código próprio; o resto é erro do servidor. */
function domainError(c: CatalogContext, error: unknown): Response {
  if (error instanceof UnknownVideoAssetError) {
    return c.json({ error: { code: 'video_asset_not_found' } }, 400);
  }
  if (error instanceof VideoProviderNotVerifiedError) {
    return c.json({ error: { code: 'video_provider_not_verified' } }, 400);
  }
  if (error instanceof SlugTakenError) return c.json({ error: { code: 'slug_taken' } }, 409);
  if (error instanceof SlugLockedError) return c.json({ error: { code: 'slug_locked' } }, 409);
  if (error instanceof CourseArchivedError)
    return c.json({ error: { code: 'course_archived' } }, 409);
  if (error instanceof OfferArchivedError)
    return c.json({ error: { code: 'offer_archived' } }, 409);
  if (error instanceof InvalidTransitionError) {
    return c.json({ error: { code: 'invalid_transition' } }, 409);
  }
  if (error instanceof CourseNotFoundError || error instanceof OfferNotFoundError) {
    return c.json({ error: { code: 'not_found' } }, 404);
  }
  if (error instanceof CurriculumCourseNotFoundError) {
    return c.json({ error: { code: 'not_found' } }, 404);
  }
  if (error instanceof DraftConflictError) {
    return c.json({ error: { code: 'draft_conflict', currentRev: error.currentRev } }, 409);
  }
  if (error instanceof UnknownDraftIdError) return c.json({ error: { code: 'unknown_id' } }, 400);
  if (error instanceof CurriculumInvalidError) {
    return c.json({ error: { code: 'curriculum_invalid', problems: error.problems } }, 422);
  }
  if (error instanceof InvalidOfferTermsError) {
    return c.json({ error: { code: 'invalid_request', fields: error.fields } }, 400);
  }
  throw error;
}

/**
 * Catálogo na área da Staff (M2-01), sob `/api/staff` (portão de termos e sessão já aplicados).
 * Cada rota confere a capability no servidor: ler é `staff.read`; criar curso é `course.create`;
 * editar o curso e mudar a visibilidade é `course.edit`; criar, editar e mudar o estado da OFERTA é
 * `offer.manage` (só Admin: Suporte com `course.edit` não mexe em preço nem em disponibilidade).
 */
export function catalogRoutes(deps: CatalogRouteDeps) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  const actor = (c: CatalogContext) => c.var.access!.userId;
  const ids = (c: CatalogContext, ...names: string[]) => {
    const values = names.map((name) => c.req.param(name) ?? '');
    return values.every((value) => UUID.test(value)) ? values : null;
  };

  routes.get('/courses', deps.withDatabase, requireCapability('staff.read'), async (c) =>
    c.json({ courses: await listStaffCourses(c.var.db) }),
  );

  routes.post('/courses', deps.withDatabase, requireCapability('course.create'), async (c) => {
    const parsed = createCourseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const id = await createCourse(c.var.db, { actorId: actor(c), ...parsed.data });
      return c.json({ id }, 201);
    } catch (error) {
      return domainError(c, error);
    }
  });

  routes.get('/courses/:id', deps.withDatabase, requireCapability('staff.read'), async (c) => {
    const found = ids(c, 'id');
    if (!found) return c.json({ error: { code: 'not_found' } }, 404);
    const detail = await getStaffCourse(c.var.db, found[0]!);
    return detail ? c.json(detail) : c.json({ error: { code: 'not_found' } }, 404);
  });

  routes.patch('/courses/:id', deps.withDatabase, requireCapability('course.edit'), async (c) => {
    const found = ids(c, 'id');
    if (!found) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = updateCourseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      await updateCourse(c.var.db, { actorId: actor(c), id: found[0]!, ...parsed.data });
      return c.json({ status: 'ok' });
    } catch (error) {
      return domainError(c, error);
    }
  });

  routes.post(
    '/courses/:id/status',
    deps.withDatabase,
    requireCapability('course.edit'),
    async (c) => {
      const found = ids(c, 'id');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = courseStatusBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        await setCourseStatus(c.var.db, {
          actorId: actor(c),
          id: found[0]!,
          status: parsed.data.status,
        });
        return c.json({ status: 'ok' });
      } catch (error) {
        return domainError(c, error);
      }
    },
  );

  routes.post(
    '/courses/:id/offers',
    deps.withDatabase,
    requireCapability('offer.manage'),
    async (c) => {
      const found = ids(c, 'id');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = createOfferSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json(
          {
            error: {
              code: 'invalid_request',
              fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))],
            },
          },
          400,
        );
      }
      try {
        const id = await createOffer(c.var.db, {
          actorId: actor(c),
          courseId: found[0]!,
          ...parsed.data,
        });
        return c.json({ id }, 201);
      } catch (error) {
        return domainError(c, error);
      }
    },
  );

  routes.patch(
    '/courses/:id/offers/:offerId',
    deps.withDatabase,
    requireCapability('offer.manage'),
    async (c) => {
      const found = ids(c, 'id', 'offerId');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = updateOfferSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        await updateOffer(c.var.db, {
          actorId: actor(c),
          courseId: found[0]!,
          offerId: found[1]!,
          ...parsed.data,
        });
        return c.json({ status: 'ok' });
      } catch (error) {
        return domainError(c, error);
      }
    },
  );

  routes.post(
    '/courses/:id/offers/:offerId/status',
    deps.withDatabase,
    requireCapability('offer.manage'),
    async (c) => {
      const found = ids(c, 'id', 'offerId');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = offerStatusBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        await setOfferStatus(c.var.db, {
          actorId: actor(c),
          courseId: found[0]!,
          offerId: found[1]!,
          status: parsed.data.status,
        });
        return c.json({ status: 'ok' });
      } catch (error) {
        return domainError(c, error);
      }
    },
  );

  // Currículo vivo (M2-02): o rascunho é lido por quem lê a área da Staff e editado por `course.edit`
  // (que inclui publicar). A tela salva o rascunho INTEIRO com o `expectedRev` que leu.
  routes.get(
    '/courses/:id/draft',
    deps.withDatabase,
    requireCapability('staff.read'),
    async (c) => {
      const found = ids(c, 'id');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      const draft = await getDraft(c.var.db, found[0]!);
      return draft ? c.json(draft) : c.json({ error: { code: 'not_found' } }, 404);
    },
  );

  routes.put(
    '/courses/:id/draft',
    deps.withDatabase,
    requireCapability('course.edit'),
    async (c) => {
      const found = ids(c, 'id');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = saveDraftSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        return c.json(await saveDraft(c.var.db, { courseId: found[0]!, ...parsed.data }));
      } catch (error) {
        return domainError(c, error);
      }
    },
  );

  routes.post(
    '/courses/:id/publish',
    deps.withDatabase,
    requireCapability('course.edit'),
    async (c) => {
      const found = ids(c, 'id');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      try {
        return c.json(
          await publishCurriculum(c.var.db, { actorId: actor(c), courseId: found[0]! }),
        );
      } catch (error) {
        return domainError(c, error);
      }
    },
  );

  routes.get(
    '/courses/:id/publish-preview',
    deps.withDatabase,
    requireCapability('staff.read'),
    async (c) => {
      const found = ids(c, 'id');
      if (!found) return c.json({ error: { code: 'not_found' } }, 404);
      const preview = await previewPublish(c.var.db, found[0]!);
      return preview ? c.json(preview) : c.json({ error: { code: 'not_found' } }, 404);
    },
  );

  return routes;
}
