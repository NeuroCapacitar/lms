import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { evaluateAlerts, type OpsAlert } from '../../src/features/ops/operations.ts';
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
import { deliverAlerts } from '../../src/server/ops/alert-state-store.ts';
import { loadOperationsSnapshot } from '../../src/server/ops/operations-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { SimQueue, enqueueDemo, uuid } from '../helpers/async-harness.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
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
    sql`truncate table email_send_ledger, email_recipient_state, email_message, outbox_message, inbox_event, system_flag, job_run, alert_state`,
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

describe('saúde do banco e dos certificados (M9-06)', () => {
  it('conta os certificados em failed e lê o tamanho real do banco; sem failed o alerta some', async () => {
    const demo = await createDemoCourse(tools.db);
    const userId = uuid();
    await tools.db
      .insert(schema.user)
      .values({ id: userId, name: 'Pessoa Saúde', email: 'saude@saude.example.test' });
    await tools.db
      .insert(schema.enrollment)
      .values({ userId, courseId: demo.courseId, anchorAt: new Date(Date.now() - 86_400_000) });
    await tools.db
      .insert(schema.courseCompletion)
      .values({ userId, courseId: demo.courseId, requiredTotal: 5 });
    try {
      const before = await loadOperationsSnapshot(tools.db);
      expect(before.certificatesFailed).toBe(0);
      expect(before.databaseSizeBytes).toBeGreaterThan(1024 * 1024);
      expect(evaluateAlerts(before).map((a) => a.code)).not.toContain('certificate_failed');

      await tools.db.insert(schema.certificate).values({
        userId,
        courseId: demo.courseId,
        code: 'f'.repeat(22),
        status: 'failed',
        failureCode: 'render_timeout',
        snapshot: {
          version: 1,
          holderName: 'Pessoa Saúde',
          courseTitle: 'Curso Demonstrativo',
          workloadHours: 20,
          completedAt: '2026-06-01T12:00:00.000Z',
          requiredTotal: 5,
          issuer: { legalName: 'NeuroCapacitar Ltda', cnpj: '12345678000199' },
          signatory: null,
          layout: null,
          backgroundMediaId: null,
        },
      });
      const after = await loadOperationsSnapshot(tools.db);
      expect(after.certificatesFailed).toBe(1);
      expect(evaluateAlerts(after).map((a) => `${a.severity}:${a.code}`)).toContain(
        'P2:certificate_failed',
      );
    } finally {
      // TRUNCATE não passa pelos gatilhos de DELETE (a conclusão e o certificado não são apagáveis por desenho).
      await tools.db.execute(
        sql`truncate table certificate, course_completion, enrollment cascade`,
      );
    }
  });
});

describe('backup_run e o alerta de backup velho (M9-05)', () => {
  const insertBackup = (hoursAgo: number, key: string) =>
    tools.db.execute(sql`
      insert into backup_run (kind, object_key, sha256, size_bytes, migrations, pg_version, created_at)
      values ('daily', ${key}, ${'a'.repeat(64)}, 221019, 41, '18.1', now() - make_interval(hours => ${hoursAgo}))`);

  it('sem backup: P2; com o último há 25 h: sem alerta; há 27 h: P1; vale o MAIS RECENTE', async () => {
    await tools.db.execute(sql`truncate table backup_run`);
    try {
      const none = await loadOperationsSnapshot(tools.db);
      expect(none.backup).toEqual({ count: 0, lastAgeSeconds: null });
      expect(evaluateAlerts(none).map((a) => `${a.severity}:${a.code}`)).toContain(
        'P2:backup_never',
      );

      await insertBackup(60, 'daily/2026-10-15/hub-a.dump.age');
      await insertBackup(27, 'daily/2026-10-17/hub-b.dump.age');
      const stale = await loadOperationsSnapshot(tools.db);
      expect(stale.backup.count).toBe(2);
      expect(stale.backup.lastAgeSeconds).toBeGreaterThan(26 * 3600);
      expect(stale.backup.lastAgeSeconds).toBeLessThan(28 * 3600);
      expect(evaluateAlerts(stale).map((a) => `${a.severity}:${a.code}`)).toContain(
        'P1:backup_stale',
      );

      await insertBackup(25, 'daily/2026-10-17/hub-c.dump.age');
      const fresh = await loadOperationsSnapshot(tools.db);
      expect(fresh.backup.lastAgeSeconds).toBeLessThan(26 * 3600);
      expect(
        evaluateAlerts(fresh)
          .map((a) => a.code)
          .filter((c) => c.startsWith('backup_')),
      ).toEqual([]);
    } finally {
      await tools.db.execute(sql`truncate table backup_run`);
    }
  });

  it('o banco recusa backup com hash, tipo ou tamanho inválido e objeto repetido', async () => {
    await tools.db.execute(sql`truncate table backup_run`);
    try {
      const bad = (kind: string, sha: string, size: number, key: string) =>
        tools.db.execute(sql`
          insert into backup_run (kind, object_key, sha256, size_bytes, migrations, pg_version, created_at)
          values (${kind}, ${key}, ${sha}, ${size}, 1, '18.1', now())`);
      await expect(bad('weekly', 'a'.repeat(64), 10, 'k1')).rejects.toThrow();
      await expect(bad('daily', 'xyz', 10, 'k2')).rejects.toThrow();
      await expect(bad('daily', 'A'.repeat(64), 10, 'k3')).rejects.toThrow();
      await expect(bad('daily', 'a'.repeat(64), 0, 'k4')).rejects.toThrow();
      await bad('daily', 'a'.repeat(64), 10, 'k5');
      await expect(bad('daily', 'b'.repeat(64), 10, 'k5')).rejects.toThrow();
    } finally {
      await tools.db.execute(sql`truncate table backup_run`);
    }
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

describe('entrega dos alertas sem repetir (M9-06, ADR 0033)', () => {
  const alert = (code: string, severity: OpsAlert['severity'] = 'P1'): OpsAlert => ({
    code,
    severity,
    message: `mensagem de ${code}`,
  });
  const recorder = (ok = true) => {
    const sent: string[] = [];
    return {
      sent,
      send: async (item: OpsAlert) => {
        sent.push(item.code);
        return ok;
      },
    };
  };
  const ageNotification = (code: string, hours: number) =>
    tools.db.execute(
      sql`update alert_state set last_notified_at = now() - make_interval(hours => ${hours}) where code = ${code}`,
    );

  it('notifica na primeira vez, NÃO repete no ciclo seguinte e repete depois de 24 h', async () => {
    const one = recorder();
    expect(
      await deliverAlerts(
        tools.db,
        [alert('backup_stale'), alert('queue_slow:general', 'P2')],
        one.send,
      ),
    ).toBe(2);
    expect(one.sent.sort()).toEqual(['backup_stale', 'queue_slow:general']);

    const two = recorder();
    expect(
      await deliverAlerts(
        tools.db,
        [alert('backup_stale'), alert('queue_slow:general', 'P2')],
        two.send,
      ),
    ).toBe(0);
    expect(two.sent).toEqual([]);

    await ageNotification('backup_stale', 25);
    const three = recorder();
    expect(
      await deliverAlerts(
        tools.db,
        [alert('backup_stale'), alert('queue_slow:general', 'P2')],
        three.send,
      ),
    ).toBe(1);
    expect(three.sent).toEqual(['backup_stale']);
  });

  it('alerta que sumiu perde o estado e, se voltar, notifica na hora', async () => {
    await deliverAlerts(tools.db, [alert('backup_stale')], recorder().send);
    expect(await tools.db.select().from(schema.alertState)).toHaveLength(1);

    await deliverAlerts(tools.db, [], recorder().send);
    expect(await tools.db.select().from(schema.alertState)).toHaveLength(0);

    const back = recorder();
    expect(await deliverAlerts(tools.db, [alert('backup_stale')], back.send)).toBe(1);
  });

  it('envio que falhou NÃO marca como notificado: o próximo ciclo tenta de novo', async () => {
    const failing = recorder(false);
    expect(await deliverAlerts(tools.db, [alert('backup_stale')], failing.send)).toBe(0);
    const [row] = await tools.db.select().from(schema.alertState);
    expect(row).toMatchObject({ code: 'backup_stale', lastNotifiedAt: null });

    const retry = recorder(true);
    expect(await deliverAlerts(tools.db, [alert('backup_stale')], retry.send)).toBe(1);
    expect(retry.sent).toEqual(['backup_stale']);
  });

  it('o banco só aceita código e severidade bem formados', async () => {
    const insert = (code: string, severity: string) =>
      tools.db.execute(sql`insert into alert_state (code, severity) values (${code}, ${severity})`);
    await expect(insert('Maiúscula', 'P1')).rejects.toThrow();
    await expect(insert('com espaço', 'P1')).rejects.toThrow();
    await expect(insert('ok_code', 'P9')).rejects.toThrow();
    await insert('ok_code', 'P3');
  });
});

describe('job ops.alerts com o Sentry configurado', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia UM evento por alerta ativo ao Sentry, só com código e severidade, e não repete no ciclo seguinte', async () => {
    await deadItem();
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response('{}', { status: 200 });
    });
    const queue = new SimQueue();
    const context = (): JobContext => ({
      db: tools.db,
      env: {
        QUEUE_FINANCE: queue.bindings,
        QUEUE_GENERAL: queue.bindings,
        SENTRY_DSN: 'https://chave@o1.ingest.sentry.io/42',
      } as unknown as Env,
      alert: () => {},
      owner: `cron:${uuid()}`,
    });

    expect(await runCycle(context(), [alertsJob])).toEqual({ ran: 1, skipped: 0, failed: 0 });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((call) => call.url === 'https://o1.ingest.sentry.io/api/42/envelope/')).toBe(
      true,
    );
    const events = calls.map(
      (call) => JSON.parse(call.body.split('\n')[2]!) as { fingerprint: string[] },
    );
    expect(events.map((event) => event.fingerprint[0])).toEqual(
      expect.arrayContaining(['dead_letter:general', 'cron_never_ran']),
    );
    expect(calls.map((call) => call.body).join('')).not.toMatch(/@example|payload/);

    const firstRound = calls.length;
    await runCycle(context(), [alertsJob]);
    expect(calls.length).toBe(firstRound);
  });

  it('sem SENTRY_DSN nada é enviado e nenhum estado é gravado', async () => {
    await deadItem();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const queue = new SimQueue();
    await runCycle(
      {
        db: tools.db,
        env: { QUEUE_FINANCE: queue.bindings, QUEUE_GENERAL: queue.bindings } as unknown as Env,
        alert: () => {},
        owner: `cron:${uuid()}`,
      },
      [alertsJob],
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await tools.db.select().from(schema.alertState)).toHaveLength(0);
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
        'finance.refund': async () => {},
        'certificate.render': async () => {},
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
