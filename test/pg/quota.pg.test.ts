import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { FREE_PLAN_QUOTA, type QuotaPolicy } from '../../src/features/email/quota.ts';
import type { AlertEvent } from '../../src/server/async/alerts.ts';
import { processBatch } from '../../src/server/async/consumer.ts';
import { claimOutbox } from '../../src/server/async/outbox-store.ts';
import { queueEmail } from '../../src/server/email/email-store.ts';
import type { MailRequest, MailResult, Mailer } from '../../src/server/email/mailer.ts';
import {
  createQuotaGate,
  markDayExhausted,
  quotaSummary,
  recordDirectSend,
  releaseQuota,
  reserveQuota,
} from '../../src/server/email/quota-store.ts';
import { createEmailHandler } from '../../src/server/email/send-handler.ts';
import { FakeMessage, uuid } from '../helpers/async-harness.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M4-08 em Postgres 18 real: a cota do Resend Free. Reserva atômica por classe de prioridade (a classe 1
 * tem reserva), teto do dia e do mês, virada do dia em UTC, devolução quando o provider não aceita, 429 de
 * cota e de taxa, excedente ADIADO (nunca failed) e entregue depois, e o sinal de upgrade.
 */
let database: TestSchema;
let main: OpenDatabase;

/** Política pequena para os testes serem rápidos no Neon remoto; a de produção é `FREE_PLAN_QUOTA`. */
const SMALL: QuotaPolicy = { dailyLimit: 10, monthlyLimit: 30, loginReserve: 2 };

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
    sql`truncate table email_send_ledger, email_message, outbox_message, system_flag, job_run`,
  );
  await main.db.delete(schema.user);
});

async function todayCount() {
  const rows = await main.db.execute(
    sql`select coalesce(sum(count), 0)::int as total from email_send_ledger where day = (now() at time zone 'utc')::date`,
  );
  return (rows.rows[0] as { total: number }).total;
}

describe('reserva da cota', () => {
  it('as classes 2 a 5 só enchem o que sobra depois da reserva do login; a classe 1 vai até o limite', async () => {
    const results: boolean[] = [];
    for (let index = 0; index < 8; index += 1) {
      results.push((await reserveQuota(main.db, 4, SMALL)).ok);
    }
    expect(results.every(Boolean)).toBe(true); // 8 = 10 - 2 de reserva
    const refused = await reserveQuota(main.db, 4, SMALL);
    expect(refused).toMatchObject({ ok: false, reason: 'daily' });
    // A classe 1 (link de acesso) ainda passa nas 2 vagas reservadas, e depois também é recusada.
    expect((await reserveQuota(main.db, 1, SMALL)).ok).toBe(true);
    expect((await reserveQuota(main.db, 1, SMALL)).ok).toBe(true);
    expect(await reserveQuota(main.db, 1, SMALL)).toMatchObject({ ok: false, reason: 'daily' });
    expect(await todayCount()).toBe(10);
  });

  it('reservas simultâneas em três conexões nunca passam do teto do dia', async () => {
    const [b, c] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    try {
      const attempt = async (connection: OpenDatabase) => {
        const outcomes: boolean[] = [];
        for (let index = 0; index < 5; index += 1) {
          outcomes.push((await reserveQuota(connection.db, 3, SMALL)).ok);
        }
        return outcomes;
      };
      const all = (await Promise.all([attempt(main), attempt(b), attempt(c)])).flat();
      expect(all.filter(Boolean)).toHaveLength(8); // exatamente o teto das classes 2 a 5
      expect(await todayCount()).toBe(8);
    } finally {
      await b.close();
      await c.close();
    }
  });

  it('o teto do MÊS vale mesmo com o dia livre; a classe 1 ainda tem a reserva do mês', async () => {
    // 24 já usados no mês (= 30 menos a reserva proporcional de 6): classes 2 a 5 recusadas.
    await main.db.execute(
      sql`insert into email_send_ledger (day, count) values (date_trunc('month', now() at time zone 'utc')::date - 1, 0), (date_trunc('month', now() at time zone 'utc')::date, 0)`,
    );
    await main.db.execute(
      sql`update email_send_ledger set count = 24 where day = date_trunc('month', now() at time zone 'utc')::date`,
    );
    const refused = await reserveQuota(main.db, 4, SMALL);
    expect(refused).toMatchObject({ ok: false, reason: 'monthly' });
    expect((await reserveQuota(main.db, 1, SMALL)).ok).toBe(true);
  });

  it('virou o dia em UTC: o dia anterior cheio não bloqueia o de hoje', async () => {
    await main.db.execute(
      sql`insert into email_send_ledger (day, count) values ((now() at time zone 'utc')::date - 1, 10)`,
    );
    const reservation = await reserveQuota(main.db, 4, SMALL);
    expect(reservation.ok).toBe(true);
    expect(await todayCount()).toBe(1);
  });

  it('o adiamento vai até a próxima janela (meia-noite UTC), com espalhamento de até 10 min', async () => {
    for (let index = 0; index < 8; index += 1) await reserveQuota(main.db, 4, SMALL);
    const early = await reserveQuota(main.db, 4, SMALL, () => 0);
    const late = await reserveQuota(main.db, 4, SMALL, () => 0.999);
    expect(early).toMatchObject({ ok: false });
    if (early.ok || late.ok) throw new Error('esperava recusa');
    expect(early.retryAfterSeconds).toBeGreaterThan(0);
    expect(early.retryAfterSeconds).toBeLessThanOrEqual(86_400);
    expect(late.retryAfterSeconds - early.retryAfterSeconds).toBeGreaterThan(590);
    expect(late.retryAfterSeconds - early.retryAfterSeconds).toBeLessThan(601);
  });

  it('devolver a vaga baixa a contagem, nunca abaixo de zero', async () => {
    const reservation = await reserveQuota(main.db, 4, SMALL);
    if (!reservation.ok) throw new Error('esperava vaga');
    expect(await todayCount()).toBe(1);
    await releaseQuota(main.db, reservation.day);
    await releaseQuota(main.db, reservation.day);
    expect(await todayCount()).toBe(0);
  });

  it('o Resend dizer que a cota do dia acabou encosta o livro-razão no limite', async () => {
    await reserveQuota(main.db, 4, SMALL);
    await markDayExhausted(main.db, SMALL);
    expect(await todayCount()).toBe(10);
    expect(await reserveQuota(main.db, 4, SMALL)).toMatchObject({ ok: false, reason: 'daily' });
  });

  it('o envio direto (link de acesso) conta sem recusar e avisa quando passa do limite', async () => {
    for (let index = 0; index < 10; index += 1) {
      expect(await recordDirectSend(main.db, SMALL)).toEqual({ overDailyLimit: false });
    }
    expect(await recordDirectSend(main.db, SMALL)).toEqual({ overDailyLimit: true });
    expect(await todayCount()).toBe(11);
  });
});

describe('resumo e sinal de upgrade', () => {
  it('soma hoje, o mês e os últimos 7 dias; o sinal liga a 60% de 7 × o limite diário', async () => {
    const empty = await quotaSummary(main.db);
    expect(empty).toMatchObject({ today: 0, month: 0, last7Days: 0, upgradeSignal: false });
    // 6 dias anteriores a 70 e hoje 0: 420 = exatamente 60% de 700.
    for (let back = 1; back <= 6; back += 1) {
      await main.db.execute(
        sql`insert into email_send_ledger (day, count) values ((now() at time zone 'utc')::date - ${back}::int, 70)`,
      );
    }
    const summary = await quotaSummary(main.db, FREE_PLAN_QUOTA);
    expect(summary.last7Days).toBe(420);
    expect(summary.upgradeSignal).toBe(true);
    expect(summary.dailyLimit).toBe(100);
    await main.db.execute(
      sql`update email_send_ledger set count = 69 where day = (now() at time zone 'utc')::date - 1`,
    );
    expect((await quotaSummary(main.db)).upgradeSignal).toBe(false);
  });
});

class ScriptedMailer implements Mailer {
  plan: MailResult[] = [];
  readonly calls: MailRequest[] = [];
  async send(request: MailRequest): Promise<MailResult> {
    this.calls.push(request);
    return this.plan.shift() ?? { ok: true, providerMessageId: `re_${this.calls.length}` };
  }
}

async function createUser(email: string) {
  const id = uuid();
  await main.db.insert(schema.user).values({ id, name: 'Pessoa', email });
  return id;
}

async function queueCourseAvailable(userId: string) {
  const { emailMessageId } = await main.db.transaction((tx) =>
    queueEmail(tx, {
      template: 'course-available',
      recipientUserId: userId,
      variables: { COURSE_TITLE: 'Curso' },
      dedupeKey: `ca:${uuid()}`,
      correlationId: 'corr-quota',
    }),
  );
  return emailMessageId;
}

async function deliver(emailMessageId: string, mailer: Mailer, policy: QuotaPolicy = SMALL) {
  const [intent] = await main.db
    .select()
    .from(schema.outboxMessage)
    .where(sql`payload->>'emailMessageId' = ${emailMessageId}`);
  const message = new FakeMessage({
    v: 1,
    kind: 'email.send',
    intentId: intent!.id,
    correlationId: 'corr-quota',
  });
  const alerts: AlertEvent[] = [];
  await processBatch([message], {
    lane: 'general',
    getDb: async () => main.db,
    sendToDeadLetter: async () => {},
    handlers: {
      'system.demo': async () => {},
      'email.send': createEmailHandler({
        getMailer: () => mailer,
        quota: createQuotaGate(policy),
        from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
        appUrl: 'https://hub.example',
        allowlist: [],
      }),
    },
    owner: `q-${uuid()}`,
    alert: (event) => alerts.push(event),
    random: () => 1,
  });
  return { message, alerts, intentId: intent!.id };
}

async function messageRow(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.emailMessage)
    .where(eq(schema.emailMessage.id, id));
  return found!;
}

async function intentRow(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.outboxMessage)
    .where(eq(schema.outboxMessage.id, id));
  return found!;
}

describe('rajada acima da cota: o excedente é ADIADO, nunca perdido nem failed', () => {
  it('15 e-mails de baixa prioridade com cota de 8: 8 saem, 7 ficam pending para a próxima janela, sem tentativa gasta', async () => {
    const userId = await createUser('pessoa@example.com');
    const mailer = new ScriptedMailer();
    const ids: string[] = [];
    for (let index = 0; index < 15; index += 1) ids.push(await queueCourseAvailable(userId));
    const delivered = [];
    for (const id of ids) delivered.push({ id, ...(await deliver(id, mailer)) });

    expect(mailer.calls).toHaveLength(8); // 10 - 2 de reserva do login
    const states = await Promise.all(ids.map(async (id) => (await messageRow(id)).state));
    expect(states.filter((state) => state === 'accepted')).toHaveLength(8);
    expect(states.filter((state) => state === 'queued')).toHaveLength(7);
    expect(states).not.toContain('failed');

    const deferred = delivered.filter((item) => states[ids.indexOf(item.id)] === 'queued');
    for (const item of deferred) {
      const intent = await intentRow(item.intentId);
      expect(intent).toMatchObject({ state: 'pending', attempts: 0, lastErrorCode: null });
      expect(intent.availableAt.getTime()).toBeGreaterThan(Date.now());
      expect(item.message.acked).toBe(true); // o Cron republica quando a linha ficar disponível
      expect(item.message.retried).toBeUndefined();
      expect(item.alerts).toEqual([]); // adiar não é alarme
      expect((await messageRow(item.id)).lastErrorCode).toBe('quota_daily');
    }
    expect(await todayCount()).toBe(8);
  });

  it('na janela seguinte o excedente é entregue (o Cron republica; aqui a virada do dia é simulada)', async () => {
    const userId = await createUser('pessoa@example.com');
    const mailer = new ScriptedMailer();
    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) ids.push(await queueCourseAvailable(userId));
    for (const id of ids) await deliver(id, mailer);
    const pending = await Promise.all(
      ids.map(async (id) => ({ id, state: (await messageRow(id)).state })),
    );
    const waiting = pending.filter((item) => item.state === 'queued').map((item) => item.id);
    expect(waiting).toHaveLength(2);

    // "Amanhã": o livro-razão de hoje vira o de ontem e o atraso vence.
    await main.db.execute(sql`update email_send_ledger set day = day - 1`);
    await main.db.execute(
      sql`update outbox_message set available_at = now() - interval '10 minutes' where state = 'pending'`,
    );
    for (const id of waiting) await deliver(id, mailer);
    expect(mailer.calls).toHaveLength(10);
    for (const id of waiting) expect((await messageRow(id)).state).toBe('accepted');
  });

  it('a prioridade do claim põe o mais importante na frente (classe menor sai primeiro)', async () => {
    const userId = await createUser('pessoa@example.com');
    const low = await queueCourseAvailable(userId); // classe 4 = 200
    const financial = await main.db.transaction((tx) =>
      queueEmail(tx, {
        template: 'purchase-confirmed',
        recipientUserId: userId,
        variables: { COURSE_TITLE: 'C', AMOUNT_BRL: 'R$ 10,00' },
        dedupeKey: `pc:${uuid()}`,
        correlationId: 'c',
      }),
    ); // classe 2 = 50
    const claimed = await claimOutbox(main.db, 10, 'w');
    const order = claimed.map(
      (item) => (item.payload as { emailMessageId: string }).emailMessageId,
    );
    expect(order).toEqual([financial.emailMessageId, low]);
  });
});

describe('o que acontece com a reserva conforme o provider responde', () => {
  async function one(mailer: ScriptedMailer) {
    const userId = await createUser(`p${uuid()}@example.com`);
    const id = await queueCourseAvailable(userId);
    return { id, ...(await deliver(id, mailer)) };
  }

  it('aceito: a vaga fica reservada', async () => {
    await one(new ScriptedMailer());
    expect(await todayCount()).toBe(1);
  });

  it('recusa do provider (4xx): a vaga VOLTA e a mensagem falha', async () => {
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'rejected', status: 422 }];
    const result = await one(mailer);
    expect(await todayCount()).toBe(0);
    expect((await messageRow(result.id)).state).toBe('failed');
  });

  it('429 de TAXA (por segundo): vaga devolvida, adiado por ~60 s, sem falha e sem gastar tentativa', async () => {
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'rate_limited', status: 429 }];
    const result = await one(mailer);
    expect(await todayCount()).toBe(0);
    const intent = await intentRow(result.intentId);
    expect(intent).toMatchObject({ state: 'pending', attempts: 0 });
    const wait = intent.availableAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(30_000);
    expect(wait).toBeLessThan(90_000);
    expect(result.message.acked).toBe(true);
    expect((await messageRow(result.id)).lastErrorCode).toBe('provider_429');
  });

  it('429 de COTA do dia: o livro-razão encosta no limite e o seguinte já sai adiado, sem chamar o provider', async () => {
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'rate_limited', status: 429, quota: 'daily' }];
    const first = await one(mailer);
    expect(await todayCount()).toBe(10); // encostado no limite diário
    const intent = await intentRow(first.intentId);
    expect(intent).toMatchObject({ state: 'pending', attempts: 0 });
    expect((await messageRow(first.id)).lastErrorCode).toBe('provider_quota_daily');

    const callsBefore = mailer.calls.length;
    const second = await one(mailer);
    expect(mailer.calls.length).toBe(callsBefore); // adiado pela cota local, sem ir ao Resend
    expect((await messageRow(second.id)).lastErrorCode).toBe('quota_daily');
  });

  it('timeout/5xx mantém a vaga (pode ter sido aceito) e a repetição com a mesma chave NÃO reserva de novo', async () => {
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'timeout' }];
    const result = await one(mailer);
    expect(await todayCount()).toBe(1);
    expect((await messageRow(result.id)).state).toBe('acceptance_unknown');

    await main.db.execute(
      sql`update outbox_message set available_at = now() - interval '10 minutes' where id = ${result.intentId}`,
    );
    await deliver(result.id, mailer);
    expect((await messageRow(result.id)).state).toBe('accepted');
    expect(await todayCount()).toBe(1); // continua 1: não contou duas vezes
    expect(mailer.calls).toHaveLength(2);
  });
});
