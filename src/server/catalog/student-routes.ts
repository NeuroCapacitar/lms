import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { toCatalogCourse, type CatalogCourseDto } from '../../features/catalog/student-catalog';
import type { AuthVars } from '../auth/types';
import { listPublicCourses } from './catalog-store';

/**
 * Catálogo do aluno (M2-04): `GET /api/catalog/courses`. Só com sessão (401) e com o aceite dos termos
 * em dia (o portão de `/catalog/*` é registrado antes, em `auth/routes.ts`). Devolve apenas cursos
 * publicados com currículo publicado, no formato `CatalogCourseDto` (sem título interno, autoria,
 * estado de rascunho nem id de oferta). Sem vitrine pública em lista: visitante sem sessão não vê nada.
 */
export function studentCatalogRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get('/courses', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const courses = (await listPublicCourses(c.var.db))
      .map(toCatalogCourse)
      .filter((item): item is CatalogCourseDto => item !== null);
    return c.json({ courses });
  });

  return routes;
}
