import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { createIntentSchema, type MediaPurpose } from '../../features/media/media';
import { hasCapability, type Capability } from '../../features/identity/capabilities';
import { loadAccess } from '../auth/access-store';
import type { AuthVars } from '../auth/types';
import { MediaNotConfiguredError, type ObjectStorage } from './storage';
import {
  MediaExpiredError,
  MediaNotFoundError,
  MediaRejectedError,
  MediaStateError,
  UploadMissingError,
  confirmUpload,
  createIntent,
  openPrivateMedia,
} from './store';

type MediaContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem pode enviar cada propósito. O certificado é do Admin (não delegável); o resto, de quem edita cursos. */
const UPLOAD_CAPABILITY: Record<MediaPurpose, Capability> = {
  course_cover: 'course.edit',
  course_banner: 'course.edit',
  lesson_material: 'course.edit',
  certificate_asset: 'staff.manage',
};

function failure(c: MediaContext, error: unknown): Response {
  if (error instanceof MediaNotConfiguredError) {
    return c.json({ error: { code: 'media_not_configured' } }, 503);
  }
  if (error instanceof MediaNotFoundError) return c.json({ error: { code: 'not_found' } }, 404);
  if (error instanceof MediaRejectedError) {
    return c.json({ error: { code: 'invalid_media', reason: error.reason } }, 422);
  }
  if (error instanceof MediaExpiredError) return c.json({ error: { code: 'upload_expired' } }, 410);
  if (error instanceof UploadMissingError)
    return c.json({ error: { code: 'upload_missing' } }, 409);
  if (error instanceof MediaStateError) return c.json({ error: { code: 'invalid_state' } }, 409);
  throw error;
}

/**
 * Mídia (M5-07), sob `/api/media` (sessão e termos). `POST /intents` cria o upload pendente e devolve o PUT
 * pré-assinado curto; `POST /:id/confirm` confere os BYTES e só então torna o objeto utilizável (200 no PUT não
 * publica nada); `GET /:id/content` entrega mídia PRIVADA depois de autorizar (Staff, ou quem pode abrir uma aula
 * que a referencia), com `no-store` e sem tipo adivinhado. Sem R2 configurado: 503, nunca "meio funcionando".
 */
export function mediaRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  storage: (c: MediaContext) => ObjectStorage | undefined;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const now = () => (deps.clock ? deps.clock() : new Date());

  const storageOf = (c: MediaContext): ObjectStorage => {
    const storage = deps.storage(c);
    if (!storage) throw new MediaNotConfiguredError();
    return storage;
  };

  routes.post('/media/intents', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = createIntentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const access = await loadAccess(c.var.db, session.user.id);
    if (access.suspended) return c.json({ error: { code: 'account_suspended' } }, 403);
    if (!hasCapability(access, UPLOAD_CAPABILITY[parsed.data.purpose])) {
      return c.json({ error: { code: 'forbidden' } }, 403);
    }
    c.header('Cache-Control', 'no-store');
    try {
      const intent = await createIntent(c.var.db, storageOf(c), {
        userId: session.user.id,
        ...parsed.data,
        now: now(),
      });
      return c.json(intent, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/media/:id/confirm', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const access = await loadAccess(c.var.db, session.user.id);
    if (access.suspended) return c.json({ error: { code: 'account_suspended' } }, 403);
    if (!hasCapability(access, 'staff.read')) return c.json({ error: { code: 'forbidden' } }, 403);
    c.header('Cache-Control', 'no-store');
    try {
      const asset = await confirmUpload(c.var.db, storageOf(c), {
        userId: session.user.id,
        mediaId: id,
        now: now(),
      });
      return c.json({ media: asset });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get('/media/:id/content', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const access = await loadAccess(c.var.db, session.user.id);
    if (access.suspended) return c.json({ error: { code: 'account_suspended' } }, 403);
    try {
      const file = await openPrivateMedia(c.var.db, storageOf(c), {
        userId: session.user.id,
        canStaffRead: hasCapability(access, 'staff.read'),
        mediaId: id,
        now: now(),
      });
      return new Response(file.body, {
        status: 200,
        headers: {
          'Content-Type': file.contentType,
          'Content-Length': String(file.size),
          // Dado privado: nada de cache compartilhado nem do navegador; o tipo não é adivinhado.
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          ...(file.isDocument
            ? { 'Content-Disposition': 'attachment; filename="material.pdf"' }
            : {}),
        },
      });
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
