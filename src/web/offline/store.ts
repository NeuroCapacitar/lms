import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import { advanceClock } from '../../features/pwa/offline-lease';

/**
 * Armazenamento offline do aluno (M8-02): UM banco IndexedDB por usuário (nome derivado do hash do `userId`), então o dado
 * de uma conta nunca é lido por outra no mesmo navegador. Só guarda o que o servidor já entregou àquela pessoa (aula de
 * texto liberada, mapa do curso) e o lease; nunca cookie, token, segredo, vídeo ou dado da Staff. O app tolera a ausência de
 * tudo isto: o navegador pode apagar o banco a qualquer momento.
 */
export interface OfflineMeta {
  userId: string;
  lastVerifiedAt: number | null;
  /** O maior instante (epoch ms do relógio do aparelho) já visto: só sobe, exceto ao reverificar online. */
  maxSeenClock: number | null;
}

export interface StoredLease {
  courseId: string;
  /** Fim do lease em epoch ms do relógio do aparelho (já descontada a diferença para o servidor). */
  leaseUntil: number;
  verifiedAt: number;
}

export interface StoredLesson {
  lessonId: string;
  courseId: string;
  savedAt: number;
  view: LessonViewDto;
}

export interface StoredOutline {
  courseId: string;
  savedAt: number;
  outline: CourseOutlineDto;
}

export interface OfflineStore {
  getMeta(): Promise<OfflineMeta | null>;
  /** Lê o maior instante visto e o avança para `max(visto, now)`, de forma atômica (várias abas). Devolve o valor ANTERIOR. */
  touchClock(userId: string, now: number): Promise<number | null>;
  /**
   * Grava uma verificação online: meta (relógio zerado em `now`), os leases e a poda de tudo o que não tem mais lease
   * (acesso expirado, revogado ou suspenso). Numa única transação.
   */
  applyVerification(input: { userId: string; now: number; leases: StoredLease[] }): Promise<void>;
  getLease(courseId: string): Promise<StoredLease | null>;
  putLesson(record: StoredLesson): Promise<void>;
  getLesson(lessonId: string): Promise<StoredLesson | null>;
  listLessonIds(courseId: string): Promise<string[]>;
  putOutline(record: StoredOutline): Promise<void>;
  getOutline(courseId: string): Promise<StoredOutline | null>;
  /** Apaga TUDO desta conta (conta com papel de Staff, ou purga). */
  clearAll(): Promise<void>;
  close(): void;
}

/** Versão do esquema. Qualquer mudança incompatível PURGA os dados antigos (são só uma cópia; o servidor é a fonte). */
const SCHEMA_VERSION = 1;
const META_KEY = 'meta';

interface StoreDef {
  name: string;
  keyPath?: string;
  indexes?: { name: string; keyPath: string }[];
}

const STORE_DEFS: StoreDef[] = [
  { name: 'meta' },
  { name: 'leases', keyPath: 'courseId' },
  { name: 'lessons', keyPath: 'lessonId', indexes: [{ name: 'byCourse', keyPath: 'courseId' }] },
  { name: 'outlines', keyPath: 'courseId' },
];

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb_request_failed'));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb_tx_failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb_tx_aborted'));
  });
}

function openOnce(name: string, version: number, defs: StoreDef[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Versão antiga e incompatível: purga tudo e recria (nunca tenta migrar uma cópia).
      for (const existing of Array.from(db.objectStoreNames)) db.deleteObjectStore(existing);
      for (const def of defs) {
        const store = db.createObjectStore(def.name, def.keyPath ? { keyPath: def.keyPath } : {});
        for (const index of def.indexes ?? []) store.createIndex(index.name, index.keyPath);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Outra aba pediu atualização ou exclusão do banco: libera a conexão para não travar.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('idb_open_failed'));
    request.onblocked = () => reject(new Error('idb_open_blocked'));
  });
}

/** Abre (ou cria) o banco. Banco criado por versão MAIS NOVA do app (rollback): apaga e recria vazio. */
async function openDatabase(name: string, version: number, defs: StoreDef[]): Promise<IDBDatabase> {
  try {
    return await openOnce(name, version, defs);
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'VersionError') throw error;
    await deleteDatabase(name);
    return openOnce(name, version, defs);
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('idb_delete_failed'));
    request.onblocked = () => resolve();
  });
}

/** Nome do banco da conta: hash do `userId`, para o identificador não aparecer no nome. */
async function offlineDatabaseName(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`hub-offline:v1:${userId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `hub-offline-${hex}`;
}

export async function openOfflineStore(userId: string): Promise<OfflineStore> {
  const db = await openDatabase(await offlineDatabaseName(userId), SCHEMA_VERSION, STORE_DEFS);
  const stored = async <T>(storeName: string, key: IDBValidKey) => {
    const tx = db.transaction(storeName, 'readonly');
    return ((await wrap(tx.objectStore(storeName).get(key))) as T | undefined) ?? null;
  };
  const put = async (storeName: string, value: unknown, key?: IDBValidKey) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    await finished(tx);
  };

  return {
    getMeta: () => stored<OfflineMeta>('meta', META_KEY),

    async touchClock(ownerId, now) {
      const tx = db.transaction('meta', 'readwrite');
      const meta = tx.objectStore('meta');
      const current = ((await wrap(meta.get(META_KEY))) as OfflineMeta | undefined) ?? null;
      const previous = current?.maxSeenClock ?? null;
      // Sem meta (nunca verificada) não há o que avançar: o lease também não existe.
      if (current) {
        meta.put(
          { ...current, userId: ownerId, maxSeenClock: advanceClock(previous, now) },
          META_KEY,
        );
      }
      await finished(tx);
      return previous;
    },

    async applyVerification({ userId: ownerId, now, leases }) {
      const tx = db.transaction(['meta', 'leases', 'lessons', 'outlines'], 'readwrite');
      const allowed = new Set(leases.map((lease) => lease.courseId));
      const meta: OfflineMeta = { userId: ownerId, lastVerifiedAt: now, maxSeenClock: now };
      tx.objectStore('meta').put(meta, META_KEY);
      const leaseStore = tx.objectStore('leases');
      for (const lease of leases) leaseStore.put(lease);
      // Poda: o que não tem mais lease (acesso terminou, foi revogado ou suspenso) sai do aparelho.
      for (const key of (await wrap(leaseStore.getAllKeys())) as string[]) {
        if (!allowed.has(key)) leaseStore.delete(key);
      }
      for (const storeName of ['lessons', 'outlines'] as const) {
        const store = tx.objectStore(storeName);
        for (const record of (await wrap(store.getAll())) as { courseId: string }[]) {
          if (allowed.has(record.courseId)) continue;
          store.delete(
            storeName === 'lessons'
              ? (record as unknown as StoredLesson).lessonId
              : record.courseId,
          );
        }
      }
      await finished(tx);
    },

    getLease: (courseId) => stored<StoredLease>('leases', courseId),
    putLesson: (record) => put('lessons', record),
    getLesson: (lessonId) => stored<StoredLesson>('lessons', lessonId),
    async listLessonIds(courseId) {
      const tx = db.transaction('lessons', 'readonly');
      const keys = await wrap(tx.objectStore('lessons').index('byCourse').getAllKeys(courseId));
      return keys.map(String);
    },
    putOutline: (record) => put('outlines', record),
    getOutline: (courseId) => stored<StoredOutline>('outlines', courseId),

    async clearAll() {
      const tx = db.transaction(['meta', 'leases', 'lessons', 'outlines'], 'readwrite');
      for (const name of ['meta', 'leases', 'lessons', 'outlines']) tx.objectStore(name).clear();
      await finished(tx);
    },
    close: () => db.close(),
  };
}

/** Ponteiro "quem usou o app por último neste aparelho": só um id, sem dado de estudo. */
const INDEX_DB = 'hub-offline-index';
const INDEX_STORE: StoreDef = { name: 'current' };
const INDEX_KEY = 'user';

export interface OfflineIndex {
  get(): Promise<string | null>;
  set(userId: string | null): Promise<void>;
}

export function createOfflineIndex(): OfflineIndex {
  const open = () => openDatabase(INDEX_DB, 1, [INDEX_STORE]);
  return {
    async get() {
      const db = await open();
      try {
        const tx = db.transaction('current', 'readonly');
        const value = (await wrap(tx.objectStore('current').get(INDEX_KEY))) as unknown;
        return typeof value === 'string' ? value : null;
      } finally {
        db.close();
      }
    },
    async set(userId) {
      const db = await open();
      try {
        const tx = db.transaction('current', 'readwrite');
        if (userId === null) tx.objectStore('current').delete(INDEX_KEY);
        else tx.objectStore('current').put(userId, INDEX_KEY);
        await finished(tx);
      } finally {
        db.close();
      }
    },
  };
}
