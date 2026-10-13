import { Hono } from 'hono';

import { withDatabase } from '../../db/client';
import { loadPublicCoursePage } from './public-page';

/**
 * `GET /api/public/courses/:slug` (M2-06): o curso publicado para qualquer pessoa, sem sessão. Slug
 * malformado, inexistente, rascunho, arquivado e sem currículo publicado respondem 404 IDÊNTICO.
 */
export function publicCourseRoutes() {
  const routes = new Hono<{ Bindings: Env }>();
  routes.get('/courses/:slug', async (c) => {
    const page = await withDatabase(c.env.HYPERDRIVE, (db) =>
      loadPublicCoursePage(db, c.req.param('slug'), c.env.MEDIA_PUBLIC_BASE_URL),
    );
    return page ? c.json(page) : c.json({ error: { code: 'not_found' } }, 404);
  });
  return routes;
}
