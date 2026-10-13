import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import type { AlertEvent } from '../../src/server/async/alerts.ts';
import { processBatch } from '../../src/server/async/consumer.ts';
import type { HandlerRegistry } from '../../src/server/async/handlers.ts';
import {
  EmailRecipientInvalidError,
  EmailVariablesInvalidError,
  TemplateNotQueueableError,
  queueEmail,
} from '../../src/server/email/email-store.ts';
import type { MailRequest, MailResult, Mailer } from '../../src/server/email/mailer.ts';
import { createQuotaGate } from '../../src/server/email/quota-store.ts';
import { createEmailHandler, type EmailHandlerDeps } from '../../src/server/email/send-handler.ts';
import { FakeMessage, uuid } from '../helpers/async-harness.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M4-04 em Postgres 18 real: e-mail transacional pelo outbox. Contrato validado ANTES de gravar, rollback
 * sem e-mail órfão, mesma intenção entregue 2× = 1 envio, 429/5xx/timeout sem falha definitiva, janela da
 * chave de idempotência, allowlist do Staging, falha de e-mail que nunca desfaz o domínio e varredura de
 * dado pessoal em tudo o que é gravado ou alertado. O Resend é um mailer roteirizado.
 */
let database: TestSchema;
let main: OpenDatabase;

const ADDRESS = 'ana.souza@example.com';
const SUPPORT = 'suporte@neurocapacitar.example';

class ScriptedMailer implements Mailer {
  plan: MailResult[] = [];
  readonly calls: MailRequest[] = [];
  async send(request: MailRequest): Promise<MailResult> {
    this.calls.push(request);
    return this.plan.shift() ?? { ok: true, providerMessageId: `re_${this.calls.length}` };
  }
}

function deps(mailer: Mailer, overrides: Partial<EmailHandlerDeps> = {}): EmailHandlerDeps {
  return {
    getMailer: () => mailer,
    quota: createQuotaGate(),
    from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
    appUrl: 'https://hub.example',
    allowlist: [],
    supportInbox: SUPPORT,
    ...overrides,
  };
}

function registry(handlerDeps: EmailHandlerDeps): HandlerRegistry {
  return { 'system.demo': async () => {}, 'email.send': createEmailHandler(handlerDeps) };
}

async function createUser(email = ADDRESS, name = 'Ana Souza') {
  const id = uuid();
  await main.db.insert(schema.user).values({ id, name, email });
  return id;
}

async function queue(
  options: {
    template?: string;
    userId?: string;
    variables?: Record<string, string>;
    dedupeKey?: string;
  } = {},
) {
  return main.db.transaction((tx) =>
    queueEmail(tx, {
      template: options.template ?? 'access-granted',
      recipientUserId: options.userId,
      variables: options.variables ?? { COURSE_TITLE: 'Curso de Teste', EXPIRES_AT: '12/01/2027' },
      dedupeKey: options.dedupeKey ?? `acesso:${uuid()}`,
      correlationId: 'corr-email',
    }),
  );
}

async function message(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.emailMessage)
    .where(eq(schema.emailMessage.id, id));
  return found!;
}

async function outboxFor(emailMessageId: string) {
  const rows = await main.db.select().from(schema.outboxMessage);
  return rows.find(
    (row) => (row.payload as { emailMessageId?: string }).emailMessageId === emailMessageId,
  );
}

/** Entrega a intenção do e-mail ao consumidor real (como a Queue faria) e devolve as mensagens falsas. */
async function deliver(
  emailMessageId: string,
  handlerDeps: EmailHandlerDeps,
  alerts: AlertEvent[] = [],
) {
  const intent = await outboxFor(emailMessageId);
  const messages = [
    new FakeMessage({
      v: 1,
      kind: 'email.send',
      intentId: intent!.id,
      correlationId: intent!.correlationId,
    }),
  ];
  await processBatch(messages, {
    lane: 'general',
    getDb: async () => main.db,
    sendToDeadLetter: async () => {},
    handlers: registry(handlerDeps),
    owner: `email-${uuid()}`,
    alert: (event) => alerts.push(event),
    random: () => 1,
  });
  return messages[0]!;
}

async function makeDue(emailMessageId: string) {
  await main.db.execute(
    sql`update outbox_message set available_at = now() - interval '10 minutes' where payload->>'emailMessageId' = ${emailMessageId}`,
  );
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
    sql`truncate table email_message, email_send_ledger, outbox_message, inbox_event, system_flag, job_run`,
  );
  await main.db.delete(schema.user);
});

describe('queueEmail (contrato validado antes de gravar)', () => {
  it('grava a mensagem e a intenção na MESMA transação, com a prioridade da classe', async () => {
    const userId = await createUser();
    const { emailMessageId, created } = await queue({
      userId,
      template: 'purchase-confirmed',
      variables: { COURSE_TITLE: 'C', AMOUNT_BRL: 'R$ 10,00' },
    });
    expect(created).toBe(true);
    expect(await message(emailMessageId)).toMatchObject({
      state: 'queued',
      template: 'purchase-confirmed',
      recipientKind: 'user',
      recipientUserId: userId,
    });
    const intent = await outboxFor(emailMessageId);
    expect(intent).toMatchObject({
      kind: 'email.send',
      queue: 'general',
      state: 'pending',
      priority: 50,
    });
    expect(intent!.payload).toEqual({ emailMessageId }); // só o id
  });

  it('rollback da transação de domínio não deixa e-mail nem intenção órfãos', async () => {
    const userId = await createUser();
    await expect(
      main.db.transaction(async (tx) => {
        await queueEmail(tx, {
          template: 'access-granted',
          recipientUserId: userId,
          variables: { COURSE_TITLE: 'C', EXPIRES_AT: 'x' },
          dedupeKey: 'some-no-rollback',
          correlationId: 'c',
        });
        throw new Error('falha de domínio depois de enfileirar');
      }),
    ).rejects.toThrow('falha de domínio');
    expect(await main.db.select().from(schema.emailMessage)).toHaveLength(0);
    expect(await main.db.select().from(schema.outboxMessage)).toHaveLength(0);
  });

  it('variável faltando, a mais ou fora do formato falha ANTES de gravar qualquer coisa', async () => {
    const userId = await createUser();
    const invalid: Record<string, string>[] = [
      { COURSE_TITLE: 'C' },
      { COURSE_TITLE: 'C', EXPIRES_AT: 'x', EMAIL: ADDRESS },
      { COURSE_TITLE: '', EXPIRES_AT: 'x' },
    ];
    for (const variables of invalid) {
      await expect(queue({ userId, variables })).rejects.toBeInstanceOf(EmailVariablesInvalidError);
    }
    expect(await main.db.select().from(schema.emailMessage)).toHaveLength(0);
    expect(await main.db.select().from(schema.outboxMessage)).toHaveLength(0);
  });

  it('template desconhecido ou de link direto (token) nunca entra na outbox', async () => {
    const userId = await createUser();
    for (const template of ['magic-link', 'password-reset', 'nao-existe']) {
      await expect(
        queue({ userId, template, variables: { LINK_URL: 'https://x' } }),
      ).rejects.toBeInstanceOf(TemplateNotQueueableError);
    }
  });

  it('destinatário: o modelo de pessoa exige a conta; o de suporte proíbe', async () => {
    const userId = await createUser();
    await expect(
      queue({ variables: { COURSE_TITLE: 'C', EXPIRES_AT: 'x' } }),
    ).rejects.toBeInstanceOf(EmailRecipientInvalidError);
    await expect(
      queue({
        userId,
        template: 'support-request',
        variables: { REQUEST_ID: uuid(), CATEGORY: 'acesso' },
      }),
    ).rejects.toBeInstanceOf(EmailRecipientInvalidError);
  });

  it('a mesma dedupeKey não duplica: devolve o mesmo e-mail', async () => {
    const userId = await createUser();
    const first = await queue({ userId, dedupeKey: 'unica' });
    const second = await queue({ userId, dedupeKey: 'unica' });
    expect(second).toEqual({ emailMessageId: first.emailMessageId, created: false });
    expect(await main.db.select().from(schema.outboxMessage)).toHaveLength(1);
  });
});

describe('envio pelo handler', () => {
  it('aceito: relê o destinatário da conta, manda o modelo com NAME e APP_URL e registra o id do provider', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    const alerts: AlertEvent[] = [];
    const delivered = await deliver(emailMessageId, deps(mailer), alerts);

    expect(delivered.acked).toBe(true);
    expect(mailer.calls).toHaveLength(1);
    expect(mailer.calls[0]).toMatchObject({
      to: ADDRESS,
      templateAlias: 'access-granted',
      variables: {
        COURSE_TITLE: 'Curso de Teste',
        EXPIRES_AT: '12/01/2027',
        NAME: 'Ana Souza',
        APP_URL: 'https://hub.example',
      },
    });
    const saved = await message(emailMessageId);
    expect(saved).toMatchObject({ state: 'accepted', providerMessageId: 're_1' });
    expect(saved.acceptedAt).not.toBeNull();
    expect((await outboxFor(emailMessageId))!.state).toBe('delivered');
    expect(alerts).toEqual([]);
  });

  it('a MESMA intenção entregue duas vezes produz UM envio', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    await deliver(emailMessageId, deps(mailer));
    await deliver(emailMessageId, deps(mailer));
    expect(mailer.calls).toHaveLength(1);
  });

  it('o modelo de suporte vai para a caixa de suporte; sem ela configurada, falha sem enviar', async () => {
    const mailer = new ScriptedMailer();
    const { emailMessageId } = await queue({
      template: 'support-request',
      variables: { REQUEST_ID: uuid(), CATEGORY: 'acesso' },
    });
    await deliver(emailMessageId, deps(mailer));
    expect(mailer.calls[0]).toMatchObject({ to: SUPPORT, templateAlias: 'support-request' });
    expect(mailer.calls[0]!.variables.NAME).toBeUndefined();

    const other = await queue({
      template: 'support-request',
      variables: { REQUEST_ID: uuid(), CATEGORY: 'acesso' },
    });
    await deliver(other.emailMessageId, deps(mailer, { supportInbox: undefined }));
    expect(await message(other.emailMessageId)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'recipient_unconfigured',
    });
    expect(mailer.calls).toHaveLength(1);
  });

  it('429 NÃO é falha definitiva: volta para a fila, sem aceitar, e envia quando houver folga', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'rate_limited', status: 429 }];
    const first = await deliver(emailMessageId, deps(mailer));
    // M4-08: 429 é ADIAMENTO (a mensagem é confirmada, a linha volta a pending sem gastar tentativa).
    expect(first.acked).toBe(true);
    expect(first.retried).toBeUndefined();
    expect(await message(emailMessageId)).toMatchObject({
      state: 'queued',
      lastErrorCode: 'provider_429',
    });
    expect(await outboxFor(emailMessageId)).toMatchObject({ state: 'pending', attempts: 0 });

    await makeDue(emailMessageId);
    await deliver(emailMessageId, deps(mailer));
    expect(mailer.calls.map((call) => call.idempotencyKey)).toHaveLength(2);
    expect((await message(emailMessageId)).state).toBe('accepted');
  });

  it('5xx e timeout deixam acceptance_unknown e a repetição usa a MESMA chave de idempotência', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    mailer.plan = [
      { ok: false, kind: 'unavailable', status: 503 },
      { ok: false, kind: 'timeout' },
    ];
    await deliver(emailMessageId, deps(mailer));
    expect(await message(emailMessageId)).toMatchObject({
      state: 'acceptance_unknown',
      lastErrorCode: 'provider_503',
    });
    await makeDue(emailMessageId);
    await deliver(emailMessageId, deps(mailer));
    expect(await message(emailMessageId)).toMatchObject({
      state: 'acceptance_unknown',
      lastErrorCode: 'provider_timeout',
    });
    await makeDue(emailMessageId);
    await deliver(emailMessageId, deps(mailer));

    expect(mailer.calls).toHaveLength(3);
    expect(new Set(mailer.calls.map((call) => call.idempotencyKey)).size).toBe(1);
    expect((await message(emailMessageId)).state).toBe('accepted');
  });

  it('acceptance_unknown fora da janela de ~23 h NÃO repete às cegas: failed para revisão', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'timeout' }];
    await deliver(emailMessageId, deps(mailer));
    await main.db.execute(
      sql`update email_message set first_attempt_at = now() - interval '24 hours' where id = ${emailMessageId}`,
    );
    await makeDue(emailMessageId);
    const alerts: AlertEvent[] = [];
    await deliver(emailMessageId, deps(mailer), alerts);
    expect(mailer.calls).toHaveLength(1);
    expect(await message(emailMessageId)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'idempotency_window_expired',
    });
    expect(alerts[0]).toMatchObject({
      code: 'intent_failed',
      reason: 'idempotency_window_expired',
    });
  });

  it('recusa do provider (4xx) é definitiva: failed com o status, sem repetir', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'rejected', status: 422 }];
    await deliver(emailMessageId, deps(mailer));
    expect(await message(emailMessageId)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'provider_422',
    });
    expect((await outboxFor(emailMessageId))!.state).toBe('failed');
  });

  it('allowlist (Staging): endereço fora dela vira blocked e o provider nunca é chamado', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    const delivered = await deliver(
      emailMessageId,
      deps(mailer, { allowlist: ['outra.pessoa@example.com'] }),
    );
    expect(delivered.acked).toBe(true);
    expect(mailer.calls).toHaveLength(0);
    expect((await message(emailMessageId)).state).toBe('blocked');
    expect((await outboxFor(emailMessageId))!.state).toBe('delivered');

    const allowed = await queue({ userId });
    await deliver(allowed.emailMessageId, deps(mailer, { allowlist: [ADDRESS] }));
    expect((await message(allowed.emailMessageId)).state).toBe('accepted');
  });

  it('endereço suprimido (gancho do M4-07) vira suppressed sem enviar', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const mailer = new ScriptedMailer();
    await deliver(emailMessageId, deps(mailer, { isSuppressed: async () => true }));
    expect(mailer.calls).toHaveLength(0);
    expect((await message(emailMessageId)).state).toBe('suppressed');
  });

  it('conta sem destinatário e variáveis adulteradas no banco falham ANTES de chamar o provider', async () => {
    const mailer = new ScriptedMailer();
    const gone = await queue({ userId: await createUser() });
    await main.db.delete(schema.user);
    await deliver(gone.emailMessageId, deps(mailer));
    expect(await message(gone.emailMessageId)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'recipient_missing',
    });

    const tampered = await queue({ userId: await createUser('outra@example.com') });
    await main.db.execute(
      sql`update email_message set variables = '{"COURSE_TITLE":"C","EMAIL":"x@y.co"}'::jsonb where id = ${tampered.emailMessageId}`,
    );
    await deliver(tampered.emailMessageId, deps(mailer));
    expect(await message(tampered.emailMessageId)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'variables_invalid',
    });
    expect(mailer.calls).toHaveLength(0);
  });

  it('Resend não configurado: a intenção tenta de novo depois (não finge que enviou)', async () => {
    const userId = await createUser();
    const { emailMessageId } = await queue({ userId });
    const delivered = await deliver(emailMessageId, {
      ...deps(new ScriptedMailer()),
      getMailer: () => {
        throw new Error('RESEND_API_KEY ausente');
      },
    });
    expect(delivered.retried).toBeDefined();
    expect((await message(emailMessageId)).state).toBe('queued');
    expect((await outboxFor(emailMessageId))!.lastErrorCode).toBe('mailer_not_configured');
  });

  it('falha de e-mail NÃO desfaz o que aconteceu no domínio (a conta e a matrícula seguem)', async () => {
    const userId = uuid();
    const { emailMessageId } = await main.db.transaction(async (tx) => {
      await tx.insert(schema.user).values({ id: userId, name: 'Bia', email: 'bia@example.com' });
      return queueEmail(tx, {
        template: 'access-granted',
        recipientUserId: userId,
        variables: { COURSE_TITLE: 'C', EXPIRES_AT: 'x' },
        dedupeKey: `acesso:${userId}`,
        correlationId: 'c',
      });
    });
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'rejected', status: 400 }];
    await deliver(emailMessageId, deps(mailer));
    expect((await message(emailMessageId)).state).toBe('failed');
    const [account] = await main.db.select().from(schema.user).where(eq(schema.user.id, userId));
    expect(account?.email).toBe('bia@example.com');
  });
});

describe('dado pessoal', () => {
  it('nenhum endereço aparece no e-mail gravado, na outbox, nos alertas nem no resultado do provider', async () => {
    const userId = await createUser();
    const ok = await queue({ userId });
    const failing = await queue({ userId });
    const alerts: AlertEvent[] = [];
    const mailer = new ScriptedMailer();
    await deliver(ok.emailMessageId, deps(mailer), alerts);
    mailer.plan = [{ ok: false, kind: 'rejected', status: 422 }];
    await deliver(failing.emailMessageId, deps(mailer), alerts);

    const persisted = JSON.stringify([
      await main.db.select().from(schema.emailMessage),
      await main.db.select().from(schema.outboxMessage),
      alerts,
    ]);
    expect(persisted).not.toContain(ADDRESS);
    expect(persisted).not.toContain('ana.souza');
    expect(persisted).not.toContain('Ana Souza');
  });
});
