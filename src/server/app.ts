import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { withDatabase } from '../db/client';
import { CLIENT_EPOCH_HEADER, isClientOutdated } from '../features/pwa/pwa';
import { authRoutes, type AuthRouteOverrides } from './auth/routes';
import { injectMeta, resolveCoursePage } from './catalog/course-page';
import { servePublicCached, waitUntilOf } from './http/public-cache';
import { loadPublicCoursePage } from './catalog/public-page';
import { publicLoginMediaRoutes } from './banner/routes';
import { publicHelpRoutes } from './help/routes';
import { publicCourseRoutes } from './catalog/public-routes';
import {
  lookupPublicCertificate,
  publicCertificateRoutes,
  serveCertificatePage,
} from './certificate/public-routes';
import { loggingMiddleware, type LogVariables } from './logging';
import { RELEASE_ID } from './release';
import { csrfProtection } from './security/csrf';
import { securityHeaders } from './security/headers';
import { sentryMiddleware } from './sentry';
import { asaasWebhookRoutes } from './webhooks/asaas-routes';
import { resendWebhookRoutes } from './webhooks/resend-routes';

/**
 * Composição HTTP do Worker. Aqui só entram adapters de entrada; regras de negócio
 * ficam em `src/features` e nunca importam Hono (ver docs/architecture.md).
 */
export function createApp(options: { auth?: AuthRouteOverrides } = {}) {
  const app = new Hono<{ Bindings: Env } & LogVariables>();

  app.use(sentryMiddleware(app));
  app.use(loggingMiddleware());
  app.use('/api/*', securityHeaders());
  // PWA (M8-01): cliente com época antiga recebe 409 e a tela pede recarga. Sem o cabeçalho (webhooks, curl): passa.
  app.use('/api/*', async (c, next) => {
    if (isClientOutdated(c.req.header(CLIENT_EPOCH_HEADER))) {
      return c.json({ error: { code: 'client_outdated' } }, 409);
    }
    await next();
  });
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
  // Endereço de suporte para quem não consegue entrar (M5-14).
  app.route('/api/public', publicHelpRoutes());
  // Imagens decorativas da tela de login (M5-15).
  app.route('/api/public', publicLoginMediaRoutes());
  // Validação pública do certificado (M7-08): a API sem sessão e a página `/certificados/:code` com meta tags.
  app.route('/api/public', publicCertificateRoutes());
  app.get('/certificados/*', (c) =>
    serveCertificatePage(c.req.raw, c.env, {
      shell: (env, requestUrl) => env.ASSETS.fetch(new Request(new URL('/', requestUrl))),
      lookup: (code, ip) =>
        withDatabase(c.env.HYPERDRIVE, (db) => lookupPublicCertificate(db, { code, ip })),
      onError: (error) =>
        c.get('log')?.error(error instanceof Error ? error : new Error('certificate_page_failed')),
    }),
  );
  // Cache de borda curto (M9-07): a página só depende do slug; falha de banco e SPA pura nunca são guardadas.
  app.get('/cursos/*', (c) =>
    servePublicCached({
      request: c.req.raw,
      waitUntil: waitUntilOf(c),
      produce: () =>
        resolveCoursePage(c.req.raw, c.env, {
          loadCourse: (env, slug) =>
            withDatabase(env.HYPERDRIVE, (db) =>
              loadPublicCoursePage(db, slug, env.MEDIA_PUBLIC_BASE_URL),
            ),
          inject: injectMeta,
          onError: (error) =>
            c.get('log')?.error(error instanceof Error ? error : new Error('course_page_failed')),
        }),
    }),
  );

  // Webhooks de provedores (assinatura própria, fora do CSRF): só o do Resend por ora (M4-07).
  app.route('/api/webhooks', resendWebhookRoutes());
  // Webhook do Asaas (M6-03): token próprio, inbox antes do ACK.
  app.route('/api/webhooks', asaasWebhookRoutes());

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
