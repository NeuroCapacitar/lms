import type { OfflineCommand, RejectionReason } from '../../features/pwa/offline-sync';
import {
  databaseExists,
  deleteDatabase,
  finished,
  hashedDatabaseName,
  openDatabase,
  wrap,
  type StoreDef,
} from './store';

/**
 * Outbox offline do aluno (M8-03): UM banco por conta (`hub-outbox-<hash do userId>`), SEPARADO dos dados de estudo
 * (`hub-offline-*`) de propósito: expirar a sessão ou trocar de conta apaga o que foi guardado para ESTUDAR, mas NÃO apaga o que
 * a pessoa ainda não conseguiu enviar. Só sai por duas vias: o servidor responde (aplicado ou recusado e a pessoa lê o aviso) ou a
 * pessoa confirma, ao sair da conta, que quer descartar. Guarda ids e o título da aula (para o aviso); nunca texto da aula.
 */
export interface OutboxItem {
  clientOperationId: string;
  command: OfflineCommand;
  lessonId: string;
  courseId: string;
  lessonTitle: string;
  /** Hora do aparelho: só metadado e ordem de envio. */
  createdAt: number;
  attempts: number;
  state: 'pending' | 'rejected';
  reason?: RejectionReason;
}

type NewOutboxItem = Pick<
  OutboxItem,
  'clientOperationId' | 'command' | 'lessonId' | 'courseId' | 'lessonTitle' | 'createdAt'
>;

export interface OutboxStore {
  /** Guarda o comando. Já havendo um PENDENTE para a mesma aula, devolve esse (`created: false`): clicar duas vezes não duplica. */
  enqueue(item: NewOutboxItem): Promise<{ item: OutboxItem; created: boolean }>;
  /** Todos, do mais antigo para o mais novo. */
  list(): Promise<OutboxItem[]>;
  /** Aplicou ou já estava aplicado: sai do outbox. */
  remove(ids: string[]): Promise<void>;
  /** O servidor recusou: fica VISÍVEL com o motivo até a pessoa dispensar. */
  markRejected(id: string, reason: RejectionReason): Promise<void>;
  /** Tentativa que não chegou ao servidor (rede, erro 5xx). */
  bumpAttempts(ids: string[]): Promise<void>;
  close(): void;
}

const OUTBOX_STORE: StoreDef = { name: 'ops', keyPath: 'clientOperationId' };
const OUTBOX_VERSION = 1;

const outboxDatabaseName = (userId: string) => hashedDatabaseName('hub-outbox', userId);

export async function openOutbox(userId: string): Promise<OutboxStore> {
  const db = await openDatabase(await outboxDatabaseName(userId), OUTBOX_VERSION, [OUTBOX_STORE]);
  const all = async () => {
    const tx = db.transaction('ops', 'readonly');
    const rows = (await wrap(tx.objectStore('ops').getAll())) as OutboxItem[];
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  };
  return {
    async enqueue(item) {
      const tx = db.transaction('ops', 'readwrite');
      const store = tx.objectStore('ops');
      const rows = (await wrap(store.getAll())) as OutboxItem[];
      const existing = rows.find(
        (row) => row.lessonId === item.lessonId && row.state === 'pending',
      );
      if (existing) {
        await finished(tx);
        return { item: existing, created: false };
      }
      const created: OutboxItem = { ...item, attempts: 0, state: 'pending' };
      store.put(created);
      await finished(tx);
      return { item: created, created: true };
    },
    list: all,
    async remove(ids) {
      const tx = db.transaction('ops', 'readwrite');
      for (const id of ids) tx.objectStore('ops').delete(id);
      await finished(tx);
    },
    async markRejected(id, reason) {
      const tx = db.transaction('ops', 'readwrite');
      const store = tx.objectStore('ops');
      const row = (await wrap(store.get(id))) as OutboxItem | undefined;
      if (row) store.put({ ...row, state: 'rejected', reason });
      await finished(tx);
    },
    async bumpAttempts(ids) {
      const tx = db.transaction('ops', 'readwrite');
      const store = tx.objectStore('ops');
      for (const id of ids) {
        const row = (await wrap(store.get(id))) as OutboxItem | undefined;
        if (row) store.put({ ...row, attempts: row.attempts + 1 });
      }
      await finished(tx);
    },
    close: () => db.close(),
  };
}

/** Descarta o outbox de uma conta (a pessoa confirmou ao sair). Nunca lança. */
export async function deleteOutbox(userId: string): Promise<void> {
  try {
    await deleteDatabase(await outboxDatabaseName(userId));
  } catch {
    // Fica para a próxima tentativa.
  }
}

/** Há outbox desta conta? (perguntar NÃO cria o banco: sem nada pendente o aparelho fica sem nenhum banco). */
export async function outboxExists(userId: string): Promise<boolean> {
  return databaseExists(await outboxDatabaseName(userId));
}

/** Há outbox de QUALQUER conta neste aparelho? Sem `indexedDB.databases()` assume que não (nada a procurar). */
export async function anyOutboxExists(): Promise<boolean> {
  try {
    return ((await indexedDB.databases?.()) ?? []).some((info) =>
      info.name?.startsWith('hub-outbox-'),
    );
  } catch {
    return false;
  }
}
