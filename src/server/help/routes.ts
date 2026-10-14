import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import {
  faqItemSchema,
  faqStateSchema,
  moveFaqSchema,
  supportRequestSchema,
} from '../../features/help/help';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import {
  FaqItemNotFoundError,
  SupportContextInvalidError,
  SupportRateLimitedError,
  createFaqItem,
  createSupportRequest,
  deleteFaqItem,
  listAllFaq,
  listPublishedFaq,
  listSupportRequests,
  moveFaqItem,
  setFaqState,
  updateFaqItem,
} from './store';

type HelpContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(c: HelpContext, error: unknown): Response {
  if (error instanceof FaqItemNotFoundError) return c.json({ error: { code: 'not_found' } }, 404);
  if (error instanceof SupportRateLimitedError) {
    return c.json({ error: { code: 'rate_limited' } }, 429);
  }
  if (error instanceof SupportContextInvalidError) {
    return c.json({ error: { code: 'invalid_context' } }, 400);
  }
  throw error;
}

/**
 * Ajuda do ALUNO (M5-14), sob `/api/me/help` (sessão e termos): a FAQ publicada e o pedido de suporte. O pedido é
 * SEMPRE da pessoa autenticada (o corpo não aceita `userId` nem endereço de resposta: o `Reply-To` sai da conta).
 * Limite de 3 pedidos a cada 10 minutos por pessoa.
 */
export function helpRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get('/me/help/faq', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    c.header('Cache-Control', 'no-store');
    return c.json({ items: await listPublishedFaq(c.var.db) });
  });

  routes.post('/me/help/requests', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = supportRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    try {
      const created = await createSupportRequest(c.var.db, {
        userId: session.user.id,
        ...parsed.data,
        ...(deps.clock ? { now: deps.clock() } : {}),
      });
      return c.json(created, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

/**
 * Ajuda da STAFF (M5-14), sob `/api/staff/help`. A FAQ (todos os itens, criar, editar, publicar, ordenar, excluir)
 * exige o grant `help.edit`; a lista de pedidos de suporte, `staff.read`. A resposta ao pedido é feita por e-mail,
 * fora do Hub.
 */
export function helpStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const edit = [deps.withDatabase, requireCapability('help.edit')] as const;

  routes.get('/help/faq', ...edit, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ items: await listAllFaq(c.var.db) });
  });

  routes.post('/help/faq', ...edit, async (c) => {
    const parsed = faqItemSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    return c.json({ item: await createFaqItem(c.var.db, parsed.data) }, 201);
  });

  routes.put('/help/faq/:id', ...edit, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = faqItemSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      return c.json({ item: await updateFaqItem(c.var.db, { id, ...parsed.data }) });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/help/faq/:id/state', ...edit, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = faqStateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      return c.json({ item: await setFaqState(c.var.db, { id, state: parsed.data.state }) });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/help/faq/:id/move', ...edit, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = moveFaqSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      await moveFaqItem(c.var.db, { id, direction: parsed.data.direction });
      return c.json({ moved: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/help/faq/:id/delete', ...edit, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    try {
      await deleteFaqItem(c.var.db, id);
      return c.json({ deleted: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.get('/help/requests', deps.withDatabase, requireCapability('staff.read'), async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ requests: await listSupportRequests(c.var.db) });
  });

  return routes;
}

/**
 * Endereço do suporte para quem não consegue entrar (M5-14): `GET /api/public/help`, sem sessão. É o endereço
 * da EQUIPE (variável do ambiente), nunca de uma pessoa; ausente = `null` e a tela não mostra nada.
 */
export function publicHelpRoutes() {
  const routes = new Hono<{ Bindings: Env }>();
  routes.get('/help', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ supportEmail: c.env.SUPPORT_INBOX_EMAIL?.trim() || null });
  });
  return routes;
}
