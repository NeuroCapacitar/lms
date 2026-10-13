import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { MAX_ATTEMPTS } from '../../src/features/async/intents.ts';
import { handleScheduled } from '../../src/server/async/cron.ts';
import { processDeadLetters } from '../../src/server/async/consumer.ts';
import { pauseFlagKey } from '../../src/server/async/flags.ts';
import { TransientError, type HandlerRegistry } from '../../src/server/async/handlers.ts';
import { queueEmail } from '../../src/server/email/email-store.ts';
import { createQuotaGate } from '../../src/server/email/quota-store.ts';
import { createEmailHandler } from '../../src/server/email/send-handler.ts';
import type { MailRequest, MailResult, Mailer } from '../../src/server/email/mailer.ts';
import { resendEventHandler } from '../../src/server/email/resend-events.ts';
import { resendWebhookRoutes } from '../../src/server/webhooks/resend-routes.ts';
import { Hono } from 'hono';
import { TEST_WEBHOOK_SECRET, signedHeaders } from '../helpers/svix.ts';
import { processInbox } from '../../src/server/async/inbox-processor.ts';
import { recordInboxEvent } from '../../src/server/async/inbox-store.ts';
import { republishJob, runCycle, type JobContext } from '../../src/server/async/jobs.ts';
import {
  claimOutbox,
  claimOutboxById,
  completeOutbox,
  enqueueIntent,
} from '../../src/server/async/outbox-store.ts';
import { publishAfterCommit } from '../../src/server/async/publisher.ts';
import {
  FakeMessage,
  FakeProvider,
  SimQueue,
  age,
  createHarness,
  demoHandlers,
  enqueueDemo,
  uuid,
} from '../helpers/async-harness.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M4-06 — a FAULT MATRIX executável: uma linha da matriz do contrato = um teste nomeado (F01…F11, mais
 * F12 do contrato). Cada teste exercita o código REAL (outbox, consumidor, Cron, DLQ) contra o Postgres 18
 * real; só o provider externo e a Queue são simulados, com falha injetada por ponto. NÃO afirma
 * exactly-once: o provider falso conta quantas vezes o EFEITO aconteceu, e o desenho garante
 * at-least-once com efeito idempotente (o handler relê o provider antes de repetir). As linhas das
 * próximas categorias (M5, M6, M7) entram AQUI, não em outra matriz.
 */
let database: TestSchema;
let main: OpenDatabase;

beforeAll(async () => {
  database = await createTestSchema();
  main = await openDatabase(database.connectionString);
});
afterAll(async () => {
  await main.close();
  await database.drop();
});
beforeEach(async () => {
  await main.db.execute(
    sql`truncate table email_send_ledger, email_message, outbox_message, inbox_event, system_flag, job_run`,
  );
});

async function row(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.outboxMessage)
    .where(eq(schema.outboxMessage.id, id));
  return found!;
}

function cronContext(queue: SimQueue, alerts: unknown[] = []): JobContext {
  return {
    db: main.db,
    env: { QUEUE_FINANCE: queue.bindings, QUEUE_GENERAL: queue.bindings } as unknown as Env,
    alert: (event) => alerts.push(event),
    owner: `cron:${uuid()}`,
  };
}

describe('Fault matrix (M4-06)', () => {
  it('F01 publish perdido: a intenção está durável no banco e o Cron a republica até o efeito acontecer', async () => {
    const queue = new SimQueue();
    queue.sendFails = true; // o publish pós-commit FALHA
    const provider = new FakeProvider();
    const h = createHarness();
    const { id, correlationId } = await enqueueDemo(main.db);

    // O publish falha mas NÃO derruba quem chamou (nenhuma exceção) e vira alerta.
    const pending: Promise<unknown>[] = [];
    publishAfterCommit(
      { QUEUE_FINANCE: queue.bindings, QUEUE_GENERAL: queue.bindings } as unknown as Env,
      { waitUntil: (promise) => void pending.push(promise) },
      [{ id, kind: 'system.demo', correlationId }],
      (event) => h.alerts.push(event),
    );
    await Promise.all(pending);
    expect(h.alerts[0]).toMatchObject({ code: 'publish_failed', intentId: id });
    expect(queue.pending).toHaveLength(0);
    expect((await row(id)).state).toBe('pending'); // nada se perdeu: o banco é a verdade

    // Sem nenhum evento novo, só o Cron: republica e o consumidor entrega o efeito.
    queue.sendFails = false;
    await age(main.db, id);
    await runCycle(cronContext(queue), [republishJob]);
    await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));

    expect(provider.accepted.size).toBe(1);
    expect((await row(id)).state).toBe('delivered');
  });

  it('F02 Queue entrega duplicada: o efeito acontece uma vez só, em sequência e em duas conexões', async () => {
    const second = await openDatabase(database.connectionString);
    try {
      const provider = new FakeProvider();
      const h = createHarness();
      const sequential = await enqueueDemo(main.db);
      const queue = new SimQueue();
      await queue.bindings.send(sequential.envelope);
      queue.duplicateLast();
      const delivered = await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));
      expect(delivered.every((message) => message.acked)).toBe(true);
      expect(provider.sendCalls).toBe(1);

      // Simultâneas: o handler segura o provider enquanto a duplicata chega por OUTRA conexão.
      const concurrent = await enqueueDemo(main.db);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow: HandlerRegistry = {
        'email.send': async () => {},
        'interest.fanout': async () => {},
        'system.demo': async (context) => {
          await gate;
          return demoHandlers(provider)['system.demo'](context);
        },
      };
      const first = new SimQueue();
      await first.bindings.send(concurrent.envelope);
      const running = first.deliver(h.consumerDeps(main.db, slow));
      for (let tries = 0; tries < 100; tries += 1) {
        if ((await row(concurrent.id)).state === 'leased') break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const duplicate = new SimQueue();
      await duplicate.bindings.send(concurrent.envelope);
      await duplicate.deliver(h.consumerDeps(second.db, slow));
      release();
      await running;
      expect(provider.sendCalls).toBe(2); // uma por intenção, nenhuma duplicada
      expect((await row(concurrent.id)).state).toBe('delivered');
    } finally {
      await second.close();
    }
  });

  it('F03 payload de versão anterior: o envelope antigo vai à DLQ, o payload antigo da linha vira failed, e o handler nunca roda', async () => {
    const provider = new FakeProvider();
    const h = createHarness();
    const oldEnvelope = await enqueueDemo(main.db);
    const oldPayload = await enqueueDemo(main.db);
    await main.db.execute(
      sql`update outbox_message set payload = '{"subject":"formato-antigo"}'::jsonb where id = ${oldPayload.id}`,
    );

    const queue = new SimQueue();
    await queue.bindings.send({ ...oldEnvelope.envelope, v: 0 });
    await queue.bindings.send(oldPayload.envelope);
    const messages = await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));

    expect(messages.every((message) => message.acked)).toBe(true);
    expect(provider.sendCalls).toBe(0);
    expect(h.deadLetters).toEqual([{ ...oldEnvelope.envelope, v: 0 }]);
    expect(h.alerts.map((alert) => alert.code)).toContain('message_dead_lettered');
    expect(await row(oldPayload.id)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'payload_invalid',
    });
  });

  it('F04 claim concorrente: três conexões reivindicando ao mesmo tempo nunca pegam a mesma linha', async () => {
    const [b, c] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    try {
      for (let index = 0; index < 30; index += 1) await enqueueDemo(main.db);
      const claims = await Promise.all([
        claimOutbox(main.db, 20, 'a'),
        claimOutbox(b.db, 20, 'b'),
        claimOutbox(c.db, 20, 'c'),
      ]);
      const ids = claims.flat().map((claimed) => claimed.id);
      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
    } finally {
      await b.close();
      await c.close();
    }
  });

  it('F05 consumidor morre entre "provider aceitou" e "gravei no banco": o handler relê o provider e NÃO repete o efeito', async () => {
    const provider = new FakeProvider();
    const h = createHarness();
    const { id } = await enqueueDemo(main.db);

    // O consumidor que vai morrer: reivindica, o provider ACEITA, e o processo morre antes de concluir.
    const dying = await claimOutboxById(main.db, id, 'consumidor-que-morreu');
    await provider.send(dying!.dedupeKey!);
    expect(provider.accepted.size).toBe(1);
    expect((await row(id)).state).toBe('leased');
    await main.db.execute(
      sql`update outbox_message set lease_until = now() - interval '1 second' where id = ${id}`,
    );

    // O Cron vê o lease vencido e republica; o novo consumidor relê o provider em vez de enviar de novo.
    const queue = new SimQueue();
    await runCycle(cronContext(queue), [republishJob]);
    await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));

    expect(provider.sendCalls).toBe(1);
    expect(provider.accepted.size).toBe(1);
    expect(await row(id)).toMatchObject({ state: 'delivered', attempts: 2 });
  });

  it('F06 lease perdido: o worker lento não conclui, o que assumiu conclui, e o efeito não dobra', async () => {
    const provider = new FakeProvider();
    const h = createHarness();
    const { id, envelope } = await enqueueDemo(main.db);

    const slowWorker = await claimOutboxById(main.db, id, 'lento', 0.05);
    await provider.send(slowWorker!.dedupeKey!); // o lento chegou a causar o efeito
    await new Promise((resolve) => setTimeout(resolve, 150)); // o lease dele vence

    const queue = new SimQueue();
    await queue.bindings.send(envelope);
    await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider))); // outro worker assume
    expect(await completeOutbox(main.db, id, slowWorker!.leaseVersion)).toBe(false);

    expect(provider.sendCalls).toBe(1);
    expect(await row(id)).toMatchObject({ state: 'delivered', leaseVersion: 2 });
  });

  it('F07 mensagem vai à DLQ: a intenção vira dead no Postgres, com motivo, visível e com alerta', async () => {
    const h = createHarness();
    const { id, envelope } = await enqueueDemo(main.db);
    const unreadable = new FakeMessage('lixo');
    const exhausted = new FakeMessage(envelope); // a Queue esgotou os retries desta mensagem
    await processDeadLetters([exhausted, unreadable], {
      getDb: async () => main.db,
      alert: (event) => h.alerts.push(event),
    });
    expect(exhausted.acked && unreadable.acked).toBe(true);
    const saved = await row(id);
    expect(saved).toMatchObject({ state: 'dead', lastErrorCode: 'dlq_exhausted' });
    expect(saved.finishedAt).not.toBeNull();
    expect(h.alerts.map((alert) => alert.code)).toEqual([
      'dead_letter_received',
      'dead_letter_unreadable',
    ]);
  });

  it('F08 backlog sem jobs novos: só o Cron, ciclo a ciclo, esvazia o backlog (limite por execução respeitado)', async () => {
    const provider = new FakeProvider();
    const h = createHarness();
    // 55 = o limite por execução do Cron (50) + 5: cruza o limite sem demorar no Neon remoto de teste.
    const total = 55;
    const ids: string[] = [];
    await main.db.transaction(async (tx) => {
      for (let index = 0; index < total; index += 1) {
        const { id } = await enqueueIntent(tx, {
          kind: 'system.demo',
          dedupeKey: `backlog:${uuid()}`,
          payload: { subjectId: uuid() },
          correlationId: 'corr-backlog',
        });
        ids.push(id);
      }
    });
    await main.db.execute(
      sql`update outbox_message set available_at = now() - interval '10 minutes'`,
    );

    const queue = new SimQueue();
    const published: number[] = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await runCycle(cronContext(queue), [republishJob]);
      published.push(queue.pending.length);
      await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));
      // Nenhuma intenção nova entrou e nenhum evento disparou nada: só o Cron avança o backlog.
    }
    expect(published).toEqual([50, 5, 0]); // o limite por execução, o resto, e nada sobrando
    expect(provider.accepted.size).toBe(total);
    const states = await main.db
      .select({ state: schema.outboxMessage.state })
      .from(schema.outboxMessage);
    expect(states.every((item) => item.state === 'delivered')).toBe(true);
  }, 120_000);

  it('F09 provider 429/5xx/timeout: volta com backoff sem perder, e o efeito acontece UMA vez quando o provider volta; 4xx é permanente', async () => {
    const provider = new FakeProvider();
    provider.plan = ['429', '500', 'timeout', 'accept_then_lose_response'];
    const h = createHarness();
    const { id, envelope } = await enqueueDemo(main.db);

    const retried: (number | undefined)[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const queue = new SimQueue();
      await queue.bindings.send(envelope);
      const [message] = await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));
      if (message!.retried) retried.push(message!.retried.delaySeconds);
      await age(main.db, id); // pula o backoff (o teste não espera minutos)
      if ((await row(id)).state === 'delivered') break;
    }
    // Quatro falhas (429, 5xx, timeout, resposta perdida APÓS o provider aceitar) e a quinta tentativa
    // só RELÊ o provider (o efeito já existia): uma única aceitação, nenhum retry cego.
    expect(retried).toHaveLength(4);
    expect(retried.every((delay) => delay !== undefined && delay >= 15)).toBe(true);
    expect(provider.accepted.size).toBe(1);
    expect(provider.sendCalls).toBe(4);
    expect((await row(id)).state).toBe('delivered');

    const rejected = await enqueueDemo(main.db);
    provider.plan = ['400'];
    const queue = new SimQueue();
    await queue.bindings.send(rejected.envelope);
    await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));
    expect(await row(rejected.id)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'provider_400',
    });
  });

  it('F10 poison event: o evento que sempre falha termina dead e visível, e não trava os outros', async () => {
    const poison = await recordInboxEvent(main.db, {
      provider: 'resend',
      eventId: 'evt_veneno',
      payload: { type: 'x' },
      correlationId: 'c',
    });
    const healthy = await recordInboxEvent(main.db, {
      provider: 'resend',
      eventId: 'evt_bom',
      payload: { type: 'y' },
      correlationId: 'c',
    });
    const alerts: unknown[] = [];
    const handled: string[] = [];
    const handlers = {
      resend: async ({ eventId }: { eventId: string }) => {
        if (eventId === poison.id) throw new TransientError('sempre_falha');
        handled.push(eventId);
      },
    };
    for (let round = 1; round <= MAX_ATTEMPTS; round += 1) {
      await main.db.execute(
        sql`update inbox_event set available_at = now() where state = 'pending'`,
      );
      await processInbox(main.db, { handlers, owner: `r${round}`, alert: (e) => alerts.push(e) });
    }
    const rows = await main.db.select().from(schema.inboxEvent);
    expect(rows.find((item) => item.id === poison.id)).toMatchObject({
      state: 'dead',
      attempts: MAX_ATTEMPTS,
      lastErrorCode: 'sempre_falha',
    });
    expect(rows.find((item) => item.id === healthy.id)?.state).toBe('delivered');
    expect(handled).toEqual([healthy.id]);
    expect(alerts).toEqual([expect.objectContaining({ code: 'inbox_event_dead' })]);
  });

  it('F11 kill switch: pausada, nada executa nem se perde e o Cron não republica; ao retomar, o efeito acontece uma vez', async () => {
    const provider = new FakeProvider();
    const h = createHarness();
    const { id, envelope } = await enqueueDemo(main.db);
    await age(main.db, id);
    await main.db.insert(schema.systemFlag).values({ key: pauseFlagKey('general'), enabled: true });

    const queue = new SimQueue();
    await queue.bindings.send(envelope); // mensagem que já estava na Queue
    const [message] = await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));
    await runCycle(cronContext(queue), [republishJob]);
    expect(message!.acked).toBe(true);
    expect(queue.pending).toHaveLength(0);
    expect(provider.sendCalls).toBe(0);
    expect(await row(id)).toMatchObject({ state: 'pending', attempts: 0 });

    await main.db.update(schema.systemFlag).set({ enabled: false });
    await runCycle(cronContext(queue), [republishJob]);
    await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));
    expect(provider.sendCalls).toBe(1);
    expect((await row(id)).state).toBe('delivered');
  });

  it('F12 Neon dormindo/lento (contrato): o ciclo com banco que não responde termina com erro e alerta, e o ciclo seguinte recupera', async () => {
    const provider = new FakeProvider();
    const h = createHarness();
    const { id, envelope } = await enqueueDemo(main.db);
    await age(main.db, id);
    const queue = new SimQueue();
    const env = {
      QUEUE_FINANCE: queue.bindings,
      QUEUE_GENERAL: queue.bindings,
    } as unknown as Env;

    const alerts: unknown[] = [];
    await expect(
      handleScheduled(env, {
        openDb: () =>
          openDatabase('postgres://u:p@10.255.255.1:5432/db', { connectionTimeoutMillis: 300 }),
        alert: (event) => alerts.push(event),
      }),
    ).rejects.toThrow();
    expect(alerts).toEqual([{ code: 'cron_database_unavailable' }]);
    expect(queue.pending).toHaveLength(0);
    expect((await row(id)).state).toBe('pending'); // nada se perdeu

    await handleScheduled(env, {
      openDb: () => openDatabase(database.connectionString),
      alert: () => {},
    });
    expect(queue.pending).toEqual([envelope]);
    await queue.deliver(h.consumerDeps(main.db, demoHandlers(provider)));
    expect((await row(id)).state).toBe('delivered');
  });

  it('F13 e-mail (M4-04): o Resend aceitou e o consumidor morreu antes de gravar; a repetição usa a MESMA chave e o e-mail sai UMA vez', async () => {
    // Resend falso com idempotência de verdade: a mesma chave devolve o mesmo envio.
    const accepted = new Map<string, number>();
    const mailer: Mailer = {
      async send(request: MailRequest): Promise<MailResult> {
        accepted.set(request.idempotencyKey, (accepted.get(request.idempotencyKey) ?? 0) + 1);
        return { ok: true, providerMessageId: `re_${request.idempotencyKey}` };
      },
    };
    const emailDeps = {
      getMailer: () => mailer,
      quota: createQuotaGate(),
      from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
      appUrl: 'https://hub.example',
      allowlist: [],
    };
    const userId = uuid();
    await main.db.insert(schema.user).values({ id: userId, name: 'Ana', email: 'ana@example.com' });
    const { emailMessageId } = await main.db.transaction((tx) =>
      queueEmail(tx, {
        template: 'access-granted',
        recipientUserId: userId,
        variables: { COURSE_TITLE: 'Curso', EXPIRES_AT: '12/01/2027' },
        dedupeKey: `f13:${uuid()}`,
        correlationId: 'corr-f13',
      }),
    );
    const [intent] = await main.db
      .select()
      .from(schema.outboxMessage)
      .where(sql`payload->>'emailMessageId' = ${emailMessageId}`);

    // O consumidor que vai morrer: reivindica, marca `sending`, o Resend ACEITA e o processo morre.
    const dying = await claimOutboxById(main.db, intent!.id, 'consumidor-que-morreu');
    await main.db.execute(
      sql`update email_message set state = 'sending', first_attempt_at = now() where id = ${emailMessageId}`,
    );
    await mailer.send({
      to: 'ana@example.com',
      templateAlias: 'access-granted',
      variables: {},
      idempotencyKey: dying!.dedupeKey!,
      from: 'x',
    });
    await main.db.execute(
      sql`update outbox_message set lease_until = now() - interval '1 second' where id = ${intent!.id}`,
    );

    // O Cron republica, o novo consumidor repete a chamada com a MESMA chave e conclui.
    const queue = new SimQueue();
    await runCycle(cronContext(queue), [republishJob]);
    const h = createHarness();
    await queue.deliver(
      h.consumerDeps(main.db, {
        'system.demo': async () => {},
        'interest.fanout': async () => {},
        'email.send': createEmailHandler(emailDeps),
      }),
    );

    expect([...accepted.keys()]).toEqual([dying!.dedupeKey]); // uma única chave no provider
    expect(accepted.get(dying!.dedupeKey!)).toBe(2); // 2 chamadas, MESMA chave: o provider deduplica
    const [saved] = await main.db
      .select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.id, emailMessageId));
    expect(saved).toMatchObject({ state: 'accepted' });
    expect((await row(intent!.id)).state).toBe('delivered');
  });

  it('F14 webhook do Resend (M4-07): evento duplicado e fora de ordem não duplicam nem desfazem o estado', async () => {
    const [created] = await main.db
      .insert(schema.emailMessage)
      .values({
        dedupeKey: `f14:${uuid()}`,
        template: 'access-granted',
        recipientKind: 'user',
        variables: { COURSE_TITLE: 'C', EXPIRES_AT: 'x' },
        state: 'accepted',
        providerMessageId: 'f14-email',
      })
      .returning();
    const app = new Hono<{ Bindings: Env }>().route('/api/webhooks', resendWebhookRoutes());
    const env = {
      RESEND_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      EMAIL_HASH_KEY: 'chave-de-hmac-so-de-teste-0123456789abcdef',
      HYPERDRIVE: { connectionString: database.connectionString },
    } as unknown as Env;
    const send = async (type: string, id: string) => {
      const body = JSON.stringify({
        type,
        data: { email_id: 'f14-email', bounce: { type: 'Transient' } },
      });
      return app.request(
        '/api/webhooks/resend',
        { method: 'POST', body, headers: await signedHeaders(body, { id }) },
        env,
      );
    };
    // O bounced chega ANTES do delivered, e o bounced é reenviado pelo Resend (mesmo svix-id).
    expect((await send('email.bounced', 'msg_f14_a')).status).toBe(200);
    expect((await send('email.bounced', 'msg_f14_a')).status).toBe(200);
    expect((await send('email.delivered', 'msg_f14_b')).status).toBe(200);
    expect(await main.db.select().from(schema.inboxEvent)).toHaveLength(2);

    await processInbox(main.db, {
      handlers: { resend: resendEventHandler },
      owner: 'f14',
      alert: () => {},
    });
    const [saved] = await main.db
      .select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.id, created!.id));
    expect(saved!.state).toBe('bounced'); // delivered depois de bounced não desfaz
  });

  it('F15 cota do Resend (M4-08): o excedente é adiado (nunca failed nem perdido) e o Cron o entrega na janela seguinte', async () => {
    const accepted: string[] = [];
    const mailer: Mailer = {
      async send(request: MailRequest): Promise<MailResult> {
        accepted.push(request.idempotencyKey);
        return { ok: true, providerMessageId: `re_${accepted.length}` };
      },
    };
    const policy = { dailyLimit: 3, monthlyLimit: 30, loginReserve: 0 };
    const userId = uuid();
    await main.db
      .insert(schema.user)
      .values({ id: userId, name: 'Ana', email: `f15-${uuid()}@example.com` });
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const { emailMessageId } = await main.db.transaction((tx) =>
        queueEmail(tx, {
          template: 'course-available',
          recipientUserId: userId,
          variables: { COURSE_TITLE: 'Curso' },
          dedupeKey: `f15:${uuid()}`,
          correlationId: 'corr-f15',
        }),
      );
      ids.push(emailMessageId);
    }
    const h = createHarness();
    const handlers = () => ({
      'system.demo': async () => {},
      'interest.fanout': async () => {},
      'email.send': createEmailHandler({
        getMailer: () => mailer,
        quota: createQuotaGate(policy),
        from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
        appUrl: 'https://hub.example',
        allowlist: [],
      }),
    });
    const intents = await main.db.select().from(schema.outboxMessage);
    const queue = new SimQueue();
    for (const intent of intents) {
      await queue.bindings.send({
        v: 1,
        kind: 'email.send',
        intentId: intent.id,
        correlationId: intent.correlationId,
      });
    }
    const first = await queue.deliver(h.consumerDeps(main.db, handlers()));
    expect(first.every((message) => message.acked)).toBe(true);
    expect(accepted).toHaveLength(3); // o teto do dia
    const states = await main.db
      .select({ state: schema.emailMessage.state })
      .from(schema.emailMessage);
    expect(states.filter((item) => item.state === 'accepted')).toHaveLength(3);
    expect(states.filter((item) => item.state === 'queued')).toHaveLength(2); // adiados, não failed
    expect(h.alerts).toEqual([]); // adiar não é alarme

    // Virou o dia: o livro-razão de ontem não conta mais e o atraso das duas linhas venceu.
    await main.db.execute(sql`update email_send_ledger set day = day - 1`);
    await main.db.execute(
      sql`update outbox_message set available_at = now() - interval '10 minutes' where state = 'pending'`,
    );
    await runCycle(cronContext(queue), [republishJob]);
    expect(queue.pending).toHaveLength(2); // o Cron republica só o que ficou para trás
    await queue.deliver(h.consumerDeps(main.db, handlers()));
    expect(accepted).toHaveLength(5);
    expect(new Set(accepted).size).toBe(5); // cada e-mail uma vez, com a sua chave
    const final = await main.db
      .select({ state: schema.emailMessage.state })
      .from(schema.emailMessage);
    expect(final.every((item) => item.state === 'accepted')).toBe(true);
    void ids;
  });
});
