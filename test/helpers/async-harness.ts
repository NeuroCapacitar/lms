import { sql } from 'drizzle-orm';

import type { Database } from '../../src/db/client.ts';
import { buildEnvelope } from '../../src/features/async/envelope.ts';
import type { AlertEvent } from '../../src/server/async/alerts.ts';
import {
  processBatch,
  type ConsumerDeps,
  type QueueMessageLike,
} from '../../src/server/async/consumer.ts';
import {
  PermanentError,
  TransientError,
  type HandlerRegistry,
} from '../../src/server/async/handlers.ts';
import { enqueueIntent } from '../../src/server/async/outbox-store.ts';

/**
 * Ferramentas da fault matrix (M4-06): Queue simulada, mensagem falsa e um "provider" falso com falha
 * injetada por ponto. NADA aqui é produção: o que é testado é o código real (outbox, consumidor, Cron)
 * contra o Postgres real; só a borda externa é simulada.
 */
export const uuid = () => crypto.randomUUID();

export class FakeMessage implements QueueMessageLike {
  readonly id = uuid();
  attempts = 1;
  acked = false;
  retried: { delaySeconds?: number } | undefined;
  constructor(readonly body: unknown) {}
  ack() {
    this.acked = true;
  }
  retry(options?: { delaySeconds?: number }) {
    this.retried = options ?? {};
  }
}

/** Queue em memória: `send` guarda; `deliver` entrega TUDO o que está nela ao consumidor real. */
export class SimQueue {
  pending: unknown[] = [];
  sendFails = false;
  readonly bindings = {
    send: async (body: unknown) => {
      if (this.sendFails) throw new Error('queue indisponível');
      this.pending.push(body);
    },
  };

  /** Duplica a última mensagem (a Queue é at-least-once). */
  duplicateLast() {
    const last = this.pending.at(-1);
    if (last !== undefined) this.pending.push(structuredClone(last));
  }

  async deliver(deps: ConsumerDeps): Promise<FakeMessage[]> {
    const messages = this.pending.splice(0).map((body) => new FakeMessage(body));
    await processBatch(messages, deps);
    return messages;
  }
}

export type ProviderStep = 'ok' | '429' | '500' | 'timeout' | '400' | 'accept_then_lose_response';

export class ProviderError extends Error {
  constructor(readonly status: number | 'timeout') {
    super(`provider_${status}`);
  }
}

/**
 * Provider externo falso (e-mail, pagamento...). `plan` diz o que cada chamada a `send` faz, em ordem;
 * acabando o plano, `ok`. `accept_then_lose_response` registra o efeito E falha: o efeito aconteceu,
 * mas quem chamou não sabe (o caso do "provider aceitou e o consumidor morreu antes de gravar").
 */
export class FakeProvider {
  readonly accepted = new Set<string>();
  sendCalls = 0;
  plan: ProviderStep[] = [];

  async lookup(key: string): Promise<boolean> {
    return this.accepted.has(key);
  }

  async send(key: string): Promise<void> {
    this.sendCalls += 1;
    const step = this.plan.shift() ?? 'ok';
    if (step === '429') throw new ProviderError(429);
    if (step === '500') throw new ProviderError(500);
    if (step === '400') throw new ProviderError(400);
    if (step === 'timeout') throw new ProviderError('timeout');
    this.accepted.add(key);
    if (step === 'accept_then_lose_response') throw new ProviderError('timeout');
  }
}

/**
 * Handler demonstrativo: RELÊ o estado do provider antes de repetir (sem retry cego, que dobraria o
 * efeito) e classifica a falha: 429, 5xx e timeout são transitórios; os demais 4xx, permanentes.
 */
export function demoHandlers(provider: FakeProvider): HandlerRegistry {
  return {
    'system.demo': async ({ idempotencyKey }) => {
      if (await provider.lookup(idempotencyKey)) return;
      try {
        await provider.send(idempotencyKey);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (error.status === 'timeout' || error.status === 429 || error.status >= 500) {
          throw new TransientError(`provider_${error.status}`);
        }
        throw new PermanentError(`provider_${error.status}`);
      }
    },
  };
}

export interface Harness {
  alerts: AlertEvent[];
  deadLetters: unknown[];
  /** Dependências do consumidor da fila de trabalho (lane `general`, que é a do `system.demo`). */
  consumerDeps: (db: Database, handlers: HandlerRegistry) => ConsumerDeps;
}

export function createHarness(): Harness {
  const alerts: AlertEvent[] = [];
  const deadLetters: unknown[] = [];
  return {
    alerts,
    deadLetters,
    consumerDeps: (db, handlers) => ({
      lane: 'general',
      getDb: async () => db,
      sendToDeadLetter: async (body) => {
        deadLetters.push(body);
      },
      handlers,
      owner: `fault-${uuid()}`,
      alert: (event) => alerts.push(event),
      random: () => 1,
    }),
  };
}

/** Grava uma intenção `system.demo` como o domínio faria (na transação) e devolve o envelope dela. */
export async function enqueueDemo(db: Database) {
  const correlationId = `corr-${uuid()}`;
  const { id } = await db.transaction((tx) =>
    enqueueIntent(tx, {
      kind: 'system.demo',
      dedupeKey: `fault:${uuid()}`,
      payload: { subjectId: uuid() },
      correlationId,
    }),
  );
  return {
    id,
    correlationId,
    envelope: buildEnvelope({ kind: 'system.demo', intentId: id, correlationId }),
  };
}

/** A intenção "foi esquecida": disponível há 10 min e ainda `pending` (a mensagem presumivelmente se perdeu). */
export function age(db: Database, id: string) {
  return db.execute(
    sql`update outbox_message set available_at = now() - interval '10 minutes' where id = ${id}`,
  );
}
