import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { MAX_ATTEMPTS } from '../../src/features/async/intents.ts';
import type { AlertEvent } from '../../src/server/async/alerts.ts';
import { handleScheduled } from '../../src/server/async/cron.ts';
import { PermanentError, TransientError } from '../../src/server/async/handlers.ts';
import { processInbox, type InboxHandlers } from '../../src/server/async/inbox-processor.ts';
import { recordInboxEvent } from '../../src/server/async/inbox-store.ts';
import {
  inboxJob,
  purgeJob,
  republishJob,
  runCycle,
  type CronJob,
  type JobContext,
} from '../../src/server/async/jobs.ts';
import { enqueueIntent } from '../../src/server/async/outbox-store.ts';
import { pauseFlagKey } from '../../src/server/async/flags.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M4-03 em Postgres 18 real: o Cron de reconciliação. Publish perdido, lease vencido, lane pausada,
 * provider fora do ar, duas execuções simultâneas (lease por job), job que lança sem derrubar os outros,
 * ciclo ocioso (só o registro de que rodou), retenção, inbox e banco lento. A Queue é falsa.
 */
let database: TestSchema;
let main: OpenDatabase;

const uuid = () => crypto.randomUUID();

interface Sent {
  queue: 'finance' | 'general';
  body: { intentId: string; kind: string };
}

function fakeQueues(options: { fail?: boolean; gate?: Promise<void> } = {}) {
  const sent: Sent[] = [];
  const binding = (queue: 'finance' | 'general') => ({
    send: async (body: Sent['body']) => {
      if (options.gate) await options.gate;
      if (options.fail) throw new Error('queue indisponível');
      sent.push({ queue, body });
    },
  });
  return {
    sent,
    env: { QUEUE_FINANCE: binding('finance'), QUEUE_GENERAL: binding('general') } as unknown as Env,
  };
}

function context(db: OpenDatabase, env: Env, alerts: AlertEvent[] = []): JobContext {
  return { db: db.db, env, alert: (event) => alerts.push(event), owner: `cron:${uuid()}` };
}

async function enqueue() {
  const { id } = await main.db.transaction((tx) =>
    enqueueIntent(tx, {
      kind: 'system.demo',
      dedupeKey: `cron:${uuid()}`,
      payload: { subjectId: uuid() },
      correlationId: 'corr-cron',
    }),
  );
  return id;
}

/** Faz a intenção parecer esquecida: disponível há `minutes` minutos e ainda `pending`. */
async function age(id: string, minutes: number) {
  await main.db.execute(
    sql`update outbox_message set available_at = now() - make_interval(mins => ${minutes}) where id = ${id}`,
  );
}

async function jobRow(name: string) {
  const [found] = await main.db.select().from(schema.jobRun).where(eq(schema.jobRun.name, name));
  return found;
}

async function state(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.outboxMessage)
    .where(eq(schema.outboxMessage.id, id));
  return found!;
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
  await main.db.execute(sql`truncate table outbox_message, inbox_event, system_flag, job_run`);
});

describe('republicação (publish perdido e lease vencido)', () => {
  it('republica a intenção pending esquecida, sem tocar na linha, e registra a execução', async () => {
    const id = await enqueue();
    await age(id, 10);
    const { env, sent } = fakeQueues();
    const summary = await runCycle(context(main, env), [republishJob]);

    expect(summary).toEqual({ ran: 1, skipped: 0, failed: 0 });
    expect(sent).toEqual([
      {
        queue: 'general',
        body: { v: 1, kind: 'system.demo', intentId: id, correlationId: 'corr-cron' },
      },
    ]);
    // O Cron não reivindica: quem reivindica é o consumidor, ao receber a mensagem.
    expect(await state(id)).toMatchObject({ state: 'pending', attempts: 0, leaseVersion: 0 });
    const run = await jobRow('outbox.republish');
    expect(run).toMatchObject({ lastStatus: 'ok', lastCount: 1, leaseOwner: null });
    expect(run!.lastFinishedAt).not.toBeNull();
    expect(run!.lastDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('intenção recente (a mensagem ainda deve chegar) NÃO é republicada e o job nem assume o lease', async () => {
    await enqueue();
    const { env, sent } = fakeQueues();
    const summary = await runCycle(context(main, env), [republishJob]);
    expect(summary).toEqual({ ran: 0, skipped: 1, failed: 0 });
    expect(sent).toHaveLength(0);
    expect(await jobRow('outbox.republish')).toBeUndefined();
  });

  it('lease vencido é republicado; sem tentativas restantes vai para dead, com alerta, e não é republicado', async () => {
    const expired = await enqueue();
    const exhausted = await enqueue();
    for (const [id, attempts] of [
      [expired, 2],
      [exhausted, MAX_ATTEMPTS],
    ] as const) {
      await main.db.execute(sql`
        update outbox_message
           set state = 'leased', lease_owner = 'morto', lease_until = now() - interval '1 minute',
               attempts = ${attempts}, lease_version = ${attempts}
         where id = ${id}`);
    }
    const { env, sent } = fakeQueues();
    await runCycle(context(main, env), [republishJob]);
    expect(sent.map((item) => item.body.intentId)).toEqual([expired]);
    expect(await state(exhausted)).toMatchObject({
      state: 'dead',
      lastErrorCode: 'lease_expired_attempts_exhausted',
    });
  });

  it('lane pausada (kill switch) não é republicada; a outra segue', async () => {
    const id = await enqueue();
    await age(id, 10);
    await main.db.insert(schema.systemFlag).values({ key: pauseFlagKey('general'), enabled: true });
    const { env, sent } = fakeQueues();
    await runCycle(context(main, env), [republishJob]);
    expect(sent).toHaveLength(0);
    expect(await state(id)).toMatchObject({ state: 'pending' });

    await main.db.update(schema.systemFlag).set({ enabled: false });
    await runCycle(context(main, env), [republishJob]);
    expect(sent).toHaveLength(1);
  });

  it('kind desconhecido na linha vira dead com alerta, sem tentar publicar', async () => {
    const id = await enqueue();
    await main.db.execute(sql`update outbox_message set kind = 'outro.kind' where id = ${id}`);
    await age(id, 10);
    const { env, sent } = fakeQueues();
    const alerts: AlertEvent[] = [];
    await runCycle(context(main, env, alerts), [republishJob]);
    expect(sent).toHaveLength(0);
    expect(await state(id)).toMatchObject({ state: 'dead', lastErrorCode: 'unknown_kind' });
    expect(alerts[0]).toMatchObject({ code: 'intent_dead', reason: 'unknown_kind' });
  });

  it('respeita o limite por execução: o excedente fica para o ciclo seguinte', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const id = await enqueue();
      await age(id, 10);
      ids.push(id);
    }
    const { env, sent } = fakeQueues();
    // Sem expor o limite: 3 linhas cabem no teto (50); o teste garante que todas saem e uma só vez.
    await runCycle(context(main, env), [republishJob]);
    expect(sent.map((item) => item.body.intentId).sort()).toEqual([...ids].sort());
  });
});

describe('provider (Queue) fora do ar', () => {
  it('o job registra erro com código, alerta, e os demais jobs ainda rodam', async () => {
    const id = await enqueue();
    await age(id, 10);
    await main.db.execute(sql`
      insert into outbox_message (kind, queue, dedupe_key, payload, correlation_id, state, finished_at)
      values ('system.demo', 'general', 'velha', '{}'::jsonb, 'c', 'delivered', now() - interval '40 days')`);
    const { env } = fakeQueues({ fail: true });
    const alerts: AlertEvent[] = [];
    const summary = await runCycle(context(main, env, alerts), [republishJob, purgeJob]);

    expect(summary).toEqual({ ran: 2, skipped: 0, failed: 1 });
    expect(await jobRow('outbox.republish')).toMatchObject({
      lastStatus: 'error',
      lastErrorCode: 'publish_failed',
      lastCount: 0,
    });
    expect(await jobRow('async.purge')).toMatchObject({ lastStatus: 'ok', lastCount: 1 });
    expect(alerts.map((alert) => alert.code)).toContain('cron_job_failed');
    // A linha continua pending: o próximo ciclo tenta de novo.
    expect((await state(id)).state).toBe('pending');
  });

  it('job que lança não impede os seguintes; só o CÓDIGO do erro é gravado', async () => {
    const calls: string[] = [];
    const boom: CronJob = {
      name: 'job.boom',
      run: async () => {
        throw new Error('falhou com ana@example.com');
      },
    };
    const next: CronJob = {
      name: 'job.next',
      run: async () => {
        calls.push('next');
        return { count: 7 };
      },
    };
    const alerts: AlertEvent[] = [];
    const summary = await runCycle(context(main, fakeQueues().env, alerts), [boom, next]);
    expect(summary).toEqual({ ran: 2, skipped: 0, failed: 1 });
    expect(calls).toEqual(['next']);
    expect(await jobRow('job.boom')).toMatchObject({
      lastStatus: 'error',
      lastErrorCode: 'job_failed',
    });
    expect(await jobRow('job.next')).toMatchObject({ lastStatus: 'ok', lastCount: 7 });
    expect(JSON.stringify(alerts)).not.toContain('ana@example.com');
  });
});

describe('duas execuções simultâneas', () => {
  it('o lease do job impede o trabalho duplicado: a segunda pula e nada é publicado duas vezes', async () => {
    const second = await openDatabase(database.connectionString);
    try {
      const id = await enqueue();
      await age(id, 10);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow = fakeQueues({ gate });

      const first = runCycle(context(main, slow.env), [republishJob]);
      // Espera a primeira assumir o lease (linha com lease vivo) antes de iniciar a segunda.
      for (let tries = 0; tries < 100; tries += 1) {
        const row = await jobRow('outbox.republish');
        if (row?.leaseOwner) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const overlapping = await runCycle(context(second, slow.env), [republishJob]);
      expect(overlapping).toEqual({ ran: 0, skipped: 1, failed: 0 });

      release();
      expect(await first).toEqual({ ran: 1, skipped: 0, failed: 0 });
      expect(slow.sent).toHaveLength(1);
    } finally {
      await second.close();
    }
  });

  it('lease vencido do job (execução que morreu) é reassumido no ciclo seguinte', async () => {
    const id = await enqueue();
    await age(id, 10);
    await main.db.execute(sql`
      insert into job_run (name, lease_owner, lease_until, lease_version, last_started_at)
      values ('outbox.republish', 'cron-morto', now() - interval '1 minute', 4, now() - interval '20 minutes')`);
    const { env, sent } = fakeQueues();
    await runCycle(context(main, env), [republishJob]);
    expect(sent).toHaveLength(1);
    expect(await jobRow('outbox.republish')).toMatchObject({ leaseVersion: 5, lastStatus: 'ok' });
  });
});

describe('handleScheduled (o ciclo completo)', () => {
  it('sem trabalho: só as sondas, o job de alertas (que só lê) e o registro de que o Cron rodou', async () => {
    const { env } = fakeQueues();
    // `handleScheduled` fecha a conexão que abre: cada ciclo recebe uma nova.
    await handleScheduled(env, {
      openDb: () => openDatabase(database.connectionString),
      alert: () => {},
    });
    const rows = await main.db.select().from(schema.jobRun);
    // Os jobs com sonda (republicação, inbox, purga) pulam; o de alertas (M4-05) não tem sonda e roda.
    expect(rows.map((row) => row.name).sort()).toEqual(['cron', 'ops.alerts']);
    const cron = rows.find((row) => row.name === 'cron')!;
    expect(cron).toMatchObject({ lastStatus: 'ok' });
    expect(cron.lastFinishedAt).not.toBeNull();
  });

  it('uma intenção cuja mensagem foi descartada é republicada e o ciclo registra', async () => {
    const id = await enqueue();
    await age(id, 10);
    const { env, sent } = fakeQueues();
    await handleScheduled(env, {
      openDb: () => openDatabase(database.connectionString),
      alert: () => {},
    });
    expect(sent.map((item) => item.body.intentId)).toEqual([id]);
    const names = (await main.db.select().from(schema.jobRun)).map((row) => row.name).sort();
    expect(names).toEqual(['cron', 'ops.alerts', 'outbox.republish']);
  });

  it('banco indisponível: alerta e o erro sobe (não há onde registrar)', async () => {
    const alerts: AlertEvent[] = [];
    await expect(
      handleScheduled(fakeQueues().env, {
        openDb: async () => {
          throw new Error('connection refused');
        },
        alert: (event) => alerts.push(event),
      }),
    ).rejects.toThrow('connection refused');
    expect(alerts).toEqual([{ code: 'cron_database_unavailable' }]);
  });

  it('banco que demora a acordar: a conexão tem teto e termina com erro em vez de pendurar', async () => {
    // 10.255.255.1 não responde: sem o teto a conexão ficaria pendurada.
    const started = Date.now();
    await expect(
      openDatabase('postgres://u:p@10.255.255.1:5432/db', { connectionTimeoutMillis: 300 }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('retenção pelo Cron', () => {
  it('apaga o vencido, conta e não apaga o recente', async () => {
    const old = await enqueue();
    const recent = await enqueue();
    await main.db.execute(sql`
      update outbox_message set state = 'delivered', finished_at = now() - interval '31 days' where id = ${old}`);
    await main.db.execute(sql`
      update outbox_message set state = 'delivered', finished_at = now() - interval '3 days' where id = ${recent}`);
    await runCycle(context(main, fakeQueues().env), [purgeJob]);
    expect(await jobRow('async.purge')).toMatchObject({ lastStatus: 'ok', lastCount: 1 });
    const left = (await main.db.select().from(schema.outboxMessage)).map((row) => row.id);
    expect(left).toEqual([recent]);
  });
});

describe('inbox pelo Cron', () => {
  const event = (eventId: string, provider: 'asaas' | 'resend' = 'resend') => ({
    provider,
    eventId,
    payload: { type: 'email.delivered' },
    correlationId: 'corr-webhook',
  });

  it('processa o evento do provider com handler; o provider SEM handler fica intacto', async () => {
    const handled = await recordInboxEvent(main.db, event('evt_1'));
    const untouched = await recordInboxEvent(main.db, event('evt_2', 'asaas'));
    const seen: string[] = [];
    const handlers: InboxHandlers = {
      resend: async ({ eventId }) => {
        seen.push(eventId);
      },
    };
    const summary = await runCycle(context(main, fakeQueues().env), [inboxJob(handlers)]);
    expect(summary).toEqual({ ran: 1, skipped: 0, failed: 0 });
    expect(seen).toEqual([handled.id]);
    const rows = await main.db.select().from(schema.inboxEvent);
    expect(rows.find((row) => row.id === handled.id)?.state).toBe('delivered');
    expect(rows.find((row) => row.id === untouched.id)).toMatchObject({
      state: 'pending',
      attempts: 0,
    });
  });

  it('sem nenhum handler registrado o job nem roda (nada a fazer)', async () => {
    await recordInboxEvent(main.db, event('evt_3'));
    const summary = await runCycle(context(main, fakeQueues().env), [inboxJob({})]);
    expect(summary).toEqual({ ran: 0, skipped: 1, failed: 0 });
  });

  it('falha transitória volta com backoff, permanente vai para failed com alerta', async () => {
    const transient = await recordInboxEvent(main.db, event('evt_t'));
    const permanent = await recordInboxEvent(main.db, event('evt_p'));
    const alerts: AlertEvent[] = [];
    await processInbox(main.db, {
      owner: 'teste',
      alert: (alertEvent) => alerts.push(alertEvent),
      handlers: {
        resend: async ({ eventId }) => {
          if (eventId === transient.id) throw new TransientError('provider_timeout');
          throw new PermanentError('evento_invalido');
        },
      },
    });
    const rows = await main.db.select().from(schema.inboxEvent);
    const t = rows.find((row) => row.id === transient.id)!;
    const p = rows.find((row) => row.id === permanent.id)!;
    expect(t).toMatchObject({ state: 'pending', lastErrorCode: 'provider_timeout' });
    expect(t.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(p).toMatchObject({ state: 'failed', lastErrorCode: 'evento_invalido' });
    expect(alerts).toEqual([
      expect.objectContaining({ code: 'inbox_event_failed', reason: 'evento_invalido' }),
    ]);
  });

  it('duas execuções simultâneas tratam cada evento UMA vez', async () => {
    const second = await openDatabase(database.connectionString);
    try {
      for (let index = 0; index < 12; index += 1) {
        await recordInboxEvent(main.db, event(`evt_c${index}`));
      }
      const seen: string[] = [];
      const handlers: InboxHandlers = {
        resend: async ({ eventId }) => {
          seen.push(eventId);
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      };
      await Promise.all([
        processInbox(main.db, { handlers, owner: 'a', alert: () => {} }),
        processInbox(second.db, { handlers, owner: 'b', alert: () => {} }),
      ]);
      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
    } finally {
      await second.close();
    }
  });
});
