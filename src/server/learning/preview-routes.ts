import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { getPreviewLesson, getPreviewOutline } from './preview-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prévia de aluno (M3-07), sob `/api/staff/preview`: SÓ LEITURA e só para quem tem papel de Staff
 * (`staff.read`, sem grant). Aluno comum recebe 403. Não existe rota de escrita aqui: a Staff sem
 * matrícula também não consegue gravar nada pelas rotas do aluno (concluir aula exige matrícula).
 * Devolve o mesmo formato das rotas do aluno, com `preview: true`.
 */
export function previewRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const now = () => (deps.clock ?? (() => new Date()))();

  routes.get(
    '/preview/courses/:id/outline',
    deps.withDatabase,
    requireCapability('staff.read'),
    async (c) => {
      const courseId = c.req.param('id');
      if (!UUID.test(courseId)) return c.json({ error: { code: 'not_found' } }, 404);
      const outline = await getPreviewOutline(c.var.db, courseId, now());
      return outline ? c.json(outline) : c.json({ error: { code: 'not_found' } }, 404);
    },
  );

  routes.get(
    '/preview/courses/:id/lessons/:lessonId',
    deps.withDatabase,
    requireCapability('staff.read'),
    async (c) => {
      const { id: courseId, lessonId } = c.req.param();
      if (!UUID.test(courseId) || !UUID.test(lessonId)) {
        return c.json({ error: { code: 'not_found' } }, 404);
      }
      const view = await getPreviewLesson(c.var.db, courseId, lessonId);
      return view ? c.json(view) : c.json({ error: { code: 'not_found' } }, 404);
    },
  );

  return routes;
}
