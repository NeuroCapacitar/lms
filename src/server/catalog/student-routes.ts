import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { toAccessDto } from '../../features/access/access';
import {
  toCatalogCourse,
  type CatalogCourseDto,
  type StudentCatalogItem,
} from '../../features/catalog/student-catalog';
import { resolveAccess } from '../access/entitlement-store';
import type { AuthVars } from '../auth/types';
import { listMyInterests } from '../interest/store';
import { listPublicCourses } from './catalog-store';

/**
 * Catálogo do aluno (M2-04): `GET /api/catalog/courses`. Só com sessão (401) e com o aceite dos termos
 * em dia (o portão de `/catalog/*` é registrado antes, em `auth/routes.ts`). Devolve apenas cursos
 * publicados com currículo publicado, no formato `CatalogCourseDto` (sem título interno, autoria nem
 * estado de rascunho), mais o `access` da pessoa (M3-02: "inscrito até...", "expirou", "suspenso").
 * Sem vitrine pública em lista: visitante sem sessão não vê nada.
 */
export function studentCatalogRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get('/courses', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const now = (deps.clock ?? (() => new Date()))();
    const visible = (await listPublicCourses(c.var.db))
      .map(toCatalogCourse)
      .filter((item): item is CatalogCourseDto => item !== null);
    const interests = new Set(
      (await listMyInterests(c.var.db, session.user.id))
        .filter((item) => item.status === 'active')
        .map((item) => item.courseId),
    );
    const courses: StudentCatalogItem[] = [];
    for (const item of visible) {
      courses.push({
        ...item,
        access: toAccessDto(await resolveAccess(c.var.db, session.user.id, item.id, now)),
        interested: interests.has(item.id),
      });
    }
    return c.json({ courses });
  });

  return routes;
}
