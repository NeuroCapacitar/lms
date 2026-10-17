import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import type {
  AccessContext,
  DelegableCapability,
} from '../../src/features/identity/capabilities.ts';
import {
  QUEUE_KINDS,
  QUEUE_LIMIT,
  QUEUE_PER_KIND,
  QUEUE_RULES,
  formatAge,
  type QueueKind,
  type StaffQueueDto,
} from '../../src/features/staff/queue.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { loadStaffQueue } from '../../src/server/staff/queue-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { enqueueDemo } from '../helpers/async-harness.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse, type DemoFixture } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-01 (passo 3) em Postgres 18 real: a fila operacional unificada. Cada tipo entra com a idade certa e só quando está "parado" de
 * verdade (limites de tempo); o que está resolvido, recente ou fora da janela NÃO entra; cada tipo só aparece a quem pode vê-lo e a
 * ação só a quem tem o grant; a resposta não traz dado pessoal; o total real vem junto mesmo quando a lista corta.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let demo: DemoFixture;
let seq = 0;

async function student(label: string) {
  const id = `fila-${label}`;
  await tools.db
    .insert(schema.user)
    .values({ id, name: `Nome ${label}`, email: `${label}@fila.example.test` });
  return id;
}

async function paidOrder(userId: string) {
  const [order] = await tools.db
    .insert(schema.purchaseOrder)
    .values({
      userId,
      offerId: demo.offerId,
      courseId: demo.courseId,
      attemptId: crypto.randomUUID(),
      status: 'paid',
      courseTitle: 'Curso',
      offerName: 'Oferta',
      priceCents: 5000,
      accessMonths: 3,
      maxInstallments: 1,
      paymentMethods: ['pix'],
      expiresAt: new Date(Date.now() + DAY),
    })
    .returning({ id: schema.purchaseOrder.id });
  seq += 1;
  const [payment] = await tools.db
    .insert(schema.payment)
    .values({
      orderId: order!.id,
      providerPaymentId: `pay_fila_${seq}`,
      method: 'pix',
      amountCents: 5000,
      providerStatus: 'RECEIVED',
    })
    .returning({ id: schema.payment.id });
  return { orderId: order!.id, paymentId: payment!.id };
}

async function refund(
  userId: string,
  state: string,
  createdAgo: number,
  extra: { failureCode?: string; updatedAgo?: number } = {},
) {
  const { orderId, paymentId } = await paidOrder(userId);
  await tools.db.insert(schema.refundRequest).values({
    orderId,
    paymentId,
    requestedBy: userId,
    reason: 'motivo de teste',
    state,
    ...(extra.failureCode ? { failureCode: extra.failureCode } : {}),
    createdAt: ago(createdAgo),
    updatedAt: ago(extra.updatedAgo ?? createdAgo),
  });
}

async function certificate(
  userId: string,
  status: 'failed' | 'awaiting_name',
  updatedAgo: number,
  failureCode?: string,
) {
  await tools.db.insert(schema.enrollment).values({
    userId,
    courseId: demo.courseId,
    anchorAt: ago(DAY),
  });
  await tools.db
    .insert(schema.courseCompletion)
    .values({ userId, courseId: demo.courseId, requiredTotal: 5 });
  seq += 1;
  await tools.db.insert(schema.certificate).values({
    userId,
    courseId: demo.courseId,
    code: String(seq).padStart(22, 'x'),
    status,
    snapshot: {},
    ...(failureCode ? { failureCode } : {}),
    createdAt: ago(updatedAgo + HOUR),
    updatedAt: ago(updatedAgo),
  });
}

async function email(state: string, createdAgo: number) {
  seq += 1;
  await tools.db.insert(schema.emailMessage).values({
    dedupeKey: `fila-${seq}`,
    template: 'vnext-magic-link',
    recipientKind: 'support_inbox',
    state,
    createdAt: ago(createdAgo),
    updatedAt: ago(createdAgo),
  });
}

const closeTo = (age: number | undefined, expectedMs: number) => {
  expect(age).toBeGreaterThanOrEqual(Math.floor(expectedMs / 1000) - 2);
  expect(age).toBeLessThanOrEqual(Math.floor(expectedMs / 1000) + 90);
};

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  demo = await createDemoCourse(tools.db);
  const [a, b, c, d, e, f, g] = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(student));

  // Revisão financeira: uma aberta há 2 dias (entra) e uma resolvida (não entra).
  await tools.db.insert(schema.financialReview).values([
    { type: 'amount_mismatch', state: 'open', reason: 'valor diferente', createdAt: ago(2 * DAY) },
    {
      type: 'terminal_conflict',
      state: 'resolved',
      reason: 'resolvida',
      resolution: 'ok',
      resolvedAt: new Date(),
    },
  ]);
  // Reembolsos: em andamento há 20 min (entra) e há 5 min (não entra); incertos; falhou há 2 dias (entra) e há 40 dias (não).
  await refund(a!, 'submitted', 20 * MINUTE);
  await refund(b!, 'requested', 5 * MINUTE);
  await refund(c!, 'unknown', 3 * HOUR);
  await refund(d!, 'awaiting_external_authorization', HOUR);
  await refund(e!, 'failed', 3 * DAY, { failureCode: 'provider_rejected', updatedAgo: 2 * DAY });
  await refund(f!, 'failed', 50 * DAY, { updatedAgo: 40 * DAY });
  // Certificados: falha há 5 h (entra); esperando o nome há 4 dias (entra) e há 1 dia (não entra).
  await certificate(a!, 'failed', 5 * HOUR, 'render_failed');
  await certificate(b!, 'awaiting_name', 4 * DAY);
  await certificate(c!, 'awaiting_name', DAY);
  // E-mails: falhou há 1 dia (entra); entregue (não); falhou há 10 dias (fora da janela).
  await email('failed', DAY);
  await email('delivered', DAY);
  await email('failed', 10 * DAY);
  // Fila de envio: uma morta, uma parada há 1 h, uma recente (não entra).
  const dead = await enqueueDemo(tools.db);
  await tools.db.execute(
    sql`update outbox_message set state = 'dead', attempts = 8, finished_at = now() - interval '3 hours', last_error_code = 'provider_503' where id = ${dead.id}`,
  );
  const late = await enqueueDemo(tools.db);
  await tools.db.execute(
    sql`update outbox_message set available_at = now() - interval '1 hour' where id = ${late.id}`,
  );
  await enqueueDemo(tools.db);
  // Denúncias: um post com denúncia aberta há 6 h (entra) e outro com a denúncia resolvida (não entra).
  const lessonId = (
    await tools.db.select({ id: schema.lesson.id }).from(schema.lesson).limit(1)
  )[0]!.id;
  const post = async (body: string) =>
    (
      await tools.db
        .insert(schema.discussionPost)
        .values({ courseId: demo.courseId, lessonId, authorId: g!, body })
        .returning({ id: schema.discussionPost.id })
    )[0]!.id;
  const open = await post('Aberta');
  const closed = await post('Fechada');
  await tools.db.insert(schema.discussionReport).values([
    { postId: open, reporterId: a!, createdAt: ago(6 * HOUR) },
    { postId: closed, reporterId: a!, createdAt: ago(6 * HOUR), resolvedAt: new Date() },
  ]);
}, 240_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

const access = (role: 'admin' | 'support', grants: DelegableCapability[] = []): AccessContext => ({
  userId: 'quem',
  suspended: false,
  roles: new Set([role]),
  grants: new Set(grants),
});
const kindsOf = (queue: StaffQueueDto) => queue.items.map((item) => item.kind);
const itemOf = (queue: StaffQueueDto, kind: QueueKind) =>
  queue.items.find((item) => item.kind === kind);

describe('o que entra na fila, e com que idade', () => {
  it('cada tipo entra só quando está parado de verdade, com a idade certa; resolvido, recente e fora da janela NÃO entram', async () => {
    const queue = await loadStaffQueue(tools.db, access('admin'));
    expect(queue.totals).toEqual({
      financial_review: 1,
      refund_pending: 1,
      refund_uncertain: 2,
      refund_failed: 1,
      certificate_failed: 1,
      certificate_awaiting_name: 1,
      email_problem: 1,
      outbox_problem: 2,
      discussion_report: 1,
    });
    expect(queue.hidden).toEqual([]);
    expect(queue.truncated).toBe(false);
    expect(queue.items).toHaveLength(11);
    closeTo(itemOf(queue, 'financial_review')?.ageSeconds, 2 * DAY);
    closeTo(itemOf(queue, 'refund_pending')?.ageSeconds, 20 * MINUTE);
    closeTo(itemOf(queue, 'refund_failed')?.ageSeconds, 2 * DAY);
    closeTo(itemOf(queue, 'certificate_failed')?.ageSeconds, 5 * HOUR);
    closeTo(itemOf(queue, 'certificate_awaiting_name')?.ageSeconds, 4 * DAY);
    closeTo(itemOf(queue, 'email_problem')?.ageSeconds, DAY);
    closeTo(itemOf(queue, 'discussion_report')?.ageSeconds, 6 * HOUR);
    expect(itemOf(queue, 'refund_failed')?.detail).toBe('provider_rejected');
    expect(itemOf(queue, 'certificate_failed')?.detail).toBe('render_failed');
    expect(itemOf(queue, 'email_problem')?.detail).toBe('vnext-magic-link / failed');
    const outbox = queue.items.filter((item) => item.kind === 'outbox_problem');
    expect(outbox.map((item) => item.detail?.split(' / ')[1]).sort()).toEqual([
      'pending',
      'provider_503',
    ]);
  });

  it('vem do mais antigo para o mais novo', async () => {
    const queue = await loadStaffQueue(tools.db, access('admin'));
    const ages = queue.items.map((item) => item.ageSeconds);
    expect(ages).toEqual([...ages].sort((x, y) => y - x));
  });

  it('a resposta não traz nome, e-mail nem dado de pagamento', async () => {
    const text = JSON.stringify(await loadStaffQueue(tools.db, access('admin')));
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/Nome [a-g]/);
    expect(text).not.toContain('pay_fila');
    expect(text).not.toContain('fila-');
  });
});

describe('quem vê e quem age', () => {
  it('Suporte sem grant vê só o geral (certificados, e-mail, fila de envio) e NENHUMA ação; finanças e moderação ficam "hidden"', async () => {
    const queue = await loadStaffQueue(tools.db, access('support'));
    expect(new Set(kindsOf(queue))).toEqual(
      new Set([
        'certificate_failed',
        'certificate_awaiting_name',
        'email_problem',
        'outbox_problem',
      ]),
    );
    expect(queue.hidden.sort()).toEqual(
      [
        'financial_review',
        'refund_pending',
        'refund_uncertain',
        'refund_failed',
        'discussion_report',
      ].sort(),
    );
    expect(queue.items.every((item) => item.action === null)).toBe(true);
    expect(queue.totals.financial_review).toBeUndefined();
  });

  it('cada grant abre o que é dele: ops.queue age em certificado e fila de envio; refund.execute vê e age nos reembolsos; finance.review nas revisões; discussion.moderate nas denúncias', async () => {
    const ops = await loadStaffQueue(tools.db, access('support', ['ops.queue']));
    expect(itemOf(ops, 'certificate_failed')?.action).toEqual({
      label: 'Tentar de novo',
      screen: '/staff/certificados/emitidos',
    });
    expect(itemOf(ops, 'outbox_problem')?.action?.screen).toBe('/staff/operacao');
    expect(itemOf(ops, 'certificate_awaiting_name')?.action).toBeNull();
    expect(kindsOf(ops)).not.toContain('refund_uncertain');

    const refunds = await loadStaffQueue(tools.db, access('support', ['refund.execute']));
    expect(kindsOf(refunds)).toEqual(
      expect.arrayContaining(['refund_pending', 'refund_uncertain', 'refund_failed']),
    );
    expect(kindsOf(refunds)).not.toContain('financial_review');
    expect(itemOf(refunds, 'refund_uncertain')?.action?.screen).toBe('/staff/financeiro');

    const review = await loadStaffQueue(tools.db, access('support', ['finance.review']));
    expect(itemOf(review, 'financial_review')?.action?.label).toBe('Resolver');
    expect(kindsOf(review)).not.toContain('refund_pending');

    const moderator = await loadStaffQueue(tools.db, access('support', ['discussion.moderate']));
    expect(itemOf(moderator, 'discussion_report')?.action?.screen).toBe('/staff/discussoes');
  });

  it('toda regra de tipo tem título e definição escritos', () => {
    for (const kind of QUEUE_KINDS) {
      const rule = QUEUE_RULES[kind];
      expect(rule.title.length).toBeGreaterThan(5);
      expect(rule.definition.endsWith('.')).toBe(true);
    }
  });
});

describe('o endpoint GET /api/staff/queue', () => {
  const application = () =>
    apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
  const env = () =>
    ({
      HYPERDRIVE: { connectionString: database.connectionString },
      APP_BASE_URL: BASE_URL,
      BETTER_AUTH_SECRET: SECRET,
      TURNSTILE_SECRET_KEY: 'x',
    }) as unknown as Env;

  async function person(role: 'support' | 'admin') {
    seq += 1;
    const user = tools.test.createUser({
      email: `via${seq}@fila.example.test`,
      name: `Via ${seq}`,
    });
    await tools.test.saveUser(user);
    await grantRole(tools.db, { actorId: null, targetId: user.id, role });
    return (await tools.test.login({ userId: user.id })).headers;
  }

  it('Suporte e Admin recebem a fila pelo mesmo caminho, cada um com o que pode ver', async () => {
    const bare = await application().request(
      '/api/staff/queue',
      { headers: await person('support') },
      env(),
    );
    expect(bare.status).toBe(200);
    expect(bare.headers.get('cache-control')).toBe('no-store');
    const bareQueue = (await bare.json()) as StaffQueueDto;
    expect(bareQueue.hidden).toContain('refund_uncertain');
    expect(bareQueue.items.every((item) => item.action === null)).toBe(true);

    const full = (await (
      await application().request('/api/staff/queue', { headers: await person('admin') }, env())
    ).json()) as StaffQueueDto;
    expect(full.hidden).toEqual([]);
    expect(full.items.length).toBeGreaterThan(bareQueue.items.length);
  });
});

describe('formatAge', () => {
  it('escreve a idade em português, arredondando para baixo', () => {
    expect(formatAge(0)).toBe('menos de 1 min');
    expect(formatAge(59)).toBe('menos de 1 min');
    expect(formatAge(60)).toBe('1 min');
    expect(formatAge(15 * 60 + 59)).toBe('15 min');
    expect(formatAge(3 * 3600 + 10)).toBe('3 h');
    expect(formatAge(86_400)).toBe('1 dia');
    expect(formatAge(2 * 86_400 + 5)).toBe('2 dias');
    expect(formatAge(-5)).toBe('menos de 1 min');
  });
});

describe('volume', () => {
  it('passando do limite por tipo, o total real vem junto e a resposta avisa que cortou', async () => {
    const rows = Array.from({ length: QUEUE_PER_KIND + 10 }, (_, index) => ({
      type: 'event_anomaly',
      state: 'open',
      reason: 'sintética',
      providerPaymentId: `pay_volume_${index}`,
      createdAt: ago((index + 1) * HOUR),
    }));
    await tools.db.insert(schema.financialReview).values(rows);
    const queue = await loadStaffQueue(tools.db, access('admin'));
    expect(queue.totals.financial_review).toBe(1 + QUEUE_PER_KIND + 10);
    expect(queue.items.filter((item) => item.kind === 'financial_review')).toHaveLength(
      QUEUE_PER_KIND,
    );
    expect(queue.truncated).toBe(true);
    expect(queue.items.length).toBeLessThanOrEqual(QUEUE_LIMIT);
  });
});
