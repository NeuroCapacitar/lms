import './zod-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/app.css';
import { installClientEpoch } from './pwa/client-epoch';
import { startOfflineRefresh } from './offline/runtime';
import { registerPwa } from './pwa/register';
import { routeTree } from './routeTree.gen';
import { applyTheme, readThemePreference } from './theme';

// Aplica a preferência salva antes da primeira renderização (sem script inline, compatível com CSP).
applyTheme(readThemePreference());

// PWA (M8-01): a época do cliente em todo /api e o Service Worker (só em produção).
installClientEpoch();
registerPwa();
// Offline do aluno (M8-02): renova o lease em segundo plano, só para quem já usou o app online neste aparelho.
startOfflineRefresh();

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// Relatório de erros fora do caminho crítico de carregamento.
void import('./observability').then(({ initWebObservability }) => initWebObservability());
