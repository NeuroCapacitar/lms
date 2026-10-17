import { Hono } from 'hono';

import { withDatabase } from '../../db/client';
import { PUBLIC_CACHE_TTL, servePublicCached, waitUntilOf } from '../http/public-cache';
import { loadPublicCoursePage } from './public-page';

/**
 * `GET /api/public/courses/:slug` (M2-06): o curso publicado para qualquer pessoa, sem sessão. Slug
 * malformado, inexistente, rascunho, arquivado e sem currículo publicado respondem 404 IDÊNTICO.
 */
export function publicCourseRoutes() {
  const routes = new Hono<{ Bindings: Env }>();
  // Cache de borda curto (M9-07): dado público e igual para todos; só guarda leitura bem-sucedida do banco.
  routes.get('/courses/:slug', (c) =>
    servePublicCached({
      request: c.req.raw,
      waitUntil: waitUntilOf(c),
      produce: async () => {
        const page = await withDatabase(c.env.HYPERDRIVE, (db) =>
          loadPublicCoursePage(db, c.req.param('slug'), c.env.MEDIA_PUBLIC_BASE_URL),
        );
        return page
          ? { response: c.json(page), ttl: PUBLIC_CACHE_TTL.found }
          : {
              response: c.json({ error: { code: 'not_found' } }, 404),
              ttl: PUBLIC_CACHE_TTL.missing,
            };
      },
    }),
  );
  return routes;
}
