import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { issuerInputSchema, signatoryInputSchema } from '../../features/certificate/issuer';
import {
  templateDraftInputSchema,
  templatePublishInputSchema,
} from '../../features/certificate/template';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { MediaNotReadyError, MediaPurposeMismatchError } from '../media/references';
import {
  SignerCourseNotFoundError,
  getIssuer,
  getSignatory,
  saveIssuer,
  saveSignatory,
} from './signer-store';
import {
  TemplateConflictError,
  TemplateCourseNotFoundError,
  TemplateDraftMissingError,
  TemplateLayoutInvalidError,
  discardTemplateDraft,
  getTemplates,
  publishTemplate,
  saveTemplateDraft,
} from './template-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Emitente e signatário do certificado para a STAFF (M7-06), sob `/api/staff/certificate`. Tudo é do Admin
 * (`staff.manage`, não delegável): o Suporte recebe 403 direto pela API. Nada aqui devolve a URL da assinatura: a
 * imagem só sai por `GET /api/media/:id/content`, que também exige o Admin.
 */
export function certificateStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const admin = [deps.withDatabase, requireCapability('staff.manage')] as const;

  routes.get('/certificate/issuer', ...admin, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ issuer: await getIssuer(c.var.db) });
  });

  routes.put('/certificate/issuer', ...admin, async (c) => {
    const parsed = issuerInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const issuer = await saveIssuer(c.var.db, { ...parsed.data, actorId: c.var.access!.userId });
    return c.json({ issuer });
  });

  routes.get('/courses/:courseId/certificate/signatory', ...admin, async (c) => {
    const courseId = c.req.param('courseId');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json({ signatory: await getSignatory(c.var.db, courseId) });
  });

  routes.put('/courses/:courseId/certificate/signatory', ...admin, async (c) => {
    const courseId = c.req.param('courseId');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = signatoryInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const signatory = await saveSignatory(c.var.db, {
        ...parsed.data,
        courseId,
        actorId: c.var.access!.userId,
      });
      return c.json({ signatory });
    } catch (error) {
      if (error instanceof SignerCourseNotFoundError) {
        return c.json({ error: { code: 'not_found' } }, 404);
      }
      if (error instanceof MediaNotReadyError) {
        return c.json({ error: { code: 'media_not_ready' } }, 409);
      }
      if (error instanceof MediaPurposeMismatchError) {
        return c.json({ error: { code: 'invalid_media' } }, 422);
      }
      throw error;
    }
  });

  // --- Template (M7-03): rascunho, publicação e descarte; só o Admin ---------------------------------------
  const templateFailure = (c: Context<{ Bindings: Env; Variables: AuthVars }>, error: unknown) => {
    if (error instanceof TemplateCourseNotFoundError) {
      return c.json({ error: { code: 'not_found' } }, 404);
    }
    if (error instanceof TemplateDraftMissingError) {
      return c.json({ error: { code: 'draft_missing' } }, 409);
    }
    if (error instanceof TemplateConflictError) {
      return c.json({ error: { code: 'conflict', currentVersion: error.currentVersion } }, 409);
    }
    if (error instanceof TemplateLayoutInvalidError) {
      return c.json({ error: { code: 'layout_invalid', problems: error.problems } }, 422);
    }
    if (error instanceof MediaNotReadyError) {
      return c.json({ error: { code: 'media_not_ready' } }, 409);
    }
    if (error instanceof MediaPurposeMismatchError) {
      return c.json({ error: { code: 'invalid_media' } }, 422);
    }
    throw error;
  };

  routes.get('/courses/:courseId/certificate/template', ...admin, async (c) => {
    const courseId = c.req.param('courseId');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json(await getTemplates(c.var.db, courseId));
  });

  routes.put('/courses/:courseId/certificate/template', ...admin, async (c) => {
    const courseId = c.req.param('courseId');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = templateDraftInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const draft = await saveTemplateDraft(c.var.db, {
        ...parsed.data,
        courseId,
        actorId: c.var.access!.userId,
      });
      return c.json({ draft });
    } catch (error) {
      return templateFailure(c, error);
    }
  });

  routes.post('/courses/:courseId/certificate/template/publish', ...admin, async (c) => {
    const courseId = c.req.param('courseId');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = templatePublishInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const published = await publishTemplate(c.var.db, {
        courseId,
        expectedVersion: parsed.data.expectedVersion,
        actorId: c.var.access!.userId,
      });
      return c.json({ published });
    } catch (error) {
      return templateFailure(c, error);
    }
  });

  routes.post('/courses/:courseId/certificate/template/discard', ...admin, async (c) => {
    const courseId = c.req.param('courseId');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    try {
      const discarded = await discardTemplateDraft(c.var.db, {
        courseId,
        actorId: c.var.access!.userId,
      });
      return c.json({ discarded });
    } catch (error) {
      return templateFailure(c, error);
    }
  });

  return routes;
}
