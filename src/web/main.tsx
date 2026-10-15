import './zod-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/app.css';
import { installClientEpoch } from './pwa/client-epoch';
import { onLocalPurge, startOfflineRefresh } from './offline/runtime';
import { registerPwa } from './pwa/register';
import { routeTree } from './routeTree.gen';
import { applyTheme, readThemePreference } from './theme';

// Aplica a preferência salva antes da primeira renderização (sem script inline, compatível com CSP).
applyTheme(readThemePreference());

// PWA (M8-01): a época do cliente em todo /api e o Service Worker (só em produção).
installClientEpoch();
registerPwa();

const queryClient = new QueryClient();
// M8-05: quando os dados da pessoa saem do aparelho (sair, trocar de conta, sessão encerrada) o cache de consultas vai junto; se foi
// OUTRA aba que limpou, esta volta à página inicial em vez de seguir mostrando a tela da pessoa anterior.
onLocalPurge((reason, remote) => {
  // Sair da conta: a tela vai embora, tudo é descartado. Troca de conta ou sessão encerrada em segundo plano: `resetQueries` joga fora
  // os dados da pessoa anterior e REBUSCA o que a tela aberta usa agora (com `clear`, uma consulta em andamento ficaria presa em
  // "Carregando…").
  if (reason === 'sign_out') queryClient.clear();
  else void queryClient.resetQueries();
  if (remote) window.location.replace('/');
});
// Offline do aluno (M8-02/M8-05): renova o lease e confere a sessão em segundo plano, só para quem já usou o app neste aparelho.
// Depois de registrar o ouvinte acima, para nenhuma limpeza passar sem o cache de consultas saber.
startOfflineRefresh();
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
