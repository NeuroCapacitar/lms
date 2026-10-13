import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import {
  createPostSchema,
  dismissSchema,
  editPostSchema,
  moderateSchema,
  reportSchema,
  staffReplySchema,
} from '../../features/discussion/discussion';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { LessonNotFoundError } from '../learning/completion';
import { CompletionAccessDeniedError, LessonLockedError } from '../learning/completion';
import { checkLessonAccess } from '../learning/learning-store';
import {
  InvalidTransitionError,
  NoOpenReportsError,
  dismissReports,
  listStaffDiscussions,
  moderatePost,
  staffReply,
} from './staff-store';
import {
  AlreadyReportedError,
  NotAuthorError,
  OwnPostError,
  ParentUnavailableError,
  PostNotEditableError,
  PostNotFoundError,
  RateLimitedError,
  ReplyToReplyError,
  createPost,
  deleteOwnPost,
  editPost,
  listLessonDiscussion,
  reportPost,
} from './store';

type DiscussionContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Erros de domínio da discussão viram respostas com código próprio; o resto é erro do servidor. */
function failure(c: DiscussionContext, error: unknown): Response {
  if (error instanceof LessonNotFoundError || error instanceof PostNotFoundError) {
    return c.json({ error: { code: 'not_found' } }, 404);
  }
  if (error instanceof CompletionAccessDeniedError) {
    return c.json({ error: { code: 'access_denied', reason: error.reason } }, 403);
  }
  if (error instanceof LessonLockedError) {
    return c.json(
      {
        error: {
          code: 'lesson_locked',
          reason: error.reason,
          releasesAt: error.releasesAt ? error.releasesAt.toISOString() : null,
        },
      },
      403,
    );
  }
  if (error instanceof NotAuthorError) return c.json({ error: { code: 'not_author' } }, 403);
  if (error instanceof PostNotEditableError) {
    return c.json({ error: { code: 'post_not_editable' } }, 409);
  }
  if (error instanceof ParentUnavailableError) {
    return c.json({ error: { code: 'parent_unavailable' } }, 404);
  }
  if (error instanceof ReplyToReplyError) {
    return c.json({ error: { code: 'reply_to_reply' } }, 400);
  }
  if (error instanceof OwnPostError) return c.json({ error: { code: 'own_post' } }, 400);
  if (error instanceof AlreadyReportedError) {
    return c.json({ error: { code: 'already_reported' } }, 409);
  }
  if (error instanceof RateLimitedError) return c.json({ error: { code: 'rate_limited' } }, 429);
  if (error instanceof InvalidTransitionError) {
    return c.json({ error: { code: 'invalid_transition' } }, 409);
  }
  if (error instanceof NoOpenReportsError) {
    return c.json({ error: { code: 'no_open_reports' } }, 409);
  }
  throw error;
}

/**
 * Discussão por aula (M5-05), do ALUNO: sob `/api/lessons/:id/discussion` (os portões de sessão e termos de
 * `/lessons/*` valem). Texto simples, um nível, sem HTML. Ler exige que a aula ABRA para a pessoa (acesso,
 * expiração, drip e sequência); escrever, editar, excluir e denunciar reverificam isso a cada chamada e
 * travam a matrícula. Aula retirada some junto com as conversas (os posts ficam guardados). A Staff em prévia
 * não escreve: sem matrícula, é 403.
 */
export function discussionRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const now = () => (deps.clock ?? (() => new Date()))();
  const clock = deps.clock ? { clock: deps.clock } : {};

  async function session(c: DiscussionContext) {
    return c.var.auth.api.getSession({ headers: c.req.raw.headers });
  }
  const badId = (c: DiscussionContext, ...ids: string[]) =>
    ids.some((id) => !UUID.test(id)) ? c.json({ error: { code: 'not_found' } }, 404) : null;

  routes.get('/lessons/:id/discussion', deps.withDatabase, async (c) => {
    const current = await session(c);
    if (!current) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    const invalid = badId(c, lessonId);
    if (invalid) return invalid;
    const gate = await checkLessonAccess(c.var.db, current.user.id, lessonId, now());
    if (gate.kind === 'denied') {
      return c.json({ error: { code: 'access_denied', reason: gate.reason } }, 403);
    }
    if (gate.kind === 'locked') {
      return c.json(
        { error: { code: 'lesson_locked', reason: gate.reason, releasesAt: gate.releasesAt } },
        403,
      );
    }
    if (gate.kind === 'not_found') return c.json({ error: { code: 'not_found' } }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json(await listLessonDiscussion(c.var.db, { userId: current.user.id, lessonId }));
  });

  routes.post('/lessons/:id/discussion/posts', deps.withDatabase, async (c) => {
    const current = await session(c);
    if (!current) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    const invalid = badId(c, lessonId);
    if (invalid) return invalid;
    const parsed = createPostSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    try {
      const post = await createPost(c.var.db, {
        userId: current.user.id,
        lessonId,
        body: parsed.data.body,
        parentId: parsed.data.parentId,
        ...clock,
      });
      return c.json({ post }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.patch('/lessons/:id/discussion/posts/:postId', deps.withDatabase, async (c) => {
    const current = await session(c);
    if (!current) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    const postId = c.req.param('postId');
    const invalid = badId(c, lessonId, postId);
    if (invalid) return invalid;
    const parsed = editPostSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    try {
      const post = await editPost(c.var.db, {
        userId: current.user.id,
        lessonId,
        postId,
        body: parsed.data.body,
        ...clock,
      });
      return c.json({ post });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/lessons/:id/discussion/posts/:postId/delete', deps.withDatabase, async (c) => {
    const current = await session(c);
    if (!current) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    const postId = c.req.param('postId');
    const invalid = badId(c, lessonId, postId);
    if (invalid) return invalid;
    c.header('Cache-Control', 'no-store');
    try {
      await deleteOwnPost(c.var.db, { userId: current.user.id, lessonId, postId, ...clock });
      return c.json({ deleted: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/lessons/:id/discussion/posts/:postId/report', deps.withDatabase, async (c) => {
    const current = await session(c);
    if (!current) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    const postId = c.req.param('postId');
    const invalid = badId(c, lessonId, postId);
    if (invalid) return invalid;
    const parsed = reportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    try {
      await reportPost(c.var.db, {
        userId: current.user.id,
        lessonId,
        postId,
        reason: parsed.data.reason,
        ...clock,
      });
      return c.json({ reported: true }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

/**
 * Moderação e resposta da equipe (M5-05), sob `/api/staff/discussions`. SÓ com o grant `discussion.moderate`
 * (conferido no servidor a cada requisição; o Suporte sem o grant recebe 403). Ocultar, restaurar e excluir
 * pedem MOTIVO e ficam na auditoria, na mesma transação.
 */
export function discussionStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const guarded = [deps.withDatabase, requireCapability('discussion.moderate')] as const;
  const actor = (c: DiscussionContext) => c.var.access!.userId;

  routes.get('/discussions', ...guarded, async (c) => {
    const view = c.req.query('view') === 'unanswered' ? 'unanswered' : 'reported';
    c.header('Cache-Control', 'no-store');
    return c.json({ view, items: await listStaffDiscussions(c.var.db, view) });
  });

  routes.post('/discussions/posts/:id/reply', ...guarded, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = staffReplySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const post = await staffReply(c.var.db, {
        actorId: actor(c),
        parentId: id,
        body: parsed.data.body,
      });
      return c.json({ post }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/discussions/posts/:id/moderate', ...guarded, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = moderateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      return c.json(
        await moderatePost(c.var.db, {
          actorId: actor(c),
          postId: id,
          action: parsed.data.action,
          reason: parsed.data.reason,
        }),
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.post('/discussions/posts/:id/dismiss', ...guarded, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = dismissSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      return c.json(
        await dismissReports(c.var.db, {
          actorId: actor(c),
          postId: id,
          reason: parsed.data.reason,
        }),
      );
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}
