import * as Sentry from '@sentry/react';

import { MINIMAL_DATA_COLLECTION } from '../features/observability/data-collection';
import { scrubEvent } from '../features/observability/scrub';

/**
 * Relatório de erros do SPA (ADR 0028). Carregado depois da primeira renderização
 * (ver main.tsx) para não pesar no caminho crítico. Sem DSN, não faz nada.
 */
export function initWebObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: __APP_ENV__,
    release: __RELEASE_ID__,
    dataCollection: MINIMAL_DATA_COLLECTION,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event),
  });
}
