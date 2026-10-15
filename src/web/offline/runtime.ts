import { offlineLeaseSchema } from '../../features/pwa/offline-lease';
import { MAX_SYNC_BATCH, syncResponseSchema } from '../../features/pwa/offline-sync';
import { requestSignOut } from '../api/auth';
import { markBusy } from '../pwa/safe-boundary';
import { anyOutboxExists, deleteOutbox, openOutbox, outboxExists } from './outbox';
import { purgeBrowserData } from './purge';
import { createOfflineService, type OfflineDeps, type PurgeReason, type SyncCall } from './service';
import { createOfflineIndex, createPendingSignOut, openOfflineStore } from './store';

/**
 * Liga o núcleo do offline ao navegador (M8-02): `fetch` da identidade e do lease, relógio, IndexedDB e cota. Falha de REDE
 * lança `TypeError` (o `fetch` do navegador); resposta inesperada lança `Error`: quem chama decide (escrever é melhor
 * esforço; ler vira bloqueio). Nada aqui lê cookie: a sessão vai sozinha no `fetch` same-origin.
 */
/** As abas deste navegador se avisam: sair ou trocar de conta numa delas limpa a tela das outras na hora. */
const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('hub-offline');
const purgeListeners = new Set<(reason: PurgeReason, remote: boolean) => void>();

/** Chamado quando os dados da pessoa saem do aparelho (por esta aba ou por outra). `remote`: foi outra aba. */
export function onLocalPurge(listener: (reason: PurgeReason, remote: boolean) => void): () => void {
  purgeListeners.add(listener);
  return () => purgeListeners.delete(listener);
}

const outboxListeners = new Set<() => void>();
const appliedListeners = new Set<() => void>();

/** Chamado quando o servidor aplicou conclusões enviadas pelo outbox: o progresso mostrado pode estar velho. */
export function onOutboxApplied(listener: () => void): () => void {
  appliedListeners.add(listener);
  return () => appliedListeners.delete(listener);
}

/** Chamado quando o outbox muda (nesta aba ou em outra): as telas relêem as pendências. */
export function onOutboxChange(listener: () => void): () => void {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
}

const PURGE_REASONS: readonly string[] = ['sign_out', 'account_changed', 'session_ended'];
channel?.addEventListener(
  'message',
  (event: MessageEvent<{ purged?: string; outbox?: string }>) => {
    if (event.data?.outbox === 'changed') {
      for (const listener of outboxListeners) listener();
      return;
    }
    const reason = event.data?.purged;
    if (typeof reason !== 'string' || !PURGE_REASONS.includes(reason)) return;
    for (const listener of purgeListeners) listener(reason as PurgeReason, true);
  },
);

const deps: OfflineDeps = {
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
  openOutbox,
  outboxExists,
  anyOutbox: anyOutboxExists,
  deleteOutbox,
  notifyOutboxChanged() {
    channel?.postMessage({ outbox: 'changed' });
    for (const listener of outboxListeners) listener();
  },
  busy: (reason) => markBusy(reason),
  notifyApplied() {
    for (const listener of appliedListeners) listener();
  },

  async postSync(input): Promise<SyncCall> {
    const response = await fetch('/api/offline/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        expectedUserId: input.expectedUserId,
        operations: input.operations.slice(0, MAX_SYNC_BATCH),
      }),
    });
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (response.status === 409) return { kind: 'wrong_account' };
    if (!response.ok) return { kind: 'error' };
    const parsed = syncResponseSchema().safeParse(await response.json().catch(() => null));
    return parsed.success ? { kind: 'ok', results: parsed.data.results } : { kind: 'error' };
  },

  async purgeLocal(reason) {
    try {
      await purgeBrowserData();
    } finally {
      channel?.postMessage({ purged: reason });
      for (const listener of purgeListeners) listener(reason, false);
    }
  },
  requestSignOut,
  pendingSignOut: createPendingSignOut(),

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
    return { kind: 'ok', lease: offlineLeaseSchema().parse(await response.json()) };
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
 * Logo depois de entrar (link, senha ou Google): confere quem entrou e, se for OUTRA pessoa, apaga o que era da anterior antes de
 * qualquer tela ler dado local. Espera pouco (a verificação é de fundo) e nunca lança.
 */
export async function afterSignIn(): Promise<void> {
  await Promise.race([
    offline.refreshInBackground(),
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);
}

/**
 * Verificação de fundo: ao abrir o app, quando a rede volta e quando a aba fica visível (só para quem já é conhecido neste
 * aparelho). Renova o lease; nunca interrompe nem avisa nada.
 */
export function startOfflineRefresh() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  const run = () => {
    // Também revoga no servidor um "sair" feito sem rede, e confere se a sessão e a pessoa ainda são as mesmas (M8-05).
    if (navigator.onLine) void offline.refreshInBackground();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  run();
}
