import type { Database } from '../../db/client';
import { parseEnvelope, queueOfKind } from '../../features/async/envelope';
import { INTENT_KINDS, retryDelayMs, type QueueName } from '../../features/async/intents';
import type { Alert } from './alerts';
import { isQueuePaused } from './flags';
import { PermanentError, TransientError, type HandlerRegistry } from './handlers';
import {
  DEFAULT_LEASE_SECONDS,
  claimOutboxById,
  completeOutbox,
  failOutbox,
  markOutboxDead,
  peekOutbox,
} from './outbox-store';

/** O que o consumidor precisa de uma mensagem da Queue (o `Message` do Workers cabe aqui). */
export interface QueueMessageLike {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface ConsumerDeps {
  /** A lane da fila deste lote (só mensagens do `kind` desta lane são executadas). */
  lane: QueueName;
  /** Abre o banco sob demanda: um lote só de mensagens inválidas não acorda o Neon. */
  getDb: () => Promise<Database>;
  sendToDeadLetter: (body: unknown) => Promise<void>;
  handlers: HandlerRegistry;
  /** Identifica quem tem o lease (uma invocação do consumidor). */
  owner: string;
  alert: Alert;
  leaseSeconds?: number;
  random?: () => number;
}

/** Atraso ao devolver uma mensagem por falha de infraestrutura (banco fora do ar, Queue indisponível). */
const INFRASTRUCTURE_RETRY_SECONDS = 30;
const MAX_RETRY_DELAY_SECONDS = 3600;

/**
 * Consumidor da fila de trabalho (M4-02). Para cada mensagem: valida o envelope (inválido, de versão
 * ou `kind` desconhecido vai para a DLQ com alerta, nunca ack silencioso); respeita o kill switch;
 * REIVINDICA a intenção no Postgres (a Queue só carrega o id: a verdade e o payload estão no banco);
 * executa o handler do `kind`; conclui com fencing. Entrega at-least-once: a mesma mensagem pode chegar
 * duas vezes e o claim garante que só uma execução vale.
 *
 * Kill switch ligado: a mensagem é CONFIRMADA e a intenção segue `pending` no banco, sem tentativa
 * gasta. Devolvê-la à Queue com atraso gastaria `max_retries` e a mandaria à DLQ numa pausa longa;
 * quem republica o que ficou `pending` depois da pausa é o Cron (M4-03).
 */
export async function processBatch(
  messages: readonly QueueMessageLike[],
  deps: ConsumerDeps,
): Promise<void> {
  let paused: boolean | undefined;
  for (const message of messages) {
    try {
      const parsed = parseEnvelope(message.body);
      if (!parsed.ok) {
        await deadLetter(message, deps, parsed.problem);
        continue;
      }
      const { envelope } = parsed;
      if (queueOfKind(envelope.kind) !== deps.lane) {
        await deadLetter(
          message,
          deps,
          'queue_mismatch',
          envelope.intentId,
          envelope.correlationId,
        );
        continue;
      }

      const db = await deps.getDb();
      paused ??= await isQueuePaused(db, deps.lane);
      if (paused) {
        message.ack();
        continue;
      }
      await runIntent(message, envelope, db, deps);
    } catch {
      // Falha de infraestrutura (banco, Queue): devolve a mensagem; nada foi perdido (o banco é a verdade).
      deps.alert({ code: 'consumer_infrastructure_error', queue: deps.lane });
      message.retry({ delaySeconds: INFRASTRUCTURE_RETRY_SECONDS });
    }
  }
}

async function deadLetter(
  message: QueueMessageLike,
  deps: ConsumerDeps,
  reason: string,
  intentId?: string,
  correlationId?: string,
): Promise<void> {
  // Se o envio à DLQ falhar, a exceção sobe e a mensagem é devolvida (nunca confirmada sem destino).
  await deps.sendToDeadLetter(message.body);
  deps.alert({ code: 'message_dead_lettered', queue: deps.lane, reason, intentId, correlationId });
  message.ack();
}

async function runIntent(
  message: QueueMessageLike,
  envelope: { kind: keyof typeof INTENT_KINDS; intentId: string; correlationId: string },
  db: Database,
  deps: ConsumerDeps,
): Promise<void> {
  const leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const claimed = await claimOutboxById(db, envelope.intentId, deps.owner, leaseSeconds);
  if (!claimed) {
    // Duplicata (já concluída ou com lease vivo de outro worker) e inexistente: confirma. Adiantada
    // (ainda no atraso do backoff): devolve para quando a linha puder ser reivindicada.
    const snapshot = await peekOutbox(db, envelope.intentId);
    if (snapshot?.state === 'pending' && snapshot.waitSeconds > 0) {
      message.retry({ delaySeconds: Math.min(snapshot.waitSeconds, MAX_RETRY_DELAY_SECONDS) });
    } else {
      message.ack();
    }
    return;
  }

  const random = deps.random ?? Math.random;
  const drawn = random();
  const fixedRandom = () => drawn; // o mesmo sorteio no banco e no atraso da Queue
  const fail = async (failure: { kind: 'transient' | 'permanent'; code: string }) => {
    const outcome = await failOutbox(db, claimed.id, claimed.leaseVersion, failure, fixedRandom);
    const context = {
      queue: deps.lane,
      intentId: claimed.id,
      correlationId: claimed.correlationId,
      reason: failure.code,
    };
    if (outcome === 'retry') {
      message.retry({
        delaySeconds: Math.min(
          Math.ceil(retryDelayMs(claimed.attempts, fixedRandom) / 1000),
          MAX_RETRY_DELAY_SECONDS,
        ),
      });
      return;
    }
    if (outcome === 'dead') deps.alert({ code: 'intent_dead', ...context });
    if (outcome === 'failed') deps.alert({ code: 'intent_failed', ...context });
    message.ack();
  };

  // A linha é a verdade: o envelope não pode mandar executar outro `kind`.
  if (claimed.kind !== envelope.kind) {
    await fail({ kind: 'permanent', code: 'envelope_kind_mismatch' });
    return;
  }
  const payload = INTENT_KINDS[envelope.kind].payload.safeParse(claimed.payload);
  if (!payload.success) {
    await fail({ kind: 'permanent', code: 'payload_invalid' });
    return;
  }

  try {
    await (deps.handlers[envelope.kind] as (context: unknown) => Promise<void>)({
      db,
      payload: payload.data,
      intentId: claimed.id,
      correlationId: claimed.correlationId,
      idempotencyKey: claimed.dedupeKey ?? claimed.id,
      attempt: claimed.attempts,
    });
  } catch (error) {
    await fail(
      error instanceof PermanentError
        ? { kind: 'permanent', code: error.code }
        : error instanceof TransientError
          ? { kind: 'transient', code: error.code }
          : { kind: 'transient', code: 'handler_unexpected' },
    );
    return;
  }

  // `false` = o lease se perdeu durante o handler: outro worker assumiu; este resultado é descartado.
  await completeOutbox(db, claimed.id, claimed.leaseVersion);
  message.ack();
}

export interface DeadLetterDeps {
  getDb: () => Promise<Database>;
  alert: Alert;
}

/**
 * Consumidor da DLQ (M4-02). A DLQ da Cloudflare retém as mensagens por poucos dias; o Postgres é a
 * verdade. Aqui a intenção ainda aberta vira `dead` com o motivo, e um alerta sinaliza que há trabalho
 * humano. Mensagem ilegível (sem id de intenção) só gera o alerta: não há linha para marcar.
 */
export async function processDeadLetters(
  messages: readonly QueueMessageLike[],
  deps: DeadLetterDeps,
): Promise<void> {
  for (const message of messages) {
    try {
      const parsed = parseEnvelope(message.body);
      const intentId = parsed.ok ? parsed.envelope.intentId : parsed.intentId;
      if (intentId) {
        const marked = await markOutboxDead(await deps.getDb(), intentId, 'dlq_exhausted');
        deps.alert({
          code: 'dead_letter_received',
          intentId,
          reason: marked ? 'marked_dead' : 'already_final',
        });
      } else {
        deps.alert({
          code: 'dead_letter_unreadable',
          reason: parsed.ok ? undefined : parsed.problem,
        });
      }
      message.ack();
    } catch {
      deps.alert({ code: 'dead_letter_infrastructure_error' });
      message.retry({ delaySeconds: 60 });
    }
  }
}
