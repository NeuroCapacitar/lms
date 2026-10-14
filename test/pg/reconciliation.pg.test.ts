import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { resolveAccess } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createOffer, setOfferStatus } from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createFakeCheckoutProvider } from '../../src/server/commerce/fake-checkout.ts';
import { createOrder } from '../../src/server/commerce/order-store.ts';
import {
  createFakePaymentReader,
  type FakePaymentReader,
} from '../../src/server/commerce/fake-payments.ts';
import { applyPaymentEvidence } from '../../src/server/commerce/payment-evidence-store.ts';
import { hasReconcileWork, reconcilePending } from '../../src/server/commerce/reconciler.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { evaluateAlerts } from '../../src/features/ops/operations.ts';
import { loadOperationsSnapshot } from '../../src/server/ops/operations-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M6-04 em Postgres 18 real, com o DUBLÊ do Asaas: o reconciliador só consulta pedido pendente com sessão ativa há
 * mais de 10 min (backoff e teto por execução, 429 para o lote sem erro), só expira depois de confirmar que a API não
 * mostra pagamento, nunca expira sessão sem id do provider; e a revisão financeira (grant `finance.review`, motivo e
 * auditoria): só `amount_mismatch` aprova, os demais reconciliam ou são dispensados.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-14T12:00:00.000Z');
const MIN = 60_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let checkoutProvider: ReturnType<typeof createFakeCheckoutProvider>;
let reader: FakePaymentReader;
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

async function fresh() {
  // Isolamento: o que sobrou dos testes anteriores (os pedidos e pagamentos não se apagam) não pode entrar no lote.
  await tools.db
    .update(schema.purchaseOrder)
    .set({ status: 'canceled' })
    .where(eq(schema.purchaseOrder.status, 'pending'));
  await tools.db.update(schema.payment).set({ providerStatus: 'RECEIVED' });
  checkoutProvider = createFakeCheckoutProvider();
  reader = createFakePaymentReader();
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
  });

interface Person {
  id: string;
  headers: Headers;
}
async function newPerson(
  options: { role?: 'support' | 'admin'; grants?: string[] } = {},
): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `recon${seq}@example.test`, name: `Recon ${seq}` });
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
  return { id: user.id as string, headers: (await tools.test.login({ userId: user.id })).headers };
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

/** Abre o Checkout no instante `at` (o relógio da rota) e devolve o pedido e a sessão. */
async function buy(person: Person, at: Date = T0, offerId?: string) {
  clockNow = at;
  const response = await call('POST', '/me/checkout', person.headers, {
    offerId: offerId ?? (await paidOffer()),
    attemptId: crypto.randomUUID(),
  });
  expect(response.status).toBeLessThan(500);
  const orders = await tools.db
    .select()
    .from(schema.purchaseOrder)
    .where(eq(schema.purchaseOrder.userId, person.id));
  const order = orders.at(-1)!;
  const [session] = await tools.db
    .select()
    .from(schema.checkoutSession)
    .where(eq(schema.checkoutSession.orderId, order.id));
  return { orderId: order.id, sessionId: session?.providerSessionId ?? null };
}

let paymentSeq = 0;
const payment = (
  sessionId: string,
  overrides: Parameters<FakePaymentReader['set']>[0] extends infer P ? Partial<P> : never = {},
) => {
  paymentSeq += 1;
  return reader.set({
    id: `pay_r${paymentSeq}_${crypto.randomUUID().slice(0, 6)}`,
    checkoutSessionId: sessionId,
    ...overrides,
  });
};
const reconcile = (at: Date) => {
  clockNow = at;
  return reconcilePending(tools.db, { reader, now: at });
};
const orderRow = async (orderId: string) =>
  (
    await tools.db.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, orderId))
  )[0]!;
const hasAccess = async (userId: string) =>
  (await resolveAccess(tools.db, userId, courseId, clockNow)).hasAccess;
const sessionsOf = (orderId: string) =>
  tools.db.select().from(schema.checkoutSession).where(eq(schema.checkoutSession.orderId, orderId));
const reviewsOf = (orderId: string) =>
  tools.db.select().from(schema.financialReview).where(eq(schema.financialReview.orderId, orderId));
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

describe('reconciliador: quem entra e quando', () => {
  it('pedido recente (menos de 10 min) NÃO é consultado; passados 10 min o pagamento perdido pelo webhook é concedido', async () => {
    await fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    payment(sessionId!, { status: 'RECEIVED' });
    expect(await hasReconcileWork(tools.db, at(5))).toBe(false);
    const early = await reconcile(at(5));
    expect(early.orders).toBe(0);
    expect(reader.reads).toHaveLength(0);

    expect(await hasReconcileWork(tools.db, at(11))).toBe(true);
    const result = await reconcile(at(11));
    expect(result).toMatchObject({ orders: 1, payments: 1, expired: 0, stopped: null });
    expect((await orderRow(orderId)).status).toBe('paid');
    expect(await hasAccess(person.id)).toBe(true);
    // pedido pago não volta a ser consultado
    reader.reads.length = 0;
    await reconcile(at(60));
    expect(reader.reads).toHaveLength(0);
  });

  it('backoff por pedido: 10 min, 20, 40; antes do vencimento o pedido não é consultado de novo', async () => {
    await fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    payment(sessionId!, { status: 'PENDING' });
    await reconcile(at(11));
    expect(reader.reads).toHaveLength(2); // lista da sessão + leitura do pagamento
    let row = await orderRow(orderId);
    expect(row.reconcileAttempts).toBe(1);
    expect(row.reconcileNextAt!.getTime()).toBe(at(11).getTime() + 10 * MIN);

    reader.reads.length = 0;
    await reconcile(at(15));
    expect(reader.reads).toHaveLength(0);
    await reconcile(at(22));
    row = await orderRow(orderId);
    expect(row.reconcileAttempts).toBe(2);
    expect(row.reconcileNextAt!.getTime()).toBe(at(22).getTime() + 20 * MIN);
    await reconcile(at(43));
    row = await orderRow(orderId);
    expect(row.reconcileAttempts).toBe(3);
    expect(row.reconcileNextAt!.getTime()).toBe(at(43).getTime() + 40 * MIN);
  });

  it('teto por execução: 25 pedidos vencidos, só 20 por vez; os outros ficam para a próxima', async () => {
    await fresh();
    const offerId = await paidOffer();
    // 25 pedidos criados direto no domínio (uma pessoa, tentativas diferentes): rápido e sem passar pela rota
    const person = await newPerson();
    for (let i = 0; i < 25; i += 1) {
      const { order } = await createOrder(tools.db, {
        userId: person.id,
        offerId,
        attemptId: crypto.randomUUID(),
        now: T0,
      });
      await tools.db.insert(schema.checkoutSession).values({
        orderId: order.id,
        state: 'open',
        providerSessionId: `chk-cap-${crypto.randomUUID()}`,
        checkoutUrl: 'https://sandbox.asaas.com/x',
        expiresAt: order.expiresAt,
      });
    }
    const first = await reconcile(at(11));
    expect(first.orders).toBe(20);
    const second = await reconcile(at(12));
    expect(second.orders).toBe(5);
    const third = await reconcile(at(13));
    expect(third.orders).toBe(0);
  });

  it('429 do Asaas interrompe o lote SEM erro; falha de infra interrompe com provider_unavailable', async () => {
    await fresh();
    const person = await newPerson();
    await buy(person);
    reader.failNext = 1;
    reader.failReason = 'http_429';
    expect(await reconcile(at(11))).toMatchObject({ stopped: 'rate_limited' });
    reader.failNext = 1;
    reader.failReason = 'http_503';
    expect(await reconcile(at(11))).toMatchObject({ stopped: 'provider_unavailable' });
    // nada mudou: o pedido segue pendente e volta a ser tentado
    const [order] = await tools.db
      .select()
      .from(schema.purchaseOrder)
      .where(eq(schema.purchaseOrder.userId, person.id));
    expect(order!.status).toBe('pending');
    expect(await reconcile(at(12))).toMatchObject({ orders: 1, stopped: null });
  });

  it('pagamento em estado intermediário é relido (e só depois de 1 hora de "calmaria")', async () => {
    await fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId!, { status: 'RECEIVED' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => at(1) },
      { paymentId: pay.id, eventHint: null },
    );
    reader.set({ id: pay.id, status: 'REFUND_REQUESTED' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => at(2) },
      { paymentId: pay.id, eventHint: null },
    );
    expect((await orderRow(orderId)).status).toBe('refund_requested');
    reader.reads.length = 0;
    // dentro da hora: nada
    await reconcile(at(30));
    expect(reader.reads).toHaveLength(0);
    // o Asaas concluiu o estorno por fora; depois de 1 h o reconciliador relê e fecha o pedido
    reader.set({ id: pay.id, status: 'REFUNDED' });
    const real = new Date(Date.now() + 2 * 3_600_000);
    const result = await reconcile(real);
    expect(result.payments).toBeGreaterThanOrEqual(1);
    expect((await orderRow(orderId)).status).toBe('refunded');
    expect(await hasAccess(person.id)).toBe(false);
  });
});

describe('reconciliador: expirar só com prova', () => {
  it('passou dos 60 min e a API NÃO mostra pagamento algum: pedido expired, sessão expired, fato registrado', async () => {
    await fresh();
    const person = await newPerson();
    const { orderId } = await buy(person);
    const result = await reconcile(at(61));
    expect(result).toMatchObject({ orders: 1, expired: 1 });
    expect((await orderRow(orderId)).status).toBe('expired');
    expect((await sessionsOf(orderId)).map((row) => row.state)).toEqual(['expired']);
    const kinds = (
      await tools.db
        .select({ kind: schema.financialEvent.kind })
        .from(schema.financialEvent)
        .where(eq(schema.financialEvent.orderId, orderId))
    ).map((row) => row.kind);
    expect(kinds).toContain('order.expired');
    // e um pagamento que aparece DEPOIS vai para revisão (nunca concede em pedido vencido)
    const late = payment((await sessionsOf(orderId))[0]!.providerSessionId!, {
      status: 'RECEIVED',
    });
    const applied = await applyPaymentEvidence(
      tools.db,
      { reader, now: () => at(70) },
      { paymentId: late.id, eventHint: null },
    );
    expect(applied).toMatchObject({ outcome: 'review', reviewType: 'terminal_conflict' });
    expect(await hasAccess(person.id)).toBe(false);
  });

  it('pagamento PENDING ainda existe: o pedido NÃO expira (a API mostra pagamento da sessão)', async () => {
    await fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    payment(sessionId!, { status: 'PENDING' });
    const result = await reconcile(at(61));
    expect(result.expired).toBe(0);
    expect((await orderRow(orderId)).status).toBe('pending');
  });

  it('pagamento só OVERDUE (nada a esperar): expira', async () => {
    await fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    payment(sessionId!, { status: 'OVERDUE' });
    expect((await reconcile(at(61))).expired).toBe(1);
    expect((await orderRow(orderId)).status).toBe('expired');
  });

  it('sessão SEM id do provider (resultado incerto): nunca expira sozinha, vira revisão uncertain_result e o pedido vai a review', async () => {
    await fresh();
    checkoutProvider.next = 'ambiguous';
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    expect(sessionId).toBeNull();
    const result = await reconcile(at(61));
    expect(result).toMatchObject({ uncertain: 1, expired: 0 });
    expect((await orderRow(orderId)).status).toBe('review');
    expect(await reviewsOf(orderId)).toMatchObject([
      { type: 'uncertain_result', reason: 'session_without_provider_id', state: 'open' },
    ]);
    // repetir não duplica
    await reconcile(at(120));
    expect(await reviewsOf(orderId)).toHaveLength(1);
  });
});

describe('alertas financeiros no snapshot do Operations Center', () => {
  it('pedido pendente há mais de 2 h e revisão aberta aparecem como P1 e P2', async () => {
    await fresh();
    const person = await newPerson();
    // pedido criado há 3 horas (o relógio do pedido é o da criação)
    await buy(person, new Date(Date.now() - 3 * 3_600_000));
    const snapshot = await loadOperationsSnapshot(tools.db);
    expect(snapshot.finance.pendingOver2Hours).toBeGreaterThanOrEqual(1);
    const codes = evaluateAlerts(snapshot).map((alert) => `${alert.severity}:${alert.code}`);
    expect(codes).toContain('P1:finance_orders_stuck');
    expect(codes).toContain('P3:webhook_silent:asaas');
  });
});

describe('revisão financeira (Staff com finance.review)', () => {
  async function mismatch() {
    const person = await newPerson();
    const bought = await buy(person);
    const pay = payment(bought.sessionId!, {
      status: 'RECEIVED',
      valueCents: 19_699,
      totalCents: 19_699,
    });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: pay.id, eventHint: null },
    );
    const [review] = await reviewsOf(bought.orderId);
    return { person, pay, review: review!, ...bought };
  }
  const resolve = (who: Person | undefined, id: string, body: unknown) =>
    call('POST', `/staff/finance/reviews/${id}/resolve`, who?.headers, body);

  it('quem pode: sem sessão 401, aluno 403, Suporte SEM grant 403; Suporte com finance.review e Admin passam', async () => {
    await fresh();
    const { review } = await mismatch();
    const student = await newPerson();
    const plain = await newPerson({ role: 'support' });
    const grantee = await newPerson({ role: 'support', grants: ['finance.review'] });
    const admin = await newPerson({ role: 'admin' });
    expect((await call('GET', '/staff/finance/reviews')).status).toBe(401);
    for (const who of [student, plain]) {
      expect((await call('GET', '/staff/finance/reviews', who.headers)).status).toBe(403);
      expect(
        (await resolve(who, review.id, { action: 'reconcile', reason: 'conferir agora' })).status,
      ).toBe(403);
    }
    for (const who of [grantee, admin]) {
      expect((await call('GET', '/staff/finance/reviews', who.headers)).status).toBe(200);
    }
  });

  it('a lista traz o necessário para decidir e NADA de e-mail, CPF ou id do usuário', async () => {
    await fresh();
    const { person, review, orderId } = await mismatch();
    const admin = await newPerson({ role: 'admin' });
    const list = await json(await call('GET', '/staff/finance/reviews', admin.headers));
    const item = list.reviews.find((entry: any) => entry.id === review.id);
    expect(item).toMatchObject({
      type: 'amount_mismatch',
      state: 'open',
      orderId,
      orderStatus: 'review',
      priceCents: 19_700,
      observedCents: 19_699,
      expectedCents: 19_700,
    });
    expect(item.buyerName).toContain('Recon');
    const text = JSON.stringify(item);
    expect(text).not.toContain(person.id);
    expect(text).not.toMatch(/@example\.test/);
    expect(Object.keys(item)).not.toContain('payerDocument');
  });

  it('APROVAR valor divergente: exige motivo; concede, resolve, audita e envia UM e-mail; repetir é 409', async () => {
    await fresh();
    const { person, review, orderId } = await mismatch();
    const staff = await newPerson({ role: 'support', grants: ['finance.review'] });
    expect((await resolve(staff, review.id, { action: 'approve' })).status).toBe(400);
    expect((await resolve(staff, review.id, { action: 'approve', reason: 'ok' })).status).toBe(400);
    expect(
      (
        await resolve(staff, review.id, {
          action: 'approve',
          reason: 'desconto autorizado',
          extra: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await resolve(staff, review.id, { action: 'apagar', reason: 'desconto autorizado' })).status,
    ).toBe(400);
    expect(await hasAccess(person.id)).toBe(false);

    const response = await resolve(staff, review.id, {
      action: 'approve',
      reason: 'Desconto de R$ 0,01 autorizado pela Staff',
    });
    expect(response.status).toBe(200);
    expect((await orderRow(orderId)).status).toBe('paid');
    expect(await hasAccess(person.id)).toBe(true);
    const [after] = await reviewsOf(orderId);
    expect(after).toMatchObject({ state: 'resolved', resolvedBy: staff.id });
    expect(after!.resolution).toContain('approved');
    const [audit] = await tools.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'finance.review.resolve'),
          eq(schema.auditLog.targetId, review.id),
        ),
      );
    expect(audit).toMatchObject({ actorId: staff.id });
    expect(JSON.stringify(audit!.details)).toContain('Desconto');
    expect(
      await tools.db
        .select()
        .from(schema.emailMessage)
        .where(
          and(
            eq(schema.emailMessage.recipientUserId, person.id),
            eq(schema.emailMessage.template, 'purchase-confirmed'),
          ),
        ),
    ).toHaveLength(1);
    const again = await resolve(staff, review.id, {
      action: 'approve',
      reason: 'repetindo a aprovação',
    });
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe('already_resolved');
  });

  it('APROVAR só vale para amount_mismatch; valor que mudou no provider ou outra revisão aberta no pedido recusam', async () => {
    await fresh();
    const staff = await newPerson({ role: 'support', grants: ['finance.review'] });
    // tipo errado: status desconhecido
    const person = await newPerson();
    const bought = await buy(person);
    const odd = payment(bought.sessionId!, { status: 'ALGO_NOVO' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: odd.id, eventHint: null },
    );
    const [anomaly] = await reviewsOf(bought.orderId);
    const wrong = await resolve(staff, anomaly!.id, {
      action: 'approve',
      reason: 'tentando aprovar',
    });
    expect(wrong.status).toBe(409);
    expect((await json(wrong)).error.code).toBe('action_not_allowed');
    expect(await hasAccess(person.id)).toBe(false);

    // valor mudou depois da revisão
    const { review, pay } = await mismatch();
    reader.set({ id: pay.id, valueCents: 19_700, totalCents: 19_700 });
    const stale = await resolve(staff, review.id, { action: 'approve', reason: 'aprovando velho' });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.code).toBe('stale');

    // outra revisão aberta no mesmo pedido
    const second = await mismatch();
    await tools.db.insert(schema.financialReview).values({
      orderId: second.orderId,
      providerPaymentId: 'pay_outra',
      type: 'event_anomaly',
      reason: 'teste',
    });
    const blocked = await resolve(staff, second.review.id, {
      action: 'approve',
      reason: 'com outra aberta',
    });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error.code).toBe('other_open_reviews');
    expect(await hasAccess(second.person.id)).toBe(false);
  });

  it('RECONCILIAR: o provider passou a mostrar a verdade; a revisão fecha e o pedido segue (concede se RECEBIDO)', async () => {
    await fresh();
    const staff = await newPerson({ role: 'support', grants: ['finance.review'] });
    const person = await newPerson();
    const bought = await buy(person);
    const odd = payment(bought.sessionId!, { status: 'ALGO_NOVO' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: odd.id, eventHint: null },
    );
    const [review] = await reviewsOf(bought.orderId);
    expect((await orderRow(bought.orderId)).status).toBe('review');

    // ainda divergente: 409 e NADA muda
    const still = await resolve(staff, review!.id, {
      action: 'reconcile',
      reason: 'conferindo de novo',
    });
    expect(still.status).toBe(409);
    expect((await json(still)).error.code).toBe('still_divergent');
    expect((await reviewsOf(bought.orderId))[0]!.state).toBe('open');
    expect((await orderRow(bought.orderId)).status).toBe('review');

    // o Asaas corrige o estado: reconciliar concede e fecha
    reader.set({ id: odd.id, status: 'RECEIVED' });
    const done = await resolve(staff, review!.id, {
      action: 'reconcile',
      reason: 'Asaas corrigiu o status',
    });
    expect(done.status).toBe(200);
    expect((await orderRow(bought.orderId)).status).toBe('paid');
    expect(await hasAccess(person.id)).toBe(true);
    expect((await reviewsOf(bought.orderId))[0]).toMatchObject({ state: 'resolved' });
  });

  it('DISPENSAR: só unknown_checkout, event_anomaly e uncertain_result; devolve o pedido ao estado anterior; amount_mismatch não', async () => {
    await fresh();
    const staff = await newPerson({ role: 'support', grants: ['finance.review'] });
    // unknown_checkout (sem pedido)
    const orphan = reader.set({
      id: `pay_orfao_${crypto.randomUUID().slice(0, 6)}`,
      status: 'RECEIVED',
      checkoutSessionId: 'chk-do-nada',
    });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: orphan.id, eventHint: null },
    );
    const [unknown] = await tools.db
      .select()
      .from(schema.financialReview)
      .where(eq(schema.financialReview.providerPaymentId, orphan.id));
    expect(
      (
        await resolve(staff, unknown!.id, {
          action: 'dismiss',
          reason: 'cobrança de teste da conta',
        })
      ).status,
    ).toBe(200);

    // event_anomaly com pedido: volta a pending
    const person = await newPerson();
    const bought = await buy(person);
    const boleto = payment(bought.sessionId!, { billingType: 'BOLETO', status: 'RECEIVED' });
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => clockNow },
      { paymentId: boleto.id, eventHint: null },
    );
    const [anomaly] = await reviewsOf(bought.orderId);
    expect((await orderRow(bought.orderId)).status).toBe('review');
    expect(
      (await resolve(staff, anomaly!.id, { action: 'dismiss', reason: 'boleto de outro sistema' }))
        .status,
    ).toBe(200);
    expect((await orderRow(bought.orderId)).status).toBe('pending');
    expect(await hasAccess(person.id)).toBe(false);

    // amount_mismatch: não dispensa
    const { review } = await mismatch();
    const refused = await resolve(staff, review.id, {
      action: 'dismiss',
      reason: 'ignorar o valor',
    });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.code).toBe('action_not_allowed');
  });

  it('uncertain_result dispensado: a Staff conferiu que não há pagamento, o pedido é cancelado', async () => {
    await fresh();
    const staff = await newPerson({ role: 'support', grants: ['finance.review'] });
    checkoutProvider.next = 'ambiguous';
    const person = await newPerson();
    const { orderId } = await buy(person);
    await reconcile(at(61));
    const [review] = await reviewsOf(orderId);
    expect(review!.type).toBe('uncertain_result');
    // reconciliar não se aplica (não há id de pagamento)
    const notReconcilable = await resolve(staff, review!.id, {
      action: 'reconcile',
      reason: 'tentando reler',
    });
    expect(notReconcilable.status).toBe(409);
    expect((await json(notReconcilable)).error.code).toBe('not_reconcilable');
    expect(
      (
        await resolve(staff, review!.id, {
          action: 'dismiss',
          reason: 'conferi no painel: sem cobrança',
        })
      ).status,
    ).toBe(200);
    expect((await orderRow(orderId)).status).toBe('canceled');
    expect((await sessionsOf(orderId)).map((row) => row.state)).toEqual(['expired']);
  });

  it('revisão inexistente 404; falha do Asaas ao reconciliar 503 sem mudar nada', async () => {
    await fresh();
    const staff = await newPerson({ role: 'support', grants: ['finance.review'] });
    expect(
      (await resolve(staff, crypto.randomUUID(), { action: 'dismiss', reason: 'não existe isso' }))
        .status,
    ).toBe(404);
    expect(
      (await resolve(staff, 'nao-uuid', { action: 'dismiss', reason: 'não existe isso' })).status,
    ).toBe(404);
    const { review } = await mismatch();
    reader.failNext = 1;
    const down = await resolve(staff, review.id, {
      action: 'reconcile',
      reason: 'tentando com o Asaas fora',
    });
    expect(down.status).toBe(503);
    expect((await reviewsOf(review.orderId!))[0]!.state).toBe('open');
  });
});
