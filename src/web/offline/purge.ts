import { deleteAllOfflineDatabases } from './store';

/**
 * Purga do aparelho (M8-05): tudo o que pertence a uma PESSOA sai daqui. Roda por JavaScript (o `Clear-Site-Data` do servidor é
 * só uma segunda defesa, e o Safari pode não honrá-lo): bancos IndexedDB offline, caches da Cache API, `sessionStorage` e o
 * `localStorage` (menos o que NÃO é da pessoa). O cache do TanStack Query é limpo por quem chama (`onLocalPurge`).
 */

/** O pré-cache do Workbox guarda só o shell estático PÚBLICO (sem dado de ninguém): apagá-lo quebraria o app sem rede. */
const KEEP_CACHE = /^workbox-precache/;

/** Preferência de tema (sem dado pessoal) e o retorno do login (curto e criado ANTES de entrar) não são da pessoa. */
const KEEP_LOCAL_KEYS = new Set(['hub-theme', 'hub:return-to']);

async function deleteUserCaches(): Promise<void> {
  try {
    for (const name of await caches.keys()) {
      if (!KEEP_CACHE.test(name)) await caches.delete(name);
    }
  } catch {
    // Sem Cache API (ou bloqueada): não há o que apagar.
  }
}

function clearStorages(): void {
  try {
    sessionStorage.clear();
  } catch {
    // Armazenamento bloqueado: nada a limpar.
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (!KEEP_LOCAL_KEYS.has(key)) localStorage.removeItem(key);
    }
  } catch {
    // Idem.
  }
}

export async function purgeBrowserData(): Promise<void> {
  clearStorages();
  await Promise.all([deleteAllOfflineDatabases(), deleteUserCaches()]);
}
