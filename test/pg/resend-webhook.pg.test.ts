import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import type { AlertEvent } from '../../src/server/async/alerts.ts';
import { processBatch } from '../../src/server/async/consumer.ts';
import { processInbox } from '../../src/server/async/inbox-processor.ts';
import { createQuotaGate } from '../../src/server/email/quota-store.ts';
import { createEmailHandler, type EmailHandlerDeps } from '../../src/server/email/send-handler.ts';
import { queueEmail } from '../../src/server/email/email-store.ts';
import { hashRecipient } from '../../src/server/email/recipient-hash.ts';
import { resendEventHandler } from '../../src/server/email/resend-events.ts';
import type { Mailer } from '../../src/server/email/mailer.ts';
import { csrfProtection } from '../../src/server/security/csrf.ts';
import { resendWebhookRoutes } from '../../src/server/webhooks/resend-routes.ts';
import { FakeMessage, uuid } from '../helpers/async-harness.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';
import { TEST_WEBHOOK_SECRET, signedHeaders } from '../helpers/svix.ts';

/**
 * M4-07 em Postgres 18 real: webhook do Resend (assinatura Svix antes de tudo, inbox mínima antes do
 * ACK, 200 explícito), reflexo da entrega em `email_message` só para frente, supressão por bounce
 * permanente e reclamação (hash do destinatário), bloqueio do próximo envio e nenhum dado pessoal gravado.
 */
let database: TestSchema;
let main: OpenDatabase;

const HASH_KEY = 'chave-de-hmac-so-de-teste-0123456789abcdef';
const ADDRESS = 'ana.souza@example.com';
const BASE = 'https://hub.example.test';

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_BASE_URL: BASE,
    RESEND_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    EMAIL_HASH_KEY: HASH_KEY,
    HYPERDRIVE: { connectionString: database.connectionString },
    ...overrides,
  } as unknown as Env;
}

function webhookApp() {
  return new Hono<{ Bindings: Env }>()
    .use('/api/*', csrfProtection())
    .route('/api/webhooks', resendWebhookRoutes());
}

const event = (type: string, extra: Record<string, unknown> = {}, emailId = 'email-123') =>
  JSON.stringify({
    type,
    created_at: '2026-10-13T12:00:00.000Z',
    data: {
      email_id: emailId,
      from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
      to: [ADDRESS],
      subject: 'Seu acesso ao curso',
      ...extra,
    },
  });

async function post(body: string, headers?: Record<string, string>, environment: Env = env()) {
  return webhookApp().request(
    '/api/webhooks/resend',
    { method: 'POST', body, headers: headers ?? (await signedHeaders(body)) },
    environment,
  );
}

async function inboxRows() {
  return main.db.select().from(schema.inboxEvent);
}

async function process() {
  const alerts: AlertEvent[] = [];
  const count = await processInbox(main.db, {
    handlers: { resend: resendEventHandler },
    owner: `teste-${uuid()}`,
    alert: (event) => alerts.push(event),
  });
  return { count, alerts };
}

async function newMessage(providerMessageId: string, state = 'accepted', userId?: string) {
  const [created] = await main.db
    .insert(schema.emailMessage)
    .values({
      dedupeKey: `t:${uuid()}`,
      template: 'access-granted',
      recipientKind: 'user',
      recipientUserId: userId ?? null,
      variables: { COURSE_TITLE: 'C', EXPIRES_AT: 'x' },
      state,
      providerMessageId,
    })
    .returning();
  return created!;
}

async function stateOf(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.emailMessage)
    .where(eq(schema.emailMessage.id, id));
  return found!.state;
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
  await main.db.execute(
    sql`truncate table email_send_ledger, email_message, email_recipient_state, outbox_message, inbox_event, system_flag, job_run`,
  );
  await main.db.delete(schema.user);
});

describe('POST /api/webhooks/resend', () => {
  it('assinatura válida: 200 explícito, evento na inbox só com o mínimo, sem passar pelo CSRF', async () => {
    const body = event('email.delivered');
    const headers = await signedHeaders(body, { id: 'msg_abc' });
    // Sem Origin e com content-type de webhook: o CSRF do navegador NÃO se aplica a esta rota.
    const response = await post(body, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const rows = await inboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'resend', eventId: 'msg_abc', state: 'pending' });
    expect(rows[0]!.payload).toEqual({
      type: 'email.delivered',
      emailId: 'email-123',
      occurredAt: '2026-10-13T12:00:00.000Z',
    });
  });

  it('reenvio do mesmo evento (mesmo svix-id) responde 200 e fica UMA linha', async () => {
    const body = event('email.delivered');
    const headers = await signedHeaders(body, { id: 'msg_dup' });
    expect((await post(body, headers)).status).toBe(200);
    expect((await post(body, headers)).status).toBe(200);
    expect(await inboxRows()).toHaveLength(1);
  });

  it('assinatura inválida, ausente, de outro segredo ou expirada: 400 e NADA é gravado', async () => {
    const body = event('email.delivered');
    const good = await signedHeaders(body);
    const cases: Record<string, Record<string, string>> = {
      adulterada: { ...good, 'svix-signature': `${good['svix-signature']!.slice(0, -4)}AAAA` },
      ausente: { 'content-type': 'application/json', 'svix-id': 'x', 'svix-timestamp': '1' },
      outroSegredo: await signedHeaders(body, {
        secret: `whsec_${btoa('segredo-errado-do-atacante-1234')}`,
      }),
      expirada: await signedHeaders(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
    };
    for (const [name, headers] of Object.entries(cases)) {
      const response = await post(body, headers);
      expect(response.status, name).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'invalid_signature' } });
    }
    // Corpo trocado depois de assinar.
    expect((await post(event('email.bounced'), good)).status).toBe(400);
    expect(await inboxRows()).toHaveLength(0);
  });

  it('sem os segredos configurados nada é aceito (fail closed, 500) e nada é gravado', async () => {
    const body = event('email.delivered');
    expect((await post(body, undefined, env({ RESEND_WEBHOOK_SECRET: undefined }))).status).toBe(
      500,
    );
    expect((await post(body, undefined, env({ EMAIL_HASH_KEY: undefined }))).status).toBe(500);
    expect(await inboxRows()).toHaveLength(0);
  });

  it('corpo acima de 64 KiB é recusado (413) sem gravar', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'x', lixo: 'x'.repeat(70_000) },
    });
    expect((await post(body)).status).toBe(413);
    expect(await inboxRows()).toHaveLength(0);
  });

  it('assinado mas sem email_id (não é evento utilizável): 200 e ignora', async () => {
    expect((await post(JSON.stringify({ type: 'domain.updated', data: {} }))).status).toBe(200);
    expect((await post('não é json')).status).toBe(200);
    expect(await inboxRows()).toHaveLength(0);
  });

  it('se a inbox não consegue gravar, responde 5xx para o Resend reenviar', async () => {
    const response = await post(
      event('email.delivered'),
      undefined,
      env({ HYPERDRIVE: { connectionString: 'postgres://u:p@127.0.0.1:1/db' } as Hyperdrive }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'inbox_unavailable' } });
  });

  it('só aceita POST', async () => {
    const response = await webhookApp().request('/api/webhooks/resend', { method: 'GET' }, env());
    expect(response.status).toBe(404);
  });
});

describe('estado de entrega só avança', () => {
  it('delivered depois de bounced NÃO desfaz; delayed depois de delivered não recua; complained vence', async () => {
    const bounced = await newMessage('m-bounced');
    const delayed = await newMessage('m-delayed');
    const complained = await newMessage('m-complained');
    // Fora de ordem: bounced chega ANTES do delivered; delayed chega DEPOIS do delivered.
    for (const [type, emailId, id] of [
      ['email.bounced', 'm-bounced', 'msg_1'],
      ['email.delivered', 'm-bounced', 'msg_2'],
      ['email.delivered', 'm-delayed', 'msg_3'],
      ['email.delivery_delayed', 'm-delayed', 'msg_4'],
      ['email.delivered', 'm-complained', 'msg_5'],
      ['email.complained', 'm-complained', 'msg_6'],
    ] as const) {
      const body = event(
        type,
        type === 'email.bounced' ? { bounce: { type: 'Transient' } } : {},
        emailId,
      );
      expect((await post(body, await signedHeaders(body, { id }))).status).toBe(200);
    }
    await process();
    expect(await stateOf(bounced.id)).toBe('bounced');
    expect(await stateOf(delayed.id)).toBe('delivered');
    expect(await stateOf(complained.id)).toBe('complained');
  });

  it('o mesmo evento aplicado de novo dá o mesmo resultado (idempotente) e estados finais do envio não mudam', async () => {
    const accepted = await newMessage('m-ok');
    const failedBySend = await newMessage('m-failed', 'failed');
    const blocked = await newMessage('m-blocked', 'blocked');
    for (const emailId of ['m-ok', 'm-failed', 'm-blocked']) {
      const body = event('email.delivered', {}, emailId);
      await post(body, await signedHeaders(body, { id: `msg_${emailId}` }));
    }
    await process();
    await main.db.execute(
      sql`update inbox_event set state = 'pending', finished_at = null, lease_owner = null, lease_until = null`,
    );
    await process();
    expect(await stateOf(accepted.id)).toBe('delivered');
    expect(await stateOf(failedBySend.id)).toBe('failed');
    expect(await stateOf(blocked.id)).toBe('blocked');
  });

  it('email.failed e email.suppressed do Resend refletem na mensagem', async () => {
    const failed = await newMessage('m-f1');
    const suppressed = await newMessage('m-s1');
    for (const [type, emailId] of [
      ['email.failed', 'm-f1'],
      ['email.suppressed', 'm-s1'],
    ] as const) {
      const body = event(type, {}, emailId);
      await post(body, await signedHeaders(body, { id: `msg_${emailId}` }));
    }
    await process();
    expect(await stateOf(failed.id)).toBe('failed');
    expect(await stateOf(suppressed.id)).toBe('suppressed');
  });

  it('tipo de evento desconhecido é concluído sem mexer em nada', async () => {
    const message = await newMessage('m-x');
    const body = event('email.opened', {}, 'm-x');
    await post(body, await signedHeaders(body));
    const { count } = await process();
    expect(count).toBe(1);
    expect(await stateOf(message.id)).toBe('accepted');
  });
});

describe('supressão por bounce permanente e reclamação', () => {
  async function deliverEvent(type: string, extra: Record<string, unknown>, emailId: string) {
    const body = event(type, extra, emailId);
    await post(body, await signedHeaders(body, { id: `msg_${uuid()}` }));
    await process();
  }

  const mailer: Mailer & { calls: number } = {
    calls: 0,
    async send() {
      this.calls += 1;
      return { ok: true, providerMessageId: 're_x' };
    },
  };

  function emailDeps(): EmailHandlerDeps {
    return {
      getMailer: () => mailer,
      quota: createQuotaGate(),
      from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
      appUrl: BASE,
      allowlist: [],
      isSuppressed: async (db, address) => {
        const hash = await hashRecipient(HASH_KEY, address);
        const [found] = await db
          .select()
          .from(schema.emailRecipientState)
          .where(eq(schema.emailRecipientState.recipientHash, hash));
        return found !== undefined;
      },
    };
  }

  async function sendNext(userId: string) {
    const { emailMessageId } = await main.db.transaction((tx) =>
      queueEmail(tx, {
        template: 'access-granted',
        recipientUserId: userId,
        variables: { COURSE_TITLE: 'C', EXPIRES_AT: 'x' },
        dedupeKey: `next:${uuid()}`,
        correlationId: 'c',
      }),
    );
    const [intent] = await main.db
      .select()
      .from(schema.outboxMessage)
      .where(sql`payload->>'emailMessageId' = ${emailMessageId}`);
    const handlers = {
      'system.demo': async () => {},
      'interest.fanout': async () => {},
      'finance.refund': async () => {},
      'email.send': createEmailHandler(emailDeps()),
    };
    await processBatch(
      [
        new FakeMessage({
          v: 1,
          kind: 'email.send',
          intentId: intent!.id,
          correlationId: 'c',
        }),
      ],
      {
        lane: 'general',
        getDb: async () => main.db,
        sendToDeadLetter: async () => {},
        handlers,
        owner: `s-${uuid()}`,
        alert: () => {},
      },
    );
    return emailMessageId;
  }

  it('bounce PERMANENTE suprime o endereço (hash) e o próximo envio enfileirado vira suppressed', async () => {
    const userId = uuid();
    await main.db.insert(schema.user).values({ id: userId, name: 'Ana Souza', email: ADDRESS });
    await newMessage('m-hard', 'accepted', userId);
    await deliverEvent(
      'email.bounced',
      { bounce: { type: 'Permanent', subType: 'General' } },
      'm-hard',
    );

    const states = await main.db.select().from(schema.emailRecipientState);
    expect(states).toEqual([
      expect.objectContaining({
        recipientHash: await hashRecipient(HASH_KEY, ADDRESS),
        reason: 'hard_bounce',
        state: 'suppressed',
      }),
    ]);
    const before = mailer.calls;
    const next = await sendNext(userId);
    expect(mailer.calls).toBe(before); // o provider NÃO foi chamado
    expect(await stateOf(next)).toBe('suppressed');
  });

  it('reclamação suprime; bounce transitório NÃO suprime', async () => {
    await deliverEvent('email.bounced', { bounce: { type: 'Transient' } }, 'm-soft');
    expect(await main.db.select().from(schema.emailRecipientState)).toHaveLength(0);
    await deliverEvent('email.complained', {}, 'm-complaint');
    const states = await main.db.select().from(schema.emailRecipientState);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ reason: 'complaint' });
  });

  it('evento sem email_message (ex.: link de acesso enviado direto) ainda suprime', async () => {
    await deliverEvent('email.bounced', { bounce: { type: 'Permanent' } }, 'sem-registro');
    expect(await main.db.select().from(schema.emailRecipientState)).toHaveLength(1);
  });

  it('bounce e reclamação NÃO alteram a conta nem a matrícula da pessoa', async () => {
    const userId = uuid();
    await main.db.insert(schema.user).values({ id: userId, name: 'Ana Souza', email: ADDRESS });
    const before = await main.db.select().from(schema.user).where(eq(schema.user.id, userId));
    await newMessage('m-user', 'accepted', userId);
    await deliverEvent('email.bounced', { bounce: { type: 'Permanent' } }, 'm-user');
    await deliverEvent('email.complained', {}, 'm-user');
    expect(await main.db.select().from(schema.user).where(eq(schema.user.id, userId))).toEqual(
      before,
    );
    expect(await main.db.select().from(schema.userSuspension)).toHaveLength(0);
  });

  it('nenhum endereço, nome ou assunto aparece na inbox, na supressão nem nos alertas', async () => {
    await newMessage('m-pii');
    const alerts: AlertEvent[] = [];
    const body = event(
      'email.bounced',
      { bounce: { type: 'Permanent', message: ADDRESS } },
      'm-pii',
    );
    await post(body, await signedHeaders(body));
    const result = await process();
    alerts.push(...result.alerts);
    const persisted = JSON.stringify([
      await main.db.select().from(schema.inboxEvent),
      await main.db.select().from(schema.emailRecipientState),
      await main.db.select().from(schema.emailMessage),
      alerts,
    ]).toLowerCase();
    for (const leaked of ['ana.souza', 'example.com', 'seu acesso ao curso', 'neurocapacitar <']) {
      expect(persisted, leaked).not.toContain(leaked);
    }
  });
});
