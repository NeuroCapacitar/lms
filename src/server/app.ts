import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { withDatabase } from '../db/client';
import { authRoutes, type AuthRouteOverrides } from './auth/routes';
import { injectMeta, serveCoursePage } from './catalog/course-page';
import { loadPublicCoursePage } from './catalog/public-page';
import { publicCourseRoutes } from './catalog/public-routes';
import { loggingMiddleware, type LogVariables } from './logging';
import { RELEASE_ID } from './release';
import { csrfProtection } from './security/csrf';
import { securityHeaders } from './security/headers';
import { sentryMiddleware } from './sentry';

/**
 * Composição HTTP do Worker. Aqui só entram adapters de entrada; regras de negócio
 * ficam em `src/features` e nunca importam Hono (ver docs/architecture.md).
 */
export function createApp(options: { auth?: AuthRouteOverrides } = {}) {
  const app = new Hono<{ Bindings: Env } & LogVariables>();

  app.use(sentryMiddleware(app));
  app.use(loggingMiddleware());
  app.use('/api/*', securityHeaders());
  app.use('/api/*', csrfProtection());

  app.get('/api/health/live', (c) => c.json({ status: 'ok', releaseId: RELEASE_ID }));

  // Pronto = consegue consultar o banco do ambiente. Sem detalhes na resposta.
  // Atenção: acorda o Neon Free; a proteção do endpoint chega com o Operations Center (M4/M9).
  app.get('/api/health/ready', async (c) => {
    try {
      await withDatabase(c.env.HYPERDRIVE, (db) => db.execute(sql`select 1`));
      return c.json({ status: 'ok', releaseId: RELEASE_ID });
    } catch (error) {
      c.get('log').error(error instanceof Error ? error : new Error('ready_failed'), {
        check: 'ready',
      });
      return c.json({ status: 'unavailable', releaseId: RELEASE_ID }, 503);
    }
  });

  // Curso público (M2-06): a API sem sessão e a página `/cursos/:slug` com meta tags (HTMLRewriter).
  app.route('/api/public', publicCourseRoutes());
  app.get('/cursos/*', (c) =>
    serveCoursePage(c.req.raw, c.env, {
      loadCourse: (env, slug) =>
        withDatabase(env.HYPERDRIVE, (db) => loadPublicCoursePage(db, slug)),
      inject: injectMeta,
      onError: (error) =>
        c.get('log')?.error(error instanceof Error ? error : new Error('course_page_failed')),
    }),
  );

  app.route('/api', authRoutes(options.auth));

  // Qualquer /api desconhecida devolve JSON, nunca o HTML da SPA.
  app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));

  // Sem detalhes do erro na resposta; o evento amplo (evlog) e o Sentry recebem o erro, já limpo.
  app.onError((err, c) => {
    c.get('log')?.error(err);
    return c.json({ error: { code: 'internal_error' } }, 500);
  });

  return app;
}
