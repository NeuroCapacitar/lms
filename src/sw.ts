/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  matchPrecache,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

import { NAVIGATION_DENYLIST_PATTERNS, OFFLINE_PAGE, isNavigationDenied } from './features/pwa/pwa';

/**
 * Service Worker do Hub (M8-01). Só o SHELL ESTÁTICO com hash é pré-cacheado; NADA de `/api/*` é cacheado aqui (os
 * dados offline ficam no IndexedDB do app, M8-02). A Staff é só-online: navegação para ela, para o checkout, para a
 * validação pública do certificado e para `/cdn-cgi/` vai SEMPRE à rede e, sem rede, mostra a página "só online".
 * Atualização: o SW novo fica `waiting`; o app decide o momento seguro e manda `SKIP_WAITING` (nunca automático).
 */
declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Navegação do aluno e das páginas públicas: o shell da SPA, mesmo offline.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [...NAVIGATION_DENYLIST_PATTERNS],
  }),
);

// Navegação que NUNCA vem do cache: rede; sem rede, a página estática "só online".
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && isNavigationDenied(url.pathname),
  async ({ request }) => {
    try {
      return await fetch(request);
    } catch {
      // O pré-cache guarda a URL com a revisão (`?__WB_REVISION__=`): `matchPrecache` resolve isso.
      const offline = await matchPrecache(OFFLINE_PAGE);
      return offline ?? Response.error();
    }
  },
);

// O app pede a ativação do SW novo quando está numa fronteira segura (nunca `skipWaiting` automático).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting();
});
