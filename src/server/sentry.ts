import { sentry } from '@sentry/hono/cloudflare';
import type { Hono, MiddlewareHandler } from 'hono';

import { MINIMAL_DATA_COLLECTION } from '../features/observability/data-collection';
import { scrubEvent } from '../features/observability/scrub';
import { APP_ENV, RELEASE_ID } from './release';

/**
 * Relatório de erros do Worker no Sentry (ADR 0028). Sem `SENTRY_DSN` (desenvolvimento, testes)
 * o SDK fica desligado. Regras obrigatórias: coleta mínima (`dataCollection`), `beforeSend` que
 * limpa o evento, sem breadcrumbs (o SDK copiaria o console) e sem tracing (cota do plano Free).
 */
export function sentryMiddleware<E extends { Bindings: Env }>(app: Hono<E>): MiddlewareHandler {
  return sentry(app, (env) => ({
    dsn: env.SENTRY_DSN,
    environment: APP_ENV,
    release: RELEASE_ID,
    dataCollection: MINIMAL_DATA_COLLECTION,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event),
  }));
}
