import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { ZodType } from 'zod';

import type { Database } from '../../db/client';
import { outboxMessage } from '../../db/schema';
import {
  INTENT_KINDS,
  PRIORITY,
  RETENTION_DAYS,
  type IntentKind,
  type IntentPayload,
} from '../../features/async/intents';
import {
  claimRows,
  completeRow,
  failRow,
  markRowDead,
  peekRow,
  purgeRows,
  requeueRow,
  type ClaimedRow,
  type FailureKind,
  type FailureOutcome,
  type RowSnapshot,
} from './lease';

/** A transação de domínio. O `Database` comum NÃO é atribuível a ela (falta `rollback`): o tipo já impede. */
export type DomainTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Intenção inválida: `kind` desconhecido ou payload fora do contrato (inclui qualquer dado pessoal). */
export class InvalidIntentError extends Error {
  constructor(reason: string) {
    super(`invalid_intent:${reason}`);
  }
}

/** A mesma `dedupeKey` já existe para OUTRO `kind`: nunca devolva a intenção alheia como se fosse esta. */
export class DedupeKeyConflictError extends Error {
  constructor() {
    super('dedupe_key_conflict');
  }
}

export interface EnqueueInput<Kind extends IntentKind> {
  kind: Kind;
  /** Idempotência da intenção (ex.: `email:<templateId>:<userId>:<evento>`). Repetir não duplica. */
  dedupeKey: string;
  /** Só IDs; o formato exato vem de `INTENT_KINDS`. */
  payload: IntentPayload<Kind>;
  correlationId: string;
  /** Padrão: transacional. */
  priority?: number;
  /** Para agendar (padrão: já). Hora do relógio de quem chama; o claim compara com o `now()` do banco. */
  availableAt?: Date;
}

export interface EnqueueResult {
  id: string;
  /** `false`: a `dedupeKey` já existia (repetição idempotente); nada novo foi gravado. */
  created: boolean;
}

/**
 * Grava a intenção NA transação de domínio: se ela der rollback, a intenção some junto (nada órfão);
 * se der commit, a intenção é durável mesmo que nada seja enfileirado depois. EXIGE o `tx`.
 */
export async function enqueueIntent<Kind extends IntentKind>(
  tx: DomainTx,
  input: EnqueueInput<Kind>,
): Promise<EnqueueResult> {
  // Defesa em tempo de execução para quem contorna o tipo (`as never`): só a transação tem `rollback`.
  if (typeof (tx as { rollback?: unknown }).rollback !== 'function') {
    throw new InvalidIntentError('transaction_required');
  }
  const definition = INTENT_KINDS[input.kind] as
    | { queue: 'finance' | 'general'; payload: ZodType }
    | undefined;
  if (!definition) throw new InvalidIntentError('unknown_kind');
  const parsed = definition.payload.safeParse(input.payload);
  if (!parsed.success) throw new InvalidIntentError('payload');

  const inserted = await tx
    .insert(outboxMessage)
    .values({
      kind: input.kind,
      queue: definition.queue,
      dedupeKey: input.dedupeKey,
      payload: parsed.data as Record<string, unknown>,
      priority: input.priority ?? PRIORITY.transactional,
      availableAt: input.availableAt ?? sql`now()`,
      correlationId: input.correlationId,
    })
    .onConflictDoNothing({ target: outboxMessage.dedupeKey })
    .returning({ id: outboxMessage.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };

  const [existing] = await tx
    .select({ id: outboxMessage.id, kind: outboxMessage.kind })
    .from(outboxMessage)
    .where(eq(outboxMessage.dedupeKey, input.dedupeKey));
  if (!existing || existing.kind !== input.kind) throw new DedupeKeyConflictError();
  return { id: existing.id, created: false };
}

export const DEFAULT_LEASE_SECONDS = 120;

/** Reivindica até `limit` intenções (pendentes vencidas e leases expirados). Cada claim sobe o `leaseVersion`. */
export function claimOutbox(
  db: Database,
  limit: number,
  owner: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): Promise<ClaimedRow[]> {
  return claimRows(db, 'outbox_message', limit, owner, leaseSeconds);
}

/**
 * Reivindica UMA intenção pelo id (é o que o consumidor da Queue recebe). `undefined` = não era
 * reivindicável agora (já concluída, com lease vivo de outro worker, ainda no atraso do backoff ou
 * inexistente); `peekOutbox` diz o que aconteceu.
 */
export async function claimOutboxById(
  db: Database,
  id: string,
  owner: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): Promise<ClaimedRow | undefined> {
  const [claimed] = await claimRows(db, 'outbox_message', 1, owner, leaseSeconds, { id });
  return claimed;
}

export function peekOutbox(db: Database, id: string): Promise<RowSnapshot | undefined> {
  return peekRow(db, 'outbox_message', id);
}

/** Decisão do sistema (DLQ, envelope inválido): encerra como `dead` com o motivo. `false` = já estava final. */
export function markOutboxDead(db: Database, id: string, code: string): Promise<boolean> {
  return markRowDead(db, 'outbox_message', id, code);
}

/** `false` = lease perdido: descarte o resultado e não repita o efeito. */
export function completeOutbox(db: Database, id: string, leaseVersion: number): Promise<boolean> {
  return completeRow(db, 'outbox_message', id, leaseVersion);
}

export function failOutbox(
  db: Database,
  id: string,
  leaseVersion: number,
  failure: { kind: FailureKind; code: string },
  random?: () => number,
): Promise<FailureOutcome> {
  return failRow(db, 'outbox_message', id, leaseVersion, failure, random);
}

export function requeueOutbox(
  db: Database,
  id: string,
  leaseVersion: number,
  delaySeconds: number,
): Promise<boolean> {
  return requeueRow(db, 'outbox_message', id, leaseVersion, delaySeconds);
}

/** Retenção (chamada pelo Cron do M4-03): entregues e substituídas 30 dias; `failed` e `dead` 180 dias. */
export function purgeOutbox(db: Database): Promise<number> {
  return purgeRows(db, 'outbox_message', {
    doneDays: RETENTION_DAYS.done,
    problemDays: RETENTION_DAYS.problem,
  });
}

/** Quanto tempo uma intenção `pending` já disponível espera antes de o Cron presumir a mensagem perdida. */
const REPUBLISH_AFTER_SECONDS = 300;

const republishable = or(
  and(
    eq(outboxMessage.state, 'pending'),
    sql`${outboxMessage.availableAt} <= now() - make_interval(secs => ${REPUBLISH_AFTER_SECONDS})`,
  ),
  and(eq(outboxMessage.state, 'leased'), sql`${outboxMessage.leaseUntil} < now()`),
);

export interface RepublishableIntent {
  id: string;
  kind: string;
  correlationId: string;
}

/** Há algo que o Cron deva republicar? (uma consulta barata: o Cron sai cedo se não houver) */
export async function hasRepublishable(db: Database): Promise<boolean> {
  const [found] = await db
    .select({ id: outboxMessage.id })
    .from(outboxMessage)
    .where(republishable)
    .limit(1);
  return found !== undefined;
}

/**
 * As intenções cuja mensagem presumivelmente se perdeu (publish que falhou, consumidor morto, mensagem
 * descartada da Queue): `pending` disponíveis há mais de 5 min e `leased` com lease vencido. Só as
 * lanes pedidas (a pausada fica de fora). Não reivindica: quem reivindica é o consumidor, ao receber.
 */
export function listRepublishable(
  db: Database,
  options: { lanes: readonly ('finance' | 'general')[]; limit: number },
): Promise<RepublishableIntent[]> {
  if (options.lanes.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: outboxMessage.id,
      kind: outboxMessage.kind,
      correlationId: outboxMessage.correlationId,
    })
    .from(outboxMessage)
    .where(and(republishable, inArray(outboxMessage.queue, [...options.lanes])))
    .orderBy(outboxMessage.priority, outboxMessage.availableAt, outboxMessage.id)
    .limit(options.limit);
}
