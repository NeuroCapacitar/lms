import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { resolveAccess } from '../../src/server/access/entitlement-store.ts';
import { DeferError, PermanentError } from '../../src/server/async/handler-types.ts';
import { createHandlers } from '../../src/server/async/handlers.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createOffer, setOfferStatus } from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createFakeCheckoutProvider } from '../../src/server/commerce/fake-checkout.ts';
import {
  createFakePaymentReader,
  type FakePaymentReader,
} from '../../src/server/commerce/fake-payments.ts';
import {
  createFakeRefundProvider,
  type FakeRefundProvider,
} from '../../src/server/commerce/fake-refund.ts';
import { applyPaymentEvidence } from '../../src/server/commerce/payment-evidence-store.ts';
import { createRefundHandler } from '../../src/server/commerce/refund-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M6-05 em Postgres 18 real, com o DUBLÊ do Asaas: reembolso INTEGRAL por RefundRequest durável. Grant
 * `refund.execute` + reautenticação recente + motivo; 7 dias (calendário de São Paulo) para o Suporte, depois só o
 * Admin; o acesso é suspenso ao pedir e restaurado na falha inequívoca; o executor relê o pagamento antes de qualquer
 * chamada e NUNCA reenvia às cegas; confirmado (REFUNDED relido) o direito é revogado e há UM e-mail.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-14T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let checkoutProvider: ReturnType<typeof createFakeCheckoutProvider>;
let reader: FakePaymentReader;
let refunds: FakeRefundProvider;
let courseId: string;
let clockNow = T0;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  courseId = (await seedDemoCourse(tools.db)).courseId;
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});

function fresh() {
  checkoutProvider = createFakeCheckoutProvider();
  reader = createFakePaymentReader();
  refunds = createFakeRefundProvider();
  clockNow = T0;
}
const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;
const app = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    clock: () => clockNow,
    checkoutProvider,
    paymentReader: reader,
    refundProvider: refunds,
  });

interface Person {
  id: string;
  headers: Headers;
}
async function newPerson(
  options: { role?: 'support' | 'admin'; grants?: string[]; reauth?: boolean } = {},
): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `reemb${seq}@example.test`, name: `Reemb ${seq}` });
  await tools.test.saveUser(user);
  await tools.db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, user.id));
  if (options.role)
    await grantRole(tools.db, { actorId: null, targetId: user.id, role: options.role });
  for (const capability of options.grants ?? []) {
    await tools.db
      .insert(schema.staffGrant)
      .values({ userId: user.id, capability, grantedBy: user.id });
  }
  const session = await tools.test.login({ userId: user.id });
  if (options.reauth) {
    await tools.db
      .insert(schema.reauthProof)
      .values({ sessionId: session.session.id, verifiedAt: new Date() });
  }
  return { id: user.id as string, headers: session.headers };
}
function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function paidOffer() {
  seq += 1;
  const offerId = await createOffer(tools.db, {
    actorId: null,
    courseId,
    name: `Oferta ${seq}`,
    kind: 'paid',
    priceCents: 19_700,
    accessMonths: 12,
    maxInstallments: 12,
  });
  await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'active' });
  return offerId;
}

/** Compra e pagamento confirmado (Pix RECEIVED) no instante T0: pedido `paid` com acesso. */
async function paidOrder(options: { installment?: boolean } = {}) {
  const student = await newPerson();
  clockNow = T0;
  const response = await call('POST', '/me/checkout', student.headers, {
    offerId: await paidOffer(),
    attemptId: crypto.randomUUID(),
  });
  expect(response.status).toBe(200);
  const [order] = await tools.db
    .select()
    .from(schema.purchaseOrder)
    .where(eq(schema.purchaseOrder.userId, student.id));
  const [session] = await tools.db
    .select()
    .from(schema.checkoutSession)
    .where(eq(schema.checkoutSession.orderId, order!.id));
  const pay = reader.set({
    id: `pay_f${(seq += 1)}_${crypto.randomUUID().slice(0, 6)}`,
    checkoutSessionId: session!.providerSessionId!,
    status: options.installment ? 'CONFIRMED' : 'RECEIVED',
    billingType: options.installment ? 'CREDIT_CARD' : 'PIX',
    ...(options.installment
      ? { installmentId: 'ins_77', valueCents: 1642, totalCents: 19_700 }
      : {}),
  });
  await applyPaymentEvidence(
    tools.db,
    { reader, now: () => T0 },
    { paymentId: pay.id, eventHint: null },
  );
  // quando o provider "aceita" o estorno, o pagamento passa a REFUND_REQUESTED
  refunds.onAccepted = () => {
    reader.set({ id: pay.id, status: 'REFUND_REQUESTED' });
  };
  return { student, orderId: order!.id as string, pay };
}

const staffWithGrant = () =>
  newPerson({ role: 'support', grants: ['refund.execute'], reauth: true });
const request = (
  who: Person | undefined,
  orderId: string,
  body: unknown = { reason: 'Desistência dentro do prazo' },
) => call('POST', `/staff/finance/orders/${orderId}/refund`, who?.headers, body);

const orderRow = async (orderId: string) =>
  (
    await tools.db.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, orderId))
  )[0]!;
const refundOf = async (orderId: string) =>
  (
    await tools.db
      .select()
      .from(schema.refundRequest)
      .where(eq(schema.refundRequest.orderId, orderId))
  ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const hasAccess = async (userId: string, at = clockNow) =>
  (await resolveAccess(tools.db, userId, courseId, at)).hasAccess;
const emailsOf = (userId: string, template: string) =>
  tools.db
    .select()
    .from(schema.emailMessage)
    .where(
      and(
        eq(schema.emailMessage.recipientUserId, userId),
        eq(schema.emailMessage.template, template),
      ),
    );
const enrollmentOf = async (userId: string) =>
  (
    await tools.db
      .select()
      .from(schema.enrollment)
      .where(and(eq(schema.enrollment.userId, userId), eq(schema.enrollment.courseId, courseId)))
  )[0]!;

/** Executa o handler da intenção `finance.refund` do pedido de reembolso, como o consumidor faria. */
function runExecutor(refundRequestId: string, at: Date = clockNow) {
  clockNow = at;
  const handler = createRefundHandler({ provider: refunds, reader, now: () => at });
  return handler({
    db: tools.db,
    payload: { refundRequestId },
    intentId: crypto.randomUUID(),
    correlationId: 'c',
    idempotencyKey: `refund:${refundRequestId}`,
    attempt: 1,
  });
}

describe('quem pode pedir o reembolso', () => {
  it('sem sessão 401; aluno e Suporte sem grant 403; com o grant mas SEM reautenticação 403 reauth_required', async () => {
    fresh();
    const { orderId } = await paidOrder();
    expect((await request(undefined, orderId)).status).toBe(401);
    const student = await newPerson();
    const plain = await newPerson({ role: 'support', reauth: true });
    expect((await request(student, orderId)).status).toBe(403);
    expect((await request(plain, orderId)).status).toBe(403);
    const noReauth = await newPerson({ role: 'support', grants: ['refund.execute'] });
    const blocked = await request(noReauth, orderId);
    expect(blocked.status).toBe(403);
    expect(await json(blocked)).toEqual({ error: { code: 'reauth_required' } });
    expect(await refundOf(orderId)).toHaveLength(0);
    expect((await orderRow(orderId)).status).toBe('paid');
  });

  it('o corpo é SÓ o motivo: valor, pagamento e pessoa são 400; motivo curto 400; pedido inexistente 404; pedido não pago 409', async () => {
    fresh();
    const { orderId } = await paidOrder();
    const staff = await staffWithGrant();
    for (const body of [
      {},
      { reason: 'cur' },
      { reason: 'Desistência dentro do prazo', amount: 10 },
      { reason: 'Desistência dentro do prazo', amountCents: 100 },
      { reason: 'Desistência dentro do prazo', paymentId: 'pay_1' },
    ]) {
      expect((await request(staff, orderId, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await request(staff, crypto.randomUUID())).status).toBe(404);
    expect((await request(staff, 'nao-uuid')).status).toBe(404);
    await tools.db
      .update(schema.purchaseOrder)
      .set({ status: 'pending' })
      .where(eq(schema.purchaseOrder.id, orderId));
    const pending = await request(staff, orderId);
    expect(pending.status).toBe(409);
    expect((await json(pending)).error.code).toBe('order_not_refundable');
    expect(refunds.calls).toHaveLength(0);
  });
});

describe('pedir o reembolso', () => {
  it('registra o pedido, SUSPENDE o acesso, leva o pedido a refund_requested, audita e grava a intenção só com o id', async () => {
    fresh();
    const { student, orderId } = await paidOrder();
    expect(await hasAccess(student.id)).toBe(true);
    const staff = await staffWithGrant();
    const response = await request(staff, orderId, {
      reason: '  Desistência dentro do prazo de 7 dias  ',
    });
    expect(response.status).toBe(201);
    const [refund] = await refundOf(orderId);
    expect(refund).toMatchObject({
      state: 'requested',
      requestedBy: staff.id,
      reason: 'Desistência dentro do prazo de 7 dias',
    });
    expect((await orderRow(orderId)).status).toBe('refund_requested');
    expect((await enrollmentOf(student.id)).suspendedAt).not.toBeNull();
    expect(await hasAccess(student.id)).toBe(false);

    const [intent] = await tools.db
      .select()
      .from(schema.outboxMessage)
      .where(eq(schema.outboxMessage.dedupeKey, `refund:${refund!.id}`));
    expect(intent).toMatchObject({ kind: 'finance.refund', queue: 'finance' });
    expect(intent!.payload).toEqual({ refundRequestId: refund!.id });
    const [audit] = await tools.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, 'refund.request'), eq(schema.auditLog.targetId, refund!.id)),
      );
    expect(audit).toMatchObject({ actorId: staff.id });
    // nada foi enviado ao provider: quem envia é o executor, depois do commit
    expect(refunds.calls).toHaveLength(0);
  });

  it('dois pedidos simultâneos de dois Suportes: exatamente UM é criado', async () => {
    fresh();
    const { orderId } = await paidOrder();
    const [a, b] = await Promise.all([staffWithGrant(), staffWithGrant()]);
    const results = await Promise.all([request(a, orderId), request(b, orderId)]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    const loser = results.find((response) => response.status === 409)!;
    expect(['refund_already_active', 'order_not_refundable']).toContain(
      (await json(loser)).error.code,
    );
    expect(await refundOf(orderId)).toHaveLength(1);
  });

  it('GET da lista: só com o grant, sem e-mail nem id de pessoa', async () => {
    fresh();
    const { orderId, student } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    expect((await call('GET', '/staff/finance/refunds')).status).toBe(401);
    expect(
      (await call('GET', '/staff/finance/refunds', (await newPerson({ role: 'support' })).headers))
        .status,
    ).toBe(403);
    const list = await json(await call('GET', '/staff/finance/refunds', staff.headers));
    const item = list.refunds.find((entry: any) => entry.orderId === orderId);
    expect(item).toMatchObject({ state: 'requested', priceCents: 19_700 });
    expect(item.buyerName).toContain('Reemb');
    expect(JSON.stringify(item)).not.toContain(student.id);
    expect(JSON.stringify(item)).not.toMatch(/@example\.test/);
  });
});

describe('a janela de 7 dias (dias do calendário de São Paulo)', () => {
  it('o dia 7 vale até a última hora; o dia 8 só o Admin: o Suporte recebe 403 refund_window_closed', async () => {
    fresh();
    const lastMoment = new Date(T0.getTime() + 7 * DAY + 14 * HOUR + 59 * 60_000);
    const dayEight = new Date(T0.getTime() + 7 * DAY + 15 * HOUR);

    const within = await paidOrder();
    const staff = await staffWithGrant();
    clockNow = lastMoment;
    expect((await request(staff, within.orderId)).status).toBe(201);

    const late = await paidOrder();
    clockNow = dayEight;
    const refused = await request(staff, late.orderId);
    expect(refused.status).toBe(403);
    expect((await json(refused)).error.code).toBe('refund_window_closed');
    expect(await refundOf(late.orderId)).toHaveLength(0);
    expect((await orderRow(late.orderId)).status).toBe('paid');
    expect(await hasAccess(late.student.id, T0)).toBe(true);

    const admin = await newPerson({ role: 'admin', reauth: true });
    clockNow = dayEight;
    expect(
      (await request(admin, late.orderId, { reason: 'Exceção autorizada pelo Admin' })).status,
    ).toBe(201);
  });
});

describe('o executor', () => {
  it('fluxo feliz: relê, envia SEM valor, fica submetido; REFUNDED relido revoga o acesso, fecha o pedido e manda UM e-mail', async () => {
    fresh();
    const { student, orderId, pay } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);

    await runExecutor(refund!.id);
    expect(refunds.calls).toEqual([{ paymentId: pay.id, installmentId: null }]);
    expect((await refundOf(orderId))[0]!.state).toBe('submitted');
    expect((await orderRow(orderId)).status).toBe('refund_requested');
    expect(await hasAccess(student.id)).toBe(false);
    expect(await emailsOf(student.id, 'refund-completed')).toHaveLength(0);

    // o Asaas conclui o estorno: o pagamento relido vira REFUNDED
    reader.set({ id: pay.id, status: 'REFUNDED' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: pay.id, eventHint: 'PAYMENT_REFUNDED' },
    );
    const [done] = await refundOf(orderId);
    expect(done).toMatchObject({ state: 'done' });
    expect(done!.completedAt).not.toBeNull();
    expect((await orderRow(orderId)).status).toBe('refunded');
    const [grant] = await tools.db
      .select()
      .from(schema.entitlement)
      .where(
        and(eq(schema.entitlement.userId, student.id), eq(schema.entitlement.source, 'purchase')),
      );
    expect(grant!.revokedReason).toBe('refund');
    expect(await emailsOf(student.id, 'refund-completed')).toHaveLength(1);

    // repetir (at-least-once) não chama o provider nem manda outro e-mail
    await runExecutor(refund!.id);
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: pay.id, eventHint: null },
    );
    expect(refunds.calls).toHaveLength(1);
    expect(await emailsOf(student.id, 'refund-completed')).toHaveLength(1);
  });

  it('o executor repetido (at-least-once) com o pedido já enviado NÃO chama o provider de novo', async () => {
    fresh();
    const { orderId } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    await runExecutor(refund!.id);
    await runExecutor(refund!.id);
    await runExecutor(refund!.id);
    expect(refunds.calls).toHaveLength(1);
  });

  it('recusa conhecida (saldo insuficiente): falha com o CÓDIGO, o acesso e o pedido são RESTAURADOS e dá para tentar de novo', async () => {
    fresh();
    const { student, orderId } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    refunds.next = { kind: 'reject', code: 'insufficient_balance' };
    await runExecutor(refund!.id);
    const [failed] = await refundOf(orderId);
    expect(failed).toMatchObject({ state: 'failed', failureCode: 'insufficient_balance' });
    expect((await orderRow(orderId)).status).toBe('paid');
    expect((await enrollmentOf(student.id)).suspendedAt).toBeNull();
    expect(await hasAccess(student.id)).toBe(true);

    // a Staff tenta de novo depois (novo pedido; o histórico do falho fica)
    refunds.next = { kind: 'ok', status: 'requested' };
    expect((await request(staff, orderId, { reason: 'Saldo do Asaas recomposto' })).status).toBe(
      201,
    );
    const [, retry] = await refundOf(orderId);
    await runExecutor(retry!.id);
    expect((await refundOf(orderId)).map((row) => row.state)).toEqual(['failed', 'submitted']);
    expect(refunds.calls).toHaveLength(2);
  });

  it('resultado AMBÍGUO depois de o Asaas aceitar: fica unknown, NUNCA reenvia; relê, vê o estorno e segue', async () => {
    fresh();
    const { orderId } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    refunds.next = { kind: 'ambiguous', afterAccepting: true };
    await expect(runExecutor(refund!.id)).rejects.toBeInstanceOf(DeferError);
    expect((await refundOf(orderId))[0]!.state).toBe('unknown');
    // a releitura mostra REFUND_REQUESTED (o provider aceitou): vira submetido, sem novo envio
    await runExecutor(refund!.id, new Date(clockNow.getTime() + HOUR));
    expect((await refundOf(orderId))[0]!.state).toBe('submitted');
    expect(refunds.calls).toHaveLength(1);
  });

  it('AMBÍGUO sem sinal do Asaas: adia e NÃO reenvia; passadas 24 h abre revisão uncertain_result para a Staff', async () => {
    fresh();
    const { orderId, pay } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    refunds.next = { kind: 'ambiguous', afterAccepting: false };
    await expect(runExecutor(refund!.id)).rejects.toBeInstanceOf(DeferError);
    for (let i = 1; i <= 3; i += 1) {
      await expect(
        runExecutor(refund!.id, new Date(T0.getTime() + i * HOUR)),
      ).rejects.toBeInstanceOf(DeferError);
    }
    expect(refunds.calls).toHaveLength(1);
    expect((await refundOf(orderId))[0]!.state).toBe('unknown');

    // o relógio do banco (updated_at) é o real: 25 h depois do ÚLTIMO sinal
    await runExecutor(refund!.id, new Date(Date.now() + 25 * HOUR));
    expect(refunds.calls).toHaveLength(1);
    const reviews = await tools.db
      .select()
      .from(schema.financialReview)
      .where(eq(schema.financialReview.orderId, orderId));
    expect(reviews).toMatchObject([
      { type: 'uncertain_result', reason: 'refund_result_unknown', providerPaymentId: pay.id },
    ]);
  });

  it('aguardando aprovação no painel do Asaas: o acesso continua suspenso até o REFUNDED', async () => {
    fresh();
    const { student, orderId, pay } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    refunds.next = { kind: 'ok', status: 'awaiting_authorization' };
    await runExecutor(refund!.id);
    expect((await refundOf(orderId))[0]!.state).toBe('awaiting_external_authorization');
    expect(await hasAccess(student.id)).toBe(false);
    reader.set({ id: pay.id, status: 'REFUNDED' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: pay.id, eventHint: null },
    );
    expect((await refundOf(orderId))[0]!.state).toBe('done');
    expect((await orderRow(orderId)).status).toBe('refunded');
  });

  it('o Asaas já tinha estornado por fora antes do executor: não chama o provider, confirma e conclui', async () => {
    fresh();
    const { student, orderId, pay } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    reader.set({ id: pay.id, status: 'REFUNDED' });
    await runExecutor(refund!.id);
    expect(refunds.calls).toHaveLength(0);
    expect((await refundOf(orderId))[0]!.state).toBe('done');
    expect((await orderRow(orderId)).status).toBe('refunded');
    expect(await hasAccess(student.id)).toBe(false);
  });

  it('pagamento que deixou de ser reembolsável (ex.: chargeback chegou junto): falha, não chama o provider, não devolve o acesso revogado', async () => {
    fresh();
    const { student, orderId, pay } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    reader.set({ id: pay.id, status: 'CHARGEBACK_REQUESTED' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: pay.id, eventHint: null },
    );
    expect((await orderRow(orderId)).status).toBe('disputed');
    await runExecutor(refund!.id);
    expect(refunds.calls).toHaveLength(0);
    expect((await refundOf(orderId))[0]).toMatchObject({
      state: 'failed',
      failureCode: 'payment_not_refundable',
    });
    // o direito foi revogado pelo chargeback: restaurar a matrícula NÃO devolve o acesso
    expect(await hasAccess(student.id)).toBe(false);
    expect((await orderRow(orderId)).status).toBe('disputed');
  });

  it('cartão parcelado: o estorno é pedido pelo PARCELAMENTO, não pela cobrança avulsa', async () => {
    fresh();
    const { orderId } = await paidOrder({ installment: true });
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    await runExecutor(refund!.id);
    expect(refunds.calls).toHaveLength(1);
    expect(refunds.calls[0]!.installmentId).toBe('ins_77');
  });

  it('reembolso feito POR FORA (sem pedido da Staff): revoga e fecha o pedido, mas NÃO manda o e-mail de reembolso', async () => {
    fresh();
    const { student, orderId, pay } = await paidOrder();
    reader.set({ id: pay.id, status: 'REFUNDED' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: pay.id, eventHint: null },
    );
    expect((await orderRow(orderId)).status).toBe('refunded');
    expect(await hasAccess(student.id)).toBe(false);
    expect(await emailsOf(student.id, 'refund-completed')).toHaveLength(0);
  });

  it('sem o Asaas configurado a intenção falha de forma PERMANENTE (nunca chama nada)', async () => {
    const handlers = createHandlers({
      email: {} as never,
      finance: undefined,
    });
    await expect(
      handlers['finance.refund']({
        db: tools.db,
        payload: { refundRequestId: crypto.randomUUID() },
        intentId: crypto.randomUUID(),
        correlationId: 'c',
        idempotencyKey: 'x',
        attempt: 1,
      }),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it('pedido de reembolso inexistente: erro permanente', async () => {
    fresh();
    await expect(runExecutor(crypto.randomUUID())).rejects.toBeInstanceOf(PermanentError);
  });
});

describe('o banco protege o pedido de reembolso', () => {
  it('identidade e motivo imutáveis, concluído é final, não se apaga e só um ativo por pedido', async () => {
    fresh();
    const { orderId, pay } = await paidOrder();
    const staff = await staffWithGrant();
    await request(staff, orderId);
    const [refund] = await refundOf(orderId);
    const violation = async (work: PromiseLike<unknown>, pattern: RegExp) => {
      let caught: unknown;
      try {
        await work;
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      const text = [caught, (caught as { cause?: unknown }).cause]
        .map((item) => (item as Error | undefined)?.message ?? '')
        .join(' | ');
      expect(text).toMatch(pattern);
    };
    await violation(
      tools.db
        .update(schema.refundRequest)
        .set({ reason: 'outro motivo qualquer' })
        .where(eq(schema.refundRequest.id, refund!.id)),
      /refund_request_identity_locked/,
    );
    await violation(
      tools.db.delete(schema.refundRequest).where(eq(schema.refundRequest.id, refund!.id)),
      /refund_request_not_deletable/,
    );
    await violation(
      tools.db.insert(schema.refundRequest).values({
        orderId,
        paymentId: (
          await tools.db
            .select()
            .from(schema.payment)
            .where(eq(schema.payment.providerPaymentId, pay.id))
        )[0]!.id,
        requestedBy: staff.id,
        reason: 'segundo pedido ativo',
      }),
      /refund_request_active_idx|duplicate key/,
    );
    await violation(
      tools.db
        .update(schema.refundRequest)
        .set({ state: 'inventado' })
        .where(eq(schema.refundRequest.id, refund!.id)),
      /refund_request_state_check/,
    );
    await tools.db
      .update(schema.refundRequest)
      .set({ state: 'done', completedAt: new Date() })
      .where(eq(schema.refundRequest.id, refund!.id));
    await violation(
      tools.db
        .update(schema.refundRequest)
        .set({ state: 'failed', completedAt: null })
        .where(eq(schema.refundRequest.id, refund!.id)),
      /refund_request_done_is_final/,
    );
  });
});
