import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { offlineOperation } from '../../db/schema';
import {
  offlineOperationSchema,
  type OfflineOperation,
  type RejectionReason,
  type SyncResultItem,
} from '../../features/pwa/offline-sync';
import {
  CompletionAccessDeniedError,
  LessonLockedError,
  LessonNotFoundError,
  loadLessonContext,
  recordCompletion,
} from '../learning/completion';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rejectionOf(error: unknown): RejectionReason | null {
  if (error instanceof LessonNotFoundError) return 'lesson_not_found';
  if (error instanceof LessonLockedError) return 'lesson_locked';
  if (error instanceof CompletionAccessDeniedError) return `access_${error.reason}`;
  return null;
}

type Reader = Pick<Database, 'select'>;

async function storedOutcome(reader: Reader, userId: string, id: string) {
  const [row] = await reader
    .select({ outcome: offlineOperation.outcome, reason: offlineOperation.reason })
    .from(offlineOperation)
    .where(and(eq(offlineOperation.userId, userId), eq(offlineOperation.clientOperationId, id)));
  return row ?? null;
}

function duplicateOf(
  index: number,
  id: string,
  row: { outcome: string; reason: string | null },
): SyncResultItem {
  return {
    index,
    clientOperationId: id,
    status: 'duplicate',
    original: row.outcome === 'applied' ? 'applied' : 'rejected',
    ...(row.reason ? { reason: row.reason as RejectionReason } : {}),
  };
}

/** Guarda a RECUSA como resultado definitivo daquele id (repetir devolve `duplicate`). Perdeu a corrida: devolve o que já estava. */
async function recordRejection(
  db: Database,
  userId: string,
  index: number,
  input: { id: string; command: string; lessonId: string | null; clientCreatedAt: Date | null },
  reason: RejectionReason,
): Promise<SyncResultItem> {
  const inserted = await db
    .insert(offlineOperation)
    .values({
      userId,
      clientOperationId: input.id,
      command: input.command.slice(0, 64),
      lessonId: input.lessonId,
      outcome: 'rejected',
      reason,
      clientCreatedAt: input.clientCreatedAt,
    })
    .onConflictDoNothing()
    .returning({ id: offlineOperation.clientOperationId });
  if (inserted.length > 0)
    return { index, clientOperationId: input.id, status: 'rejected', reason };
  const existing = await storedOutcome(db, userId, input.id);
  return existing
    ? duplicateOf(index, input.id, existing)
    : { index, clientOperationId: input.id, status: 'rejected', reason };
}

async function applyComplete(
  db: Database,
  userId: string,
  index: number,
  operation: OfflineOperation,
  clock: (() => Date) | undefined,
): Promise<SyncResultItem> {
  const clientCreatedAt = operation.clientCreatedAt ? new Date(operation.clientCreatedAt) : null;
  try {
    return await db.transaction(async (tx) => {
      // Reivindica o id NA MESMA transação do efeito: ou os dois acontecem, ou nenhum. Dois pedidos com o mesmo id: o segundo
      // espera o primeiro terminar e então encontra o registro (duplicate).
      const claimed = await tx
        .insert(offlineOperation)
        .values({
          userId,
          clientOperationId: operation.clientOperationId,
          command: operation.command,
          lessonId: operation.lessonId,
          outcome: 'applied',
          clientCreatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: offlineOperation.clientOperationId });
      if (claimed.length === 0) {
        const row = await storedOutcome(tx, userId, operation.clientOperationId);
        return duplicateOf(index, operation.clientOperationId, row!);
      }
      // O MESMO caso de uso online: acesso, expiração, drip e sequência (a hora do fato é a do servidor).
      const context = await loadLessonContext(tx, {
        userId,
        lessonId: operation.lessonId,
        kind: 'text',
        ...(clock ? { clock } : {}),
      });
      const result = await recordCompletion(tx, context, {
        userId,
        lessonId: operation.lessonId,
        method: 'manual',
      });
      return {
        index,
        clientOperationId: operation.clientOperationId,
        status: 'applied',
        effect: result.status,
        courseJustCompleted: result.courseJustCompleted,
      } satisfies SyncResultItem;
    });
  } catch (error) {
    const reason = rejectionOf(error);
    if (reason === null) throw error;
    return recordRejection(
      db,
      userId,
      index,
      {
        id: operation.clientOperationId,
        command: operation.command,
        lessonId: operation.lessonId,
        clientCreatedAt,
      },
      reason,
    );
  }
}

/**
 * Aplica o lote do outbox (M8-03), EM ORDEM e item a item. Cada comando passa pelo mesmo caso de uso do online; um item recusado
 * não derruba os outros; o primeiro resultado de cada `clientOperationId` é definitivo. Erro inesperado (banco fora) NÃO é
 * guardado e sobe: o cliente repete o lote e os já aplicados voltam como `duplicate`.
 */
export async function applyOfflineOperations(
  db: Database,
  userId: string,
  rawOperations: readonly unknown[],
  options: { clock?: () => Date } = {},
): Promise<SyncResultItem[]> {
  const results: SyncResultItem[] = [];
  for (const [index, raw] of rawOperations.entries()) {
    const parsed = offlineOperationSchema().safeParse(raw);
    if (parsed.success) {
      results.push(await applyComplete(db, userId, index, parsed.data, options.clock));
      continue;
    }
    // Sem id válido não há como deduplicar: recusa sem guardar. Com id válido (comando fora da allowlist ou corpo ruim): guarda.
    const candidate = raw as { clientOperationId?: unknown; command?: unknown } | null;
    const id =
      candidate &&
      typeof candidate.clientOperationId === 'string' &&
      UUID.test(candidate.clientOperationId)
        ? candidate.clientOperationId
        : null;
    const command = typeof candidate?.command === 'string' ? candidate.command : '';
    const reason: RejectionReason =
      command !== '' && command !== 'lesson.complete' ? 'command_not_allowed' : 'invalid_payload';
    if (id === null) {
      results.push({ index, clientOperationId: null, status: 'rejected', reason });
      continue;
    }
    results.push(
      await recordRejection(
        db,
        userId,
        index,
        {
          id,
          command: command === '' ? 'invalid' : command,
          lessonId: null,
          clientCreatedAt: null,
        },
        reason,
      ),
    );
  }
  return results;
}
