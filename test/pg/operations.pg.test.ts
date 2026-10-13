import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { evaluateAlerts } from '../../src/features/ops/operations.ts';
import type { AlertEvent } from '../../src/server/async/alerts.ts';
import { pauseFlagKey } from '../../src/server/async/flags.ts';
import { alertsJob, runCycle, type JobContext } from '../../src/server/async/jobs.ts';
import { publishAfterCommit } from '../../src/server/async/publisher.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { requestCorrelationId } from '../../src/server/correlation.ts';
import { queueEmail } from '../../src/server/email/email-store.ts';
import type { MailRequest, MailResult, Mailer } from '../../src/server/email/mailer.ts';
import { createQuotaGate } from '../../src/server/email/quota-store.ts';
import { createEmailHandler } from '../../src/server/email/send-handler.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { loadOperationsSnapshot } from '../../src/server/ops/operations-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { SimQueue, enqueueDemo, uuid } from '../helpers/async-harness.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M4-05 em Postgres 18 real: o Operations Center. A foto do estado (sem payload nem dado pessoal), a
 * autorização de cada rota (leitura da Staff; reenfileirar com `ops.queue`; kill switch só Admin; ações com
 * reautenticação e motivo), a auditoria, os alertas do Cron e o id de correlação de ponta a ponta.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  await tools.db.execute(
    sql`truncate table email_send_ledger, email_recipient_state, email_message, outbox_message, inbox_event, system_flag, job_run`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
const env = (extra: Partial<Env> = {}) =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
    ...extra,
  }) as unknown as Env;

async function newPerson(
  options: { role?: 'support' | 'admin'; reauth?: boolean; grant?: 'ops.queue' } = {},
) {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  if (options.role)
    await grantRole(tools.db, { actorId: null, targetId: user.id, role: options.role });
  if (options.grant) {
    await tools.db
      .insert(schema.staffGrant)
      .values({ userId: user.id, capability: options.grant, grantedBy: user.id });
  }
  const session = await tools.test.login({ userId: user.id });
  if (options.reauth) {
    await tools.db
      .insert(schema.reauthProof)
      .values({ sessionId: session.session.id, verifiedAt: new Date() });
  }
  return { id: user.id, headers: session.headers };
}

function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api/staff${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
/** A auditoria é append-only (não dá para truncar): cada teste olha só as linhas do SEU alvo. */
const auditFor = (targetId: string) =>
  tools.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, targetId));
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function deadItem(overrides: { kind?: string; error?: string } = {}) {
  const { id } = await enqueueDemo(tools.db);
  await tools.db.execute(sql`
    update outbox_message
       set state = 'dead', attempts = 8, finished_at = now(), last_error_code = ${overrides.error ?? 'provider_503'}
     where id = ${id}`);
  return id;
}

describe('foto do estado (somente leitura, sem payload)', () => {
  it('conta por fila e estado, idade da mais antiga, itens dead/failed, jobs, inbox, e-mail, cota e pausa', async () => {
    const pendingOld = await enqueueDemo(tools.db);
    await tools.db.execute(
      sql`update outbox_message set available_at = now() - interval '2 hours' where id = ${pendingOld.id}`,
    );
    await enqueueDemo(tools.db); // pending recente
    const dead = await deadItem();
    await tools.db.execute(sql`
      insert into job_run (name, last_status, last_count, last_duration_ms, last_finished_at, last_started_at)
      values ('cron', 'ok', 2, 3500, now() - interval '5 minutes', now() - interval '6 minutes'),
             ('outbox.republish', 'error', 0, 800, now() - interval '5 minutes', now() - interval '6 minutes')`);
    await tools.db.insert(schema.inboxEvent).values({
      provider: 'resend',
      eventId: 'evt_1',
      payload: { type: 'email.delivered', emailId: 'x' },
      correlationId: 'c',
    });
    await tools.db
      .insert(schema.systemFlag)
      .values({ key: pauseFlagKey('general'), enabled: true, reason: 'teste' });

    const snapshot = await loadOperationsSnapshot(tools.db);
    expect(snapshot.outbox).toEqual(
      expect.arrayContaining([
        { queue: 'general', state: 'pending', count: 2 },
        { queue: 'general', state: 'dead', count: 1 },
      ]),
    );
    expect(snapshot.oldestOpenAgeSeconds.general).toBeGreaterThan(7000);
    expect(snapshot.oldestOpenAgeSeconds.finance).toBeNull();
    expect(snapshot.problems).toEqual([
      expect.objectContaining({
        id: dead,
        state: 'dead',
        attempts: 8,
        lastErrorCode: 'provider_503',
      }),
    ]);
    expect(snapshot.cronAgeSeconds).toBeGreaterThan(250);
    expect(snapshot.cronAgeSeconds).toBeLessThan(400);
    expect(snapshot.jobs.map((job) => job.name)).toEqual(['cron', 'outbox.republish']);
    expect(snapshot.inbox).toEqual([
      expect.objectContaining({ provider: 'resend', pending: 1, problems: 0 }),
    ]);
    expect(snapshot.paused).toEqual({ finance: false, general: true });
    expect(snapshot.quota).toMatchObject({ today: 0, dailyLimit: 100 });
    const alerts = evaluateAlerts(snapshot).map((alert) => alert.code);
    expect(alerts).toEqual(
      expect.arrayContaining([
        'queue_slow:general',
        'dead_letter:general',
        'queue_paused:general',
        'job_failed:outbox.republish',
      ]),
    );
  });

  it('NUNCA devolve payload, e-mail, nome nem segredo (varredura do JSON inteiro)', async () => {
    const userId = uuid();
    await tools.db
      .insert(schema.user)
      .values({ id: userId, name: 'Ana Souza', email: 'ana.souza@example.com' });
    const { emailMessageId } = await tools.db.transaction((tx) =>
      queueEmail(tx, {
        template: 'access-granted',
        recipientUserId: userId,
        variables: { COURSE_TITLE: 'Curso Secreto', EXPIRES_AT: '12/01/2027' },
        dedupeKey: `pii:${uuid()}`,
        correlationId: 'corr-pii',
      }),
    );
    await tools.db.execute(
      sql`update outbox_message set state = 'dead', finished_at = now(), last_error_code = 'x' where payload->>'emailMessageId' = ${emailMessageId}`,
    );
    const text = JSON.stringify(await loadOperationsSnapshot(tools.db)).toLowerCase();
    for (const leaked of [
      'ana.souza',
      'ana souza',
      'curso secreto',
      'emailmessageid',
      emailMessageId,
    ]) {
      expect(text, leaked).not.toContain(leaked.toLowerCase());
    }
  });

  it('o job em execução (lease vivo) aparece como running', async () => {
    await tools.db.execute(sql`
      insert into job_run (name, lease_owner, lease_until, lease_version, last_started_at)
      values ('outbox.republish', 'w', now() + interval '5 minutes', 1, now())`);
    const [job] = (await loadOperationsSnapshot(tools.db)).jobs;
    expect(job).toMatchObject({ name: 'outbox.republish', running: true });
  });
});

describe('GET /api/staff/operations (autorização)', () => {
  it('sem sessão 401; aluno comum 403; Suporte SEM grant e Admin 200', async () => {
    const student = await newPerson();
    const support = await newPerson({ role: 'support' });
    const admin = await newPerson({ role: 'admin' });
    expect((await call('GET', '/operations')).status).toBe(401);
    expect((await call('GET', '/operations', student.headers)).status).toBe(403);
    const ok = await call('GET', '/operations', support.headers);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(await json(ok)).sort()).toEqual(['alerts', 'snapshot']);
    expect((await call('GET', '/operations', admin.headers)).status).toBe(200);
  });

  it('conta suspensa não vê nada', async () => {
    const support = await newPerson({ role: 'support' });
    await tools.db
      .insert(schema.userSuspension)
      .values({ userId: support.id, reason: 'teste', suspendedBy: support.id });
    expect((await call('GET', '/operations', support.headers)).status).toBe(403);
  });
});

describe('reenfileirar item dead (ops.queue + reautenticação + motivo + auditoria)', () => {
  const requeue = (
    headers: Headers | undefined,
    id: string,
    body: unknown = { reason: 'o provider voltou' },
  ) => call('POST', `/operations/outbox/${id}/requeue`, headers, body);

  it('Suporte SEM o grant: 403 e o item não muda', async () => {
    const id = await deadItem();
    const support = await newPerson({ role: 'support', reauth: true });
    expect((await requeue(support.headers, id)).status).toBe(403);
    expect(
      (
        await tools.db.select().from(schema.outboxMessage).where(eq(schema.outboxMessage.id, id))
      )[0]!.state,
    ).toBe('dead');
    expect(await auditFor(id)).toHaveLength(0);
  });

  it('com o grant mas SEM reautenticação recente: 403 reauth_required', async () => {
    const id = await deadItem();
    const support = await newPerson({ role: 'support', grant: 'ops.queue' });
    const response = await requeue(support.headers, id);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: 'reauth_required' } });
  });

  it('com o grant e a reautenticação: volta a pending (tentativas zeradas), audita ator, motivo e erro anterior', async () => {
    const id = await deadItem({ error: 'provider_503' });
    const support = await newPerson({ role: 'support', grant: 'ops.queue', reauth: true });
    const response = await requeue(support.headers, id, { reason: '  o provider voltou ao ar  ' });
    expect(response.status).toBe(200);
    const [row] = await tools.db
      .select()
      .from(schema.outboxMessage)
      .where(eq(schema.outboxMessage.id, id));
    expect(row).toMatchObject({
      state: 'pending',
      attempts: 0,
      finishedAt: null,
      leaseOwner: null,
    });
    const audit = await auditFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: support.id,
      action: 'ops.requeue',
      targetType: 'outbox_message',
      targetId: id,
      details: {
        reason: 'o provider voltou ao ar',
        kind: 'system.demo',
        previousError: 'provider_503',
      },
    });
  });

  it('motivo ausente ou curto, corpo com campo extra, id malformado: 400; inexistente 404; já tratado 409', async () => {
    const id = await deadItem();
    const admin = await newPerson({ role: 'admin', reauth: true });
    for (const body of [{}, { reason: 'ok' }, { reason: 'motivo valido', extra: 1 }]) {
      expect((await requeue(admin.headers, id, body)).status).toBe(400);
    }
    expect((await requeue(admin.headers, 'nao-e-uuid')).status).toBe(400);
    expect((await requeue(admin.headers, uuid())).status).toBe(404);
    expect((await requeue(admin.headers, id)).status).toBe(200);
    expect((await requeue(admin.headers, id)).status).toBe(409); // agora está pending: não é reenfileirável
    expect(await auditFor(id)).toHaveLength(1);
  });

  it('item pending, delivered ou leased NÃO é reenfileirável (só dead e failed)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const { id } = await enqueueDemo(tools.db);
    expect((await requeue(admin.headers, id)).status).toBe(409);
  });

  it('e-mail: o email_message que ficou failed volta a queued (senão o handler o trataria como final)', async () => {
    const userId = uuid();
    await tools.db
      .insert(schema.user)
      .values({ id: userId, name: 'Bia', email: 'bia@example.com' });
    const { emailMessageId } = await tools.db.transaction((tx) =>
      queueEmail(tx, {
        template: 'access-granted',
        recipientUserId: userId,
        variables: { COURSE_TITLE: 'C', EXPIRES_AT: 'x' },
        dedupeKey: `rq:${uuid()}`,
        correlationId: 'c',
      }),
    );
    await tools.db.execute(
      sql`update email_message set state = 'failed', last_error_code = 'provider_422' where id = ${emailMessageId}`,
    );
    await tools.db.execute(
      sql`update outbox_message set state = 'failed', finished_at = now() where payload->>'emailMessageId' = ${emailMessageId}`,
    );
    const [intent] = await tools.db.select().from(schema.outboxMessage);
    const admin = await newPerson({ role: 'admin', reauth: true });
    expect((await requeue(admin.headers, intent!.id)).status).toBe(200);
    const [email] = await tools.db
      .select()
      .from(schema.emailMessage)
      .where(eq(schema.emailMessage.id, emailMessageId));
    expect(email).toMatchObject({ state: 'queued', lastErrorCode: null });
  });
});

describe('kill switch por fila (só Admin + reautenticação + motivo + auditoria)', () => {
  const pause = (headers: Headers | undefined, lane: string, body: unknown) =>
    call('POST', `/operations/queues/${lane}/pause`, headers, body);

  it('Suporte, mesmo com ops.queue e reautenticado, NÃO pausa fila (system.maintenance é só do Admin)', async () => {
    const support = await newPerson({ role: 'support', grant: 'ops.queue', reauth: true });
    expect(
      (await pause(support.headers, 'general', { paused: true, reason: 'incidente' })).status,
    ).toBe(403);
    expect(await tools.db.select().from(schema.systemFlag)).toHaveLength(0);
  });

  it('Admin sem reautenticação: 403 reauth_required', async () => {
    const admin = await newPerson({ role: 'admin' });
    const response = await pause(admin.headers, 'general', { paused: true, reason: 'incidente' });
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: 'reauth_required' } });
  });

  it('Admin reautenticado pausa e retoma; cada mudança é auditada com o motivo', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    expect(
      (await pause(admin.headers, 'finance', { paused: true, reason: 'incidente no provider' }))
        .status,
    ).toBe(200);
    let snapshot = await loadOperationsSnapshot(tools.db);
    expect(snapshot.paused).toEqual({ finance: true, general: false });
    expect(
      (await pause(admin.headers, 'finance', { paused: false, reason: 'incidente resolvido' }))
        .status,
    ).toBe(200);
    snapshot = await loadOperationsSnapshot(tools.db);
    expect(snapshot.paused.finance).toBe(false);
    const audit = await auditFor('finance');
    expect(audit.map((entry) => entry.action).sort()).toEqual([
      'ops.queue_pause',
      'ops.queue_resume',
    ]);
    expect(audit[0]).toMatchObject({ actorId: admin.id, targetType: 'queue', targetId: 'finance' });
  });

  it('fila inexistente 404; corpo inválido 400', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    expect(
      (await pause(admin.headers, 'media', { paused: true, reason: 'incidente' })).status,
    ).toBe(404);
    expect(
      (await pause(admin.headers, 'general', { paused: 'sim', reason: 'incidente' })).status,
    ).toBe(400);
    expect((await pause(admin.headers, 'general', { paused: true })).status).toBe(400);
  });
});

describe('alertas no Cron', () => {
  it('o job ops.alerts registra um alerta por problema (só severidade e código) e some quando resolvido', async () => {
    await deadItem();
    const alerts: AlertEvent[] = [];
    const queue = new SimQueue();
    const context: JobContext = {
      db: tools.db,
      env: { QUEUE_FINANCE: queue.bindings, QUEUE_GENERAL: queue.bindings } as unknown as Env,
      alert: (event) => alerts.push(event),
      owner: `cron:${uuid()}`,
    };
    const summary = await runCycle(context, [alertsJob]);
    expect(summary).toEqual({ ran: 1, skipped: 0, failed: 0 });
    expect(alerts.map((event) => event.reason)).toEqual(
      expect.arrayContaining(['P2:dead_letter:general', 'P2:cron_never_ran']),
    );
    expect(alerts.every((event) => event.code === 'ops_alert')).toBe(true);
    expect(JSON.stringify(alerts)).not.toMatch(/@|payload/);
    const [run] = await tools.db
      .select()
      .from(schema.jobRun)
      .where(eq(schema.jobRun.name, 'ops.alerts'));
    expect(run).toMatchObject({ lastStatus: 'ok' });
  });
});

describe('correlação de ponta a ponta (HTTP → outbox → Queue → handler → provider)', () => {
  it('o id gerado na requisição chega ao provider como tag e ao registro da outbox', async () => {
    const userId = uuid();
    await tools.db
      .insert(schema.user)
      .values({ id: userId, name: 'Ana', email: 'ana@example.com' });
    const queue = new SimQueue();
    const seen: MailRequest[] = [];
    const mailer: Mailer = {
      async send(request: MailRequest): Promise<MailResult> {
        seen.push(request);
        return { ok: true, providerMessageId: 're_1' };
      },
    };
    // Uma rota "de domínio": grava o e-mail na transação com o id da requisição e publica depois do commit.
    const http = new Hono<{ Bindings: Env }>().post('/enqueue', async (c) => {
      const correlationId = requestCorrelationId(c.req.raw.headers);
      const { emailMessageId } = await tools.db.transaction((tx) =>
        queueEmail(tx, {
          template: 'access-granted',
          recipientUserId: userId,
          variables: { COURSE_TITLE: 'Curso', EXPIRES_AT: '12/01/2027' },
          dedupeKey: `corr:${uuid()}`,
          correlationId,
        }),
      );
      const [intent] = await tools.db
        .select()
        .from(schema.outboxMessage)
        .where(sql`payload->>'emailMessageId' = ${emailMessageId}`);
      publishAfterCommit(
        { QUEUE_FINANCE: queue.bindings, QUEUE_GENERAL: queue.bindings } as unknown as Env,
        { waitUntil: () => {} },
        [{ id: intent!.id, kind: 'email.send', correlationId }],
      );
      await new Promise((resolve) => setTimeout(resolve, 50)); // o publish roda "em segundo plano"
      return c.json({ ok: true });
    });
    const requestId = uuid();
    const response = await http.request(
      '/enqueue',
      { method: 'POST', headers: { 'x-request-id': requestId } },
      env(),
    );
    expect(response.status).toBe(200);
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]).toMatchObject({ correlationId: requestId });

    await queue.deliver({
      lane: 'general',
      getDb: async () => tools.db,
      sendToDeadLetter: async () => {},
      handlers: {
        'system.demo': async () => {},
        'interest.fanout': async () => {},
        'email.send': createEmailHandler({
          getMailer: () => mailer,
          quota: createQuotaGate(),
          from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
          appUrl: 'https://hub.example',
          allowlist: [],
        }),
      },
      owner: 'corr-test',
      alert: () => {},
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.correlationId).toBe(requestId);
    const [outbox] = await tools.db.select().from(schema.outboxMessage);
    expect(outbox!.correlationId).toBe(requestId);
  });

  it('x-request-id que não é UUID (texto livre de fora) vira um id novo, nunca é gravado', () => {
    const headers = new Headers({ 'x-request-id': '<script>alert(1)</script>' });
    const id = requestCorrelationId(headers);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toContain('script');
    expect(requestCorrelationId(new Headers())).toMatch(/^[0-9a-f-]{36}$/);
  });
});
