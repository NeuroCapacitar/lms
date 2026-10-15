/**
 * Diagnóstico do armazenamento do aparelho (M8-04). O gate do iPhone exige PROVAR o que ficou no aparelho (por exemplo, que depois
 * de sair não sobrou nenhum banco nem cache), e o Safari do iPhone não tem inspetor sem um Mac: esta tela mostra o necessário e
 * gera um texto para colar na evidência. Só CONTA coisas: nunca mostra conteúdo, e-mail, id de pessoa, token nem texto de aula.
 */
export interface DiagnosticsReport {
  generatedAt: string;
  timeZone: string;
  online: boolean;
  userAgent: string;
  /** Aberto pela tela inicial (PWA instalada), e não numa aba do Safari. */
  standalone: boolean;
  /** SHA do build que está respondendo (de `/api/health/live`), se alcançável. */
  release: string | null;
  serviceWorker: { supported: boolean; controlled: boolean; registrations: string[] };
  storage: { usage: number | null; quota: number | null; persisted: boolean | null };
  databases: { name: string; stores: { name: string; count: number }[] }[];
  caches: { name: string; entries: number }[];
  localStorageKeys: number;
  sessionStorageKeys: number;
}

/** Tudo o que a coleta toca no navegador: injetável para testar sem navegador. */
export interface DiagnosticsEnv {
  now(): Date;
  timeZone(): string;
  online(): boolean;
  userAgent(): string;
  standalone(): boolean;
  release(): Promise<string | null>;
  serviceWorker(): Promise<DiagnosticsReport['serviceWorker']>;
  storage(): Promise<DiagnosticsReport['storage']>;
  databases(): Promise<DiagnosticsReport['databases']>;
  caches(): Promise<DiagnosticsReport['caches']>;
  localStorageKeys(): number;
  sessionStorageKeys(): number;
}

async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

export async function collectDiagnostics(env: DiagnosticsEnv): Promise<DiagnosticsReport> {
  return {
    generatedAt: env.now().toISOString(),
    timeZone: env.timeZone(),
    online: env.online(),
    userAgent: env.userAgent(),
    standalone: env.standalone(),
    release: await safely(() => env.release(), null),
    serviceWorker: await safely(() => env.serviceWorker(), {
      supported: false,
      controlled: false,
      registrations: [],
    }),
    storage: await safely(() => env.storage(), { usage: null, quota: null, persisted: null }),
    databases: await safely(() => env.databases(), []),
    caches: await safely(() => env.caches(), []),
    localStorageKeys: env.localStorageKeys(),
    sessionStorageKeys: env.sessionStorageKeys(),
  };
}

const MB = 1024 * 1024;
const mb = (bytes: number | null) => (bytes === null ? 'n/d' : `${(bytes / MB).toFixed(2)} MB`);

/** O relatório como texto simples, para colar na evidência do gate. */
export function formatDiagnostics(report: DiagnosticsReport): string {
  const lines = [
    `Relatório do aparelho (${report.generatedAt}, ${report.timeZone})`,
    `Build: ${report.release ?? 'n/d'}`,
    `Rede: ${report.online ? 'online' : 'offline'}`,
    `Modo: ${report.standalone ? 'app instalado (tela inicial)' : 'aba do navegador'}`,
    `Navegador: ${report.userAgent}`,
    `Service Worker: ${report.serviceWorker.supported ? 'suportado' : 'NÃO suportado'}; ${
      report.serviceWorker.controlled ? 'controla esta página' : 'não controla esta página'
    }; registros: ${report.serviceWorker.registrations.join(', ') || 'nenhum'}`,
    `Armazenamento: usa ${mb(report.storage.usage)} de ${mb(report.storage.quota)}; persistente: ${
      report.storage.persisted === null ? 'n/d' : report.storage.persisted ? 'sim' : 'não'
    }`,
    `Bancos IndexedDB (${report.databases.length}):`,
    ...(report.databases.length === 0
      ? ['  nenhum']
      : report.databases.map(
          (db) =>
            `  ${db.name}: ${db.stores.map((store) => `${store.name}=${store.count}`).join(', ') || 'sem tabelas'}`,
        )),
    `Caches (${report.caches.length}):`,
    ...(report.caches.length === 0
      ? ['  nenhum']
      : report.caches.map((cache) => `  ${cache.name}: ${cache.entries} itens`)),
    `localStorage: ${report.localStorageKeys} chaves; sessionStorage: ${report.sessionStorageKeys} chaves`,
  ];
  return lines.join('\n');
}

/** O ambiente real do navegador. Nada aqui lê conteúdo: só nomes e contagens. */
export function browserDiagnosticsEnv(): DiagnosticsEnv {
  return {
    now: () => new Date(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: () => navigator.onLine,
    userAgent: () => navigator.userAgent,
    standalone: () =>
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches,

    async release() {
      const response = await fetch('/api/health/live', { cache: 'no-store' });
      if (!response.ok) return null;
      return ((await response.json()) as { releaseId?: string }).releaseId ?? null;
    },

    async serviceWorker() {
      if (!('serviceWorker' in navigator)) {
        return { supported: false, controlled: false, registrations: [] };
      }
      const registrations = await navigator.serviceWorker.getRegistrations();
      return {
        supported: true,
        controlled: navigator.serviceWorker.controller !== null,
        registrations: registrations.map(
          (item) =>
            `${new URL(item.scope).pathname} (${item.active?.state ?? item.waiting?.state ?? item.installing?.state ?? 'sem worker'})`,
        ),
      };
    },

    async storage() {
      const estimate = await navigator.storage?.estimate?.();
      return {
        usage: estimate?.usage ?? null,
        quota: estimate?.quota ?? null,
        persisted: (await navigator.storage?.persisted?.()) ?? null,
      };
    },

    async databases() {
      const out: DiagnosticsReport['databases'] = [];
      for (const info of (await indexedDB.databases?.()) ?? []) {
        if (!info.name) continue;
        // Se o banco sumiu entre a listagem e a abertura, não o recria vazio e segue (nunca deixa um banco fantasma).
        const db = await new Promise<IDBDatabase | null>((resolve) => {
          const request = indexedDB.open(info.name!);
          request.onupgradeneeded = () => request.transaction?.abort();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        if (!db) continue;
        try {
          const stores: { name: string; count: number }[] = [];
          for (const name of Array.from(db.objectStoreNames)) {
            const count = await new Promise<number>((resolve, reject) => {
              const request = db.transaction(name, 'readonly').objectStore(name).count();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            stores.push({ name, count });
          }
          out.push({ name: info.name, stores });
        } finally {
          db.close();
        }
      }
      return out;
    },

    async caches() {
      const out: DiagnosticsReport['caches'] = [];
      for (const name of await caches.keys()) {
        out.push({ name, entries: (await (await caches.open(name)).keys()).length });
      }
      return out;
    },

    localStorageKeys: () => safeCount(() => localStorage.length),
    sessionStorageKeys: () => safeCount(() => sessionStorage.length),
  };
}

function safeCount(read: () => number): number {
  try {
    return read();
  } catch {
    return 0;
  }
}
