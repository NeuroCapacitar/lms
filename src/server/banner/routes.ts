import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { withDatabase as openDatabase } from '../../db/client';
import {
  bannerMoveSchema,
  bannerStateSchema,
  loginMediaSchema,
  panelBannerSchema,
} from '../../features/banner/banner';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import {
  MediaNotPublishedError,
  MediaNotReadyError,
  MediaPurposeMismatchError,
} from '../media/references';
import type { ObjectStorage } from '../media/storage';
import { MediaNotFoundError, UploadMissingError, publishPublicMedia } from '../media/store';
import {
  BannerNotFoundError,
  TooManyPublishedError,
  createLoginMedia,
  createPanelBanner,
  deleteLoginMedia,
  deletePanelBanner,
  getLoginMedia,
  getPanelBanner,
  listActivePanelBanners,
  listLoginMedia,
  listPanelBanners,
  listPublishedLoginMedia,
  moveLoginMedia,
  movePanelBanner,
  setLoginMediaState,
  setPanelBannerState,
  updatePanelBanner,
} from './store';

type BannerContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class StorageMissingError extends Error {
  constructor() {
    super('media_not_configured');
  }
}

function failure(c: BannerContext, error: unknown): Response {
  if (error instanceof BannerNotFoundError) return c.json({ error: { code: 'not_found' } }, 404);
  if (error instanceof TooManyPublishedError) {
    return c.json({ error: { code: 'too_many_published' } }, 409);
  }
  if (error instanceof StorageMissingError) {
    return c.json({ error: { code: 'media_not_configured' } }, 503);
  }
  if (error instanceof MediaNotReadyError || error instanceof MediaNotFoundError) {
    return c.json({ error: { code: 'media_not_ready' } }, 409);
  }
  if (error instanceof MediaPurposeMismatchError) {
    return c.json({ error: { code: 'invalid_media' } }, 422);
  }
  if (error instanceof MediaNotPublishedError || error instanceof UploadMissingError) {
    return c.json({ error: { code: 'media_not_published' } }, 409);
  }
  throw error;
}

/**
 * Banners do painel e imagens do login para a STAFF (M5-15), sob `/api/staff/banners`. Tudo é do Admin
 * (`staff.manage`; a delegação por grant está PENDENTE com o M1). Publicar COPIA a imagem para o bucket público
 * antes de o estado mudar (fora de transação); sem R2 configurado, 503.
 */
export function bannerStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  storage: (c: BannerContext) => ObjectStorage | undefined;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const admin = [deps.withDatabase, requireCapability('staff.manage')] as const;

  const publish = async (c: BannerContext, mediaId: string) => {
    const storage = deps.storage(c);
    if (!storage) throw new StorageMissingError();
    await publishPublicMedia(c.var.db, storage, mediaId);
  };

  const idOf = (c: BannerContext): string | null => {
    const id = c.req.param('id') ?? '';
    return UUID.test(id) ? id : null;
  };

  routes.get('/banners', ...admin, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({
      panel: await listPanelBanners(c.var.db),
      login: await listLoginMedia(c.var.db),
    });
  });

  // --- Banner do painel ---
  routes.post('/banners/panel', ...admin, async (c) => {
    const parsed = panelBannerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      return c.json({ item: await createPanelBanner(c.var.db, parsed.data) }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.put('/banners/panel/:id', ...admin, async (c) => {
    const id = idOf(c);
    if (!id) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = panelBannerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      // Banner publicado que troca de imagem: a nova vai para o bucket público ANTES.
      const current = await getPanelBanner(c.var.db, id);
      if (current.state === 'published' && parsed.data.mediaId !== current.mediaId) {
        await publish(c, parsed.data.mediaId);
      }
      return c.json({ item: await updatePanelBanner(c.var.db, { id, ...parsed.data }) });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/banners/panel/:id/state', ...admin, async (c) => {
    const id = idOf(c);
    if (!id) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = bannerStateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      if (parsed.data.state === 'published') {
        await publish(c, (await getPanelBanner(c.var.db, id)).mediaId);
      }
      return c.json({
        item: await setPanelBannerState(c.var.db, { id, state: parsed.data.state }),
      });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/banners/panel/:id/move', ...admin, async (c) => {
    const id = idOf(c);
    if (!id) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = bannerMoveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      await movePanelBanner(c.var.db, { id, direction: parsed.data.direction });
      return c.json({ moved: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/banners/panel/:id/delete', ...admin, async (c) => {
    const id = idOf(c);
    if (!id) return c.json({ error: { code: 'not_found' } }, 404);
    try {
      await deletePanelBanner(c.var.db, id);
      return c.json({ deleted: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  // --- Imagem do login ---
  routes.post('/banners/login', ...admin, async (c) => {
    const parsed = loginMediaSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      return c.json({ item: await createLoginMedia(c.var.db, parsed.data) }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/banners/login/:id/state', ...admin, async (c) => {
    const id = idOf(c);
    if (!id) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = bannerStateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      if (parsed.data.state === 'published') {
        await publish(c, (await getLoginMedia(c.var.db, id)).mediaId);
      }
      return c.json({ item: await setLoginMediaState(c.var.db, { id, state: parsed.data.state }) });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/banners/login/:id/move', ...admin, async (c) => {
    const id = idOf(c);
    if (!id) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = bannerMoveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      await moveLoginMedia(c.var.db, { id, direction: parsed.data.direction });
      return c.json({ moved: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/banners/login/:id/delete', ...admin, async (c) => {
    const id = idOf(c);
    if (!id) return c.json({ error: { code: 'not_found' } }, 404);
    try {
      await deleteLoginMedia(c.var.db, id);
      return c.json({ deleted: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

/**
 * Banners do ALUNO (M5-15): `GET /api/me/banners` (sessão e termos). Só os publicados, dentro da janela e com
 * imagem já no bucket público; rascunho e fora de janela nunca saem. O relógio é injetável para teste.
 */
export function bannerRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  routes.get('/me/banners', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    c.header('Cache-Control', 'no-store');
    return c.json({
      banners: await listActivePanelBanners(c.var.db, {
        baseUrl: c.env.MEDIA_PUBLIC_BASE_URL,
        ...(deps.clock ? { now: deps.clock() } : {}),
      }),
    });
  });
  return routes;
}

/**
 * Imagens decorativas do login (M5-15): `GET /api/public/login-media`, SEM sessão (a tela de login as usa). Só
 * publicadas; sem alt (decorativas). Sem `MEDIA_PUBLIC_BASE_URL`, lista vazia: a tela usa o fundo estático.
 */
export function publicLoginMediaRoutes() {
  const routes = new Hono<{ Bindings: Env }>();
  routes.get('/login-media', async (c) => {
    const items = await openDatabase(c.env.HYPERDRIVE, (db) =>
      listPublishedLoginMedia(db, { baseUrl: c.env.MEDIA_PUBLIC_BASE_URL }),
    );
    c.header('Cache-Control', 'no-store');
    return c.json({ items });
  });
  return routes;
}
