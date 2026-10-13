import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { AuthVars } from '../auth/types';
import {
  CompletionAccessDeniedError,
  LessonLockedError,
  LessonNotFoundError,
  completeLesson,
} from './completion';
import { videoProgressSchema } from '../../features/video/progress';
import { attemptBodySchema } from '../../features/quiz/grading';
import { getCourseOutline, getLesson } from './learning-store';
import {
  InvalidAnswersError,
  QuizAlreadyPassedError,
  QuizAttemptsExhaustedError,
  submitQuizAttempt,
} from './quiz-attempts';
import {
  VideoAssetMismatchError,
  VideoNotMeasurableError,
  reportVideoProgress,
} from './video-progress';

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

  /**
   * Progresso da aula de VÍDEO (M5-02): heartbeat, pausa, seek, fim, aba oculta e saída da página (o
   * cliente usa `fetch` com `keepalive`, com o cabeçalho de origem e o `content-type` JSON que o CSRF do
   * projeto exige; não `sendBeacon`). DTO estrito. A cada chamada o servidor reverifica acesso, drip e
   * sequência; só a MAIOR posição vale; seq repetido ou menor é ignorado; conclui no limiar do curso. Não há
   * conclusão manual de vídeo. 200 sempre que o envio foi aceito (inclusive o ignorado); a conclusão vem em
   * `completion`. Staff sem matrícula recebe 403: a prévia não grava.
   */
  routes.post('/lessons/:id/video-progress', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    if (!UUID.test(lessonId)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = videoProgressSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    try {
      const result = await reportVideoProgress(c.var.db, {
        userId: session.user.id,
        lessonId,
        report: parsed.data,
        ...(deps.clock ? { clock: deps.clock } : {}),
      });
      return c.json({
        status: result.status,
        maxPosition: result.maxPosition,
        durationSeconds: result.durationSeconds,
        completed: result.completed,
        ...(result.completion
          ? {
              completion: {
                status: result.completion.status,
                progress: result.completion.progress,
                courseCompleted: result.completion.courseCompleted,
                courseJustCompleted: result.completion.courseJustCompleted,
              },
            }
          : {}),
      });
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
      if (error instanceof VideoAssetMismatchError) {
        return c.json({ error: { code: 'video_asset_mismatch' } }, 409);
      }
      if (error instanceof VideoNotMeasurableError) {
        return c.json({ error: { code: 'video_not_measurable', reason: error.reason } }, 409);
      }
      throw error;
    }
  });

  /**
   * Tentativa de QUIZ (M5-04): só online, corrigida AQUI. O corpo traz só as opções marcadas por questão (DTO
   * estrito); a nota e a aprovação nunca vêm do cliente. A cada chamada o servidor reverifica acesso, drip e
   * sequência, trava a matrícula (tentativas simultâneas entram em fila) e respeita o máximo de tentativas.
   * 201 com a nota; o gabarito só volta se o quiz tem feedback `immediate`. Staff sem matrícula recebe 403: a
   * prévia não grava.
   */
  routes.post('/lessons/:id/quiz-attempts', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const lessonId = c.req.param('id');
    if (!UUID.test(lessonId)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = attemptBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    try {
      const result = await submitQuizAttempt(c.var.db, {
        userId: session.user.id,
        lessonId,
        answers: parsed.data.answers,
        ...(deps.clock ? { clock: deps.clock } : {}),
      });
      return c.json(
        {
          attempt: result.attempt,
          attemptsUsed: result.attemptsUsed,
          attemptsLeft: result.attemptsLeft,
          ...(result.review ? { review: result.review } : {}),
          ...(result.completion
            ? {
                completion: {
                  status: result.completion.status,
                  progress: result.completion.progress,
                  courseCompleted: result.completion.courseCompleted,
                  courseJustCompleted: result.completion.courseJustCompleted,
                },
              }
            : {}),
        },
        201,
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
      if (error instanceof InvalidAnswersError) {
        return c.json({ error: { code: 'invalid_answers' } }, 400);
      }
      if (error instanceof QuizAlreadyPassedError) {
        return c.json({ error: { code: 'quiz_already_passed' } }, 409);
      }
      if (error instanceof QuizAttemptsExhaustedError) {
        return c.json({ error: { code: 'attempts_exhausted' } }, 409);
      }
      throw error;
    }
  });

  return routes;
}
