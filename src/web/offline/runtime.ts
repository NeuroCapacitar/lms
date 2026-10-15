import { offlineLeaseSchema } from '../../features/pwa/offline-lease';
import { createOfflineService, type OfflineDeps } from './service';
import { createOfflineIndex, openOfflineStore } from './store';

/**
 * Liga o núcleo do offline ao navegador (M8-02): `fetch` da identidade e do lease, relógio, IndexedDB e cota. Falha de REDE
 * lança `TypeError` (o `fetch` do navegador); resposta inesperada lança `Error`: quem chama decide (escrever é melhor
 * esforço; ler vira bloqueio). Nada aqui lê cookie: a sessão vai sozinha no `fetch` same-origin.
 */
const deps: OfflineDeps = {
  now: () => Date.now(),

  async fetchIdentity() {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (response.status === 401) return { kind: 'anonymous' };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || body.id === '') throw new Error('identity_invalid');
    return { kind: 'user', userId: body.id };
  },

  async fetchLease() {
    const response = await fetch('/api/offline/lease', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    });
    if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      if (body?.error?.code === 'offline_not_available') return { kind: 'unavailable' };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { kind: 'ok', lease: offlineLeaseSchema.parse(await response.json()) };
  },

  index: createOfflineIndex(),
  openStore: openOfflineStore,

  async storageEstimate() {
    return navigator.storage?.estimate?.();
  },
  requestPersistence() {
    return navigator.storage?.persist?.() ?? Promise.resolve(false);
  },
};

export const offline = createOfflineService(deps);

/**
 * Verificação de fundo: ao abrir o app, quando a rede volta e quando a aba fica visível (só para quem já é conhecido neste
 * aparelho). Renova o lease; nunca interrompe nem avisa nada.
 */
export function startOfflineRefresh() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  const run = () => {
    if (navigator.onLine) void offline.refreshInBackground();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  run();
}
