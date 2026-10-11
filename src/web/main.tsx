import './zod-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/app.css';
import { routeTree } from './routeTree.gen';
import { applyTheme, readThemePreference } from './theme';

// Aplica a preferência salva antes da primeira renderização (sem script inline, compatível com CSP).
applyTheme(readThemePreference());

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
