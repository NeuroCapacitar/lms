import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { AuthVars } from '../auth/types';
import {
  CompletionAccessDeniedError,
  LessonLockedError,
  LessonNotFoundError,
  completeLesson,
} from './completion';
import { getCourseOutline, getLesson } from './learning-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Estudo (M3-03): o mapa do curso e a aula. Só para quem tem sessão e aceitou os termos (os portões de
 * `/courses/*` e `/lessons/*` são registrados antes, em `auth/routes.ts`) e tem ACESSO ao curso.
 * O servidor decide tudo; a resposta de aula bloqueada nunca contém o conteúdo.
 */
export function learningRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  /** Relógio (testes). O padrão é o do servidor. */
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const now = () => (deps.clock ?? (() => new Date()))();

  routes.get('/courses/:id/outline', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const courseId = c.req.param('id');
    if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
    const result = await getCourseOutline(c.var.db, session.user.id, courseId, now());
    if (result.kind === 'denied') {
      return c.json({ error: { code: 'access_denied', reason: result.reason } }, 403);
    }
    if (result.kind === 'not_found') return c.json({ error: { code: 'not_found' } }, 404);
    return c.json(result.outline);
  });

  routes.get('/lessons/:id', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    if (!UUID.test(lessonId)) return c.json({ error: { code: 'not_found' } }, 404);
    const result = await getLesson(c.var.db, session.user.id, lessonId, now());
    if (result.kind === 'denied') {
      return c.json({ error: { code: 'access_denied', reason: result.reason } }, 403);
    }
    if (result.kind === 'locked') {
      return c.json(
        { error: { code: 'lesson_locked', reason: result.reason, releasesAt: result.releasesAt } },
        403,
      );
    }
    if (result.kind === 'not_found') return c.json({ error: { code: 'not_found' } }, 404);
    return c.json(result.view);
  });

  /**
   * Concluir a aula de texto (M3-04). Sem corpo. 201 concluiu agora; 200 já estava concluída. Só com
   * matrícula, acesso válido e a aula ABERTA (drip e sequência, a mesma regra do mapa); Staff sem
   * matrícula recebe 403: a prévia da Staff não grava progresso.
   */
  routes.post('/lessons/:id/complete', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    if (!UUID.test(lessonId)) return c.json({ error: { code: 'not_found' } }, 404);
    try {
      const result = await completeLesson(c.var.db, {
        userId: session.user.id,
        lessonId,
        ...(deps.clock ? { clock: deps.clock } : {}),
      });
      return c.json(
        {
          status: result.status,
          progress: result.progress,
          courseCompleted: result.courseCompleted,
          courseJustCompleted: result.courseJustCompleted,
          courseCompletedAt: result.courseCompletedAt
            ? result.courseCompletedAt.toISOString()
            : null,
        },
        result.status === 'completed' ? 201 : 200,
      );
    } catch (error) {
      if (error instanceof LessonNotFoundError) {
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
      throw error;
    }
  });

  return routes;
}
