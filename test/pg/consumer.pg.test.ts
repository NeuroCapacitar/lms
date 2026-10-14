import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { buildEnvelope } from '../../src/features/async/envelope.ts';
import { MAX_ATTEMPTS } from '../../src/features/async/intents.ts';
import type { AlertEvent } from '../../src/server/async/alerts.ts';
import {
  processBatch,
  processDeadLetters,
  type ConsumerDeps,
  type QueueMessageLike,
} from '../../src/server/async/consumer.ts';
import { pauseFlagKey } from '../../src/server/async/flags.ts';
import {
  PermanentError,
  TransientError,
  type HandlerContext,
  type HandlerRegistry,
} from '../../src/server/async/handlers.ts';
import { claimOutbox, enqueueIntent } from '../../src/server/async/outbox-store.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M4-02 em Postgres 18 real: o consumidor tipado. Mensagem duplicada (e simultânea em duas conexões),
 * versão antiga, kind desconhecido, handler Transient/Permanent/inesperado, DLQ, kill switch e o
 * handler só executa depois de um claim válido. As mensagens são falsas; a Queue real é do Staging.
 */
let database: TestSchema;
let main: OpenDatabase;
let seq = 0;

const uuid = () => crypto.randomUUID();

class FakeMessage implements QueueMessageLike {
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

async function enqueue(options: { availableAt?: Date } = {}) {
  const correlationId = `corr-${(seq += 1)}`;
  const { id } = await main.db.transaction((tx) =>
    enqueueIntent(tx, {
      kind: 'system.demo',
      dedupeKey: `consumer:${uuid()}`,
      payload: { subjectId: uuid() },
      correlationId,
      availableAt: options.availableAt,
    }),
  );
  return {
    id,
    correlationId,
    envelope: buildEnvelope({ kind: 'system.demo', intentId: id, correlationId }),
  };
}

async function row(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.outboxMessage)
    .where(eq(schema.outboxMessage.id, id));
  return found!;
}

interface Harness {
  calls: HandlerContext<'system.demo'>[];
  alerts: AlertEvent[];
  deadLetters: unknown[];
  deps: (overrides?: Partial<ConsumerDeps>) => ConsumerDeps;
}

function harness(
  behavior: (context: HandlerContext<'system.demo'>) => Promise<void> = async () => {},
  db: OpenDatabase = main,
): Harness {
  const calls: HandlerContext<'system.demo'>[] = [];
  const alerts: AlertEvent[] = [];
  const deadLetters: unknown[] = [];
  const handlers: HandlerRegistry = {
    'email.send': async () => {},
    'interest.fanout': async () => {},
    'finance.refund': async () => {},
    'certificate.render': async () => {},
    'system.demo': async (context) => {
      calls.push(context);
      await behavior(context);
    },
  };
  return {
    calls,
    alerts,
    deadLetters,
    deps: (overrides = {}) => ({
      lane: 'general',
      getDb: async () => db.db,
      sendToDeadLetter: async (body) => {
        deadLetters.push(body);
      },
      handlers,
      owner: `teste-${uuid()}`,
      alert: (event) => alerts.push(event),
      random: () => 1,
      ...overrides,
    }),
  };
}

beforeAll(async () => {
  database = await createTestSchema();
  main = await openDatabase(database.connectionString);
});
afterAll(async () => {
  await main.close();
  await database.drop();
});
beforeEach(async () => {
  await main.db.execute(sql`truncate table outbox_message, inbox_event, system_flag`);
});

describe('caminho feliz', () => {
  it('reivindica, executa o handler uma vez com o contexto certo, conclui e confirma', async () => {
    const { id, envelope, correlationId } = await enqueue();
    const h = harness();
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      intentId: id,
      correlationId,
      attempt: 1,
      payload: { subjectId: expect.any(String) },
    });
    expect(h.calls[0]!.idempotencyKey).toMatch(/^consumer:/);
    expect(message.acked).toBe(true);
    expect(message.retried).toBeUndefined();
    const saved = await row(id);
    expect(saved.state).toBe('delivered');
    expect(saved.attempts).toBe(1);
    expect(h.alerts).toHaveLength(0);
  });
});

describe('mensagem duplicada', () => {
  it('a segunda entrega depois da conclusão é confirmada SEM executar de novo', async () => {
    const { envelope } = await enqueue();
    const h = harness();
    await processBatch([new FakeMessage(envelope)], h.deps());
    const again = new FakeMessage(envelope);
    await processBatch([again], h.deps());
    expect(h.calls).toHaveLength(1);
    expect(again.acked).toBe(true);
  });

  it('duas entregas SIMULTÂNEAS (duas conexões) executam o handler uma única vez', async () => {
    const second = await openDatabase(database.connectionString);
    try {
      const { envelope, id } = await enqueue();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const h = harness(() => gate);
      const first = new FakeMessage(envelope);
      const duplicate = new FakeMessage(envelope);

      const running = processBatch([first], h.deps());
      // Espera o primeiro claim aparecer (o handler está segurando o lease) antes da duplicata.
      for (let tries = 0; tries < 100 && h.calls.length === 0; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await processBatch([duplicate], h.deps({ getDb: async () => second.db }));
      release();
      await running;

      expect(h.calls).toHaveLength(1);
      expect(first.acked).toBe(true);
      expect(duplicate.acked).toBe(true);
      expect((await row(id)).state).toBe('delivered');
    } finally {
      await second.close();
    }
  });

  it('mensagem para intenção inexistente é confirmada sem executar nada', async () => {
    const h = harness();
    const message = new FakeMessage(
      buildEnvelope({ kind: 'system.demo', intentId: uuid(), correlationId: 'c' }),
    );
    await processBatch([message], h.deps());
    expect(h.calls).toHaveLength(0);
    expect(message.acked).toBe(true);
  });

  it('mensagem ADIANTADA (linha ainda no atraso do backoff) volta para quando puder rodar', async () => {
    const { envelope } = await enqueue({ availableAt: new Date(Date.now() + 120_000) });
    const h = harness();
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());
    expect(h.calls).toHaveLength(0);
    expect(message.acked).toBe(false);
    expect(message.retried!.delaySeconds).toBeGreaterThan(100);
    expect(message.retried!.delaySeconds).toBeLessThanOrEqual(121);
  });
});

describe('envelope inválido', () => {
  const cases: [string, (id: string) => unknown][] = [
    [
      'versão antiga/desconhecida',
      (id) => ({ v: 2, kind: 'system.demo', intentId: id, correlationId: 'c' }),
    ],
    ['kind desconhecido', (id) => ({ v: 1, kind: 'nao.existe', intentId: id, correlationId: 'c' })],
    ['corpo ilegível', () => 'lixo'],
    [
      'campo extra com dado pessoal',
      (id) => ({ v: 1, kind: 'system.demo', intentId: id, correlationId: 'c', email: 'a@b.co' }),
    ],
  ];

  for (const [name, build] of cases) {
    it(`${name}: vai para a DLQ com alerta, nunca ack silencioso, e o handler não roda`, async () => {
      const { id } = await enqueue();
      const body = build(id);
      const h = harness();
      const message = new FakeMessage(body);
      await processBatch([message], h.deps());
      expect(h.calls).toHaveLength(0);
      expect(h.deadLetters).toEqual([body]);
      expect(message.acked).toBe(true);
      expect(h.alerts.map((alert) => alert.code)).toEqual(['message_dead_lettered']);
      // O alerta nunca carrega o corpo da mensagem.
      expect(JSON.stringify(h.alerts)).not.toContain('a@b.co');
    });
  }

  it('se o envio à DLQ falha, a mensagem é devolvida (nunca confirmada sem destino)', async () => {
    const h = harness();
    const message = new FakeMessage('lixo');
    await processBatch(
      [message],
      h.deps({
        sendToDeadLetter: async () => {
          throw new Error('dlq indisponível');
        },
      }),
    );
    expect(message.acked).toBe(false);
    expect(message.retried).toEqual({ delaySeconds: 30 });
  });

  it('kind de OUTRA lane é desviado para a DLQ (finance não roda no general)', async () => {
    const { envelope } = await enqueue();
    const h = harness();
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps({ lane: 'finance' }));
    expect(h.calls).toHaveLength(0);
    expect(h.deadLetters).toHaveLength(1);
    expect(h.alerts[0]).toMatchObject({ code: 'message_dead_lettered', reason: 'queue_mismatch' });
  });

  it('um lote só de mensagens inválidas não abre o banco', async () => {
    let opened = 0;
    const h = harness();
    await processBatch(
      [new FakeMessage('lixo'), new FakeMessage({ v: 9 })],
      h.deps({
        getDb: async () => {
          opened += 1;
          return main.db;
        },
      }),
    );
    expect(opened).toBe(0);
  });
});

describe('handler com erro tipado', () => {
  it('Transient: a linha volta a pending com atraso, a Queue devolve com o MESMO atraso e nada se perde', async () => {
    const { envelope, id } = await enqueue();
    const h = harness(async () => {
      throw new TransientError('provider_timeout');
    });
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());

    expect(message.acked).toBe(false);
    expect(message.retried!.delaySeconds).toBe(30); // 1ª tentativa, sorteio máximo
    const saved = await row(id);
    expect(saved.state).toBe('pending');
    expect(saved.lastErrorCode).toBe('provider_timeout');
    expect(saved.availableAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it('Permanent: a linha vai para failed, a mensagem é confirmada e há alerta', async () => {
    const { envelope, id } = await enqueue();
    const h = harness(async () => {
      throw new PermanentError('destinatario_invalido');
    });
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());
    expect(message.acked).toBe(true);
    expect((await row(id)).state).toBe('failed');
    expect(h.alerts).toEqual([
      expect.objectContaining({
        code: 'intent_failed',
        intentId: id,
        reason: 'destinatario_invalido',
      }),
    ]);
  });

  it('erro inesperado é tratado como transitório e o texto do erro NÃO vai para o banco nem para o alerta', async () => {
    const { envelope, id } = await enqueue();
    const h = harness(async () => {
      throw new Error('falhou para ana@example.com');
    });
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());
    expect(message.retried).toBeDefined();
    const saved = await row(id);
    expect(saved.state).toBe('pending');
    expect(saved.lastErrorCode).toBe('handler_unexpected');
    expect(JSON.stringify(h.alerts)).not.toContain('ana@example.com');
  });

  it('mensagem venenosa (sempre falha) termina dead e visível depois das tentativas', async () => {
    const { envelope, id } = await enqueue();
    const h = harness(async () => {
      throw new TransientError('sempre_falha');
    });
    let last: FakeMessage | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await main.db.execute(sql`update outbox_message set available_at = now() where id = ${id}`);
      last = new FakeMessage(envelope);
      await processBatch([last], h.deps());
    }
    expect(h.calls).toHaveLength(MAX_ATTEMPTS);
    expect((await row(id)).state).toBe('dead');
    expect(last!.acked).toBe(true);
    expect(h.alerts.at(-1)).toMatchObject({ code: 'intent_dead', intentId: id });
  });

  it('lease perdido durante o handler: o resultado é descartado e a linha fica com quem assumiu', async () => {
    const { envelope, id } = await enqueue();
    const h = harness(async () => {
      // Outro worker assume (lease expirado) enquanto este handler ainda roda.
      await main.db.execute(
        sql`update outbox_message set lease_until = now() - interval '1 second' where id = ${id}`,
      );
      await claimOutbox(main.db, 1, 'worker-que-assumiu');
    });
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());
    expect(message.acked).toBe(true);
    const saved = await row(id);
    expect(saved.state).toBe('leased');
    expect(saved.leaseOwner).toBe('worker-que-assumiu');
  });
});

describe('o handler só executa depois de um claim válido', () => {
  it('payload da linha fora do contrato: nunca chega ao handler (failed)', async () => {
    const { envelope, id } = await enqueue();
    await main.db.execute(
      sql`update outbox_message set payload = '{"subjectId":"ana@example.com"}'::jsonb where id = ${id}`,
    );
    const h = harness();
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());
    expect(h.calls).toHaveLength(0);
    expect((await row(id)).lastErrorCode).toBe('payload_invalid');
    expect((await row(id)).state).toBe('failed');
    expect(message.acked).toBe(true);
  });

  it('o envelope não pode mandar executar outro kind: a linha é a verdade', async () => {
    const { envelope, id } = await enqueue();
    await main.db.execute(sql`update outbox_message set kind = 'outro.kind' where id = ${id}`);
    const h = harness();
    await processBatch([new FakeMessage(envelope)], h.deps());
    expect(h.calls).toHaveLength(0);
    expect((await row(id)).lastErrorCode).toBe('envelope_kind_mismatch');
  });
});

describe('kill switch', () => {
  it('pausada: não reivindica, não executa e não perde (a linha segue pending, sem tentativa)', async () => {
    const { envelope, id } = await enqueue();
    await main.db.insert(schema.systemFlag).values({ key: pauseFlagKey('general'), enabled: true });
    const h = harness();
    const message = new FakeMessage(envelope);
    await processBatch([message], h.deps());
    expect(h.calls).toHaveLength(0);
    expect(message.acked).toBe(true);
    const saved = await row(id);
    expect(saved).toMatchObject({ state: 'pending', attempts: 0, leaseVersion: 0 });
  });

  it('a pausa de uma lane não afeta a outra, e desligar a chave volta a consumir', async () => {
    const { envelope, id } = await enqueue();
    await main.db.insert(schema.systemFlag).values({ key: pauseFlagKey('finance'), enabled: true });
    const h = harness();
    await processBatch([new FakeMessage(envelope)], h.deps());
    expect((await row(id)).state).toBe('delivered');

    const second = await enqueue();
    await main.db
      .update(schema.systemFlag)
      .set({ key: pauseFlagKey('general'), enabled: true })
      .where(eq(schema.systemFlag.key, pauseFlagKey('finance')));
    await processBatch([new FakeMessage(second.envelope)], h.deps());
    expect((await row(second.id)).state).toBe('pending');
    await main.db
      .update(schema.systemFlag)
      .set({ enabled: false })
      .where(eq(schema.systemFlag.key, pauseFlagKey('general')));
    await processBatch([new FakeMessage(second.envelope)], h.deps());
    expect((await row(second.id)).state).toBe('delivered');
  });
});

describe('falha de infraestrutura', () => {
  it('banco indisponível: a mensagem é devolvida com atraso e há alerta', async () => {
    const { envelope } = await enqueue();
    const h = harness();
    const message = new FakeMessage(envelope);
    await processBatch(
      [message],
      h.deps({
        getDb: async () => {
          throw new Error('connection refused');
        },
      }),
    );
    expect(message.acked).toBe(false);
    expect(message.retried).toEqual({ delaySeconds: 30 });
    expect(h.alerts[0]).toMatchObject({ code: 'consumer_infrastructure_error' });
  });

  it('um lote com mensagem ruim no meio processa as outras', async () => {
    const a = await enqueue();
    const b = await enqueue();
    const h = harness();
    const messages = [
      new FakeMessage(a.envelope),
      new FakeMessage('lixo'),
      new FakeMessage(b.envelope),
    ];
    await processBatch(messages, h.deps());
    expect(h.calls).toHaveLength(2);
    expect(messages.map((m) => m.acked)).toEqual([true, true, true]);
  });
});

describe('consumidor da DLQ', () => {
  it('marca a intenção aberta como dead com o motivo e alerta; mensagem ilegível só alerta', async () => {
    const { envelope, id } = await enqueue();
    const alerts: AlertEvent[] = [];
    const good = new FakeMessage(envelope);
    const garbage = new FakeMessage('lixo');
    await processDeadLetters([good, garbage], {
      getDb: async () => main.db,
      alert: (e) => alerts.push(e),
    });
    expect(good.acked && garbage.acked).toBe(true);
    const saved = await row(id);
    expect(saved).toMatchObject({ state: 'dead', lastErrorCode: 'dlq_exhausted' });
    expect(saved.finishedAt).not.toBeNull();
    expect(alerts.map((a) => a.code)).toEqual(['dead_letter_received', 'dead_letter_unreadable']);
  });

  it('versão desconhecida com id legível também marca a intenção; intenção já concluída não é reaberta', async () => {
    const open = await enqueue();
    const done = await enqueue();
    await main.db.execute(
      sql`update outbox_message set state = 'delivered', finished_at = now() where id = ${done.id}`,
    );
    const alerts: AlertEvent[] = [];
    const messages = [
      new FakeMessage({ v: 7, kind: 'system.demo', intentId: open.id, correlationId: 'c' }),
      new FakeMessage(done.envelope),
    ];
    await processDeadLetters(messages, {
      getDb: async () => main.db,
      alert: (e) => alerts.push(e),
    });
    expect((await row(open.id)).state).toBe('dead');
    expect((await row(done.id)).state).toBe('delivered');
    expect(alerts.map((a) => a.reason)).toEqual(['marked_dead', 'already_final']);
  });

  it('banco fora do ar: devolve a mensagem da DLQ (o Postgres continua a verdade)', async () => {
    const { envelope } = await enqueue();
    const message = new FakeMessage(envelope);
    await processDeadLetters([message], {
      getDb: async () => {
        throw new Error('fora do ar');
      },
      alert: () => {},
    });
    expect(message.acked).toBe(false);
    expect(message.retried).toEqual({ delaySeconds: 60 });
  });
});
