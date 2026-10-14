import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { resolveAccess } from '../../src/server/access/entitlement-store.ts';
import { PermanentError, TransientError } from '../../src/server/async/handler-types.ts';
import { createOffer, setOfferStatus } from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createAsaasEventHandler } from '../../src/server/commerce/asaas-events.ts';
import { createFakeCheckoutProvider } from '../../src/server/commerce/fake-checkout.ts';
import {
  createFakePaymentReader,
  type FakePaymentReader,
} from '../../src/server/commerce/fake-payments.ts';
import { applyPaymentEvidence } from '../../src/server/commerce/payment-evidence-store.ts';
import { PaymentReadPermanentError } from '../../src/server/commerce/payment-reader.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M6-07 em Postgres 18 real, com o DUBLÊ do Asaas (o sandbox real não foi exercitado, ver STATUS): só evidência
 * segura de Payment concede acesso. Cobre a matriz (Pix só em RECEIVED, cartão em CONFIRMED), `CHECKOUT_PAID` que
 * nunca libera, valor com tolerância zero, correlação pela sessão, eventos repetidos e fora de ordem, corrida entre
 * webhook, retorno e reconciliador (UM direito, UM e-mail), reembolso, chargeback e a página de retorno.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-14T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let checkoutProvider: ReturnType<typeof createFakeCheckoutProvider>;
let reader: FakePaymentReader;
let courseId: string;
let clockNow = T0;
let withReader = true;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  const seeded = await seedDemoCourse(tools.db);
  courseId = seeded.courseId;
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});

function fresh() {
  checkoutProvider = createFakeCheckoutProvider();
  reader = createFakePaymentReader();
  withReader = true;
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
    ...(withReader ? { paymentReader: reader } : {}),
  });

interface Person {
  id: string;
  headers: Headers;
}
async function newPerson(): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `pagto${seq}@example.test`, name: `Pagto ${seq}` });
  await tools.test.saveUser(user);
  await tools.db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, user.id));
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

async function paidOffer(priceCents = 19_700, maxInstallments = 12) {
  seq += 1;
  const offerId = await createOffer(tools.db, {
    actorId: null,
    courseId,
    name: `Oferta ${seq}`,
    kind: 'paid',
    priceCents,
    accessMonths: 12,
    maxInstallments,
  });
  await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'active' });
  return offerId;
}

/** Abre o Checkout (dublê) e devolve o pedido e o id da sessão no provider. */
async function buy(person: Person, offerId?: string) {
  const offer = offerId ?? (await paidOffer());
  const response = await call('POST', '/me/checkout', person.headers, {
    offerId: offer,
    attemptId: crypto.randomUUID(),
  });
  expect(response.status).toBe(200);
  const { orderId } = await json(response);
  const [session] = await tools.db
    .select()
    .from(schema.checkoutSession)
    .where(eq(schema.checkoutSession.orderId, orderId));
  return { orderId: orderId as string, sessionId: session!.providerSessionId!, offerId: offer };
}

let paymentSeq = 0;
function payment(
  sessionId: string,
  overrides: Partial<Parameters<FakePaymentReader['set']>[0]> = {},
) {
  paymentSeq += 1;
  return reader.set({
    id: `pay_${paymentSeq}_${crypto.randomUUID().slice(0, 8)}`,
    checkoutSessionId: sessionId,
    ...overrides,
  });
}
const apply = (paymentId: string, hint: string | null = null, db = tools.db) =>
  applyPaymentEvidence(db, { reader, now: () => clockNow }, { paymentId, eventHint: hint });

const orderRow = async (orderId: string) =>
  (
    await tools.db.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, orderId))
  )[0]!;
const grantsOf = (userId: string) =>
  tools.db
    .select()
    .from(schema.entitlement)
    .where(and(eq(schema.entitlement.userId, userId), eq(schema.entitlement.source, 'purchase')));
const emailsOf = (userId: string) =>
  tools.db
    .select()
    .from(schema.emailMessage)
    .where(
      and(
        eq(schema.emailMessage.recipientUserId, userId),
        eq(schema.emailMessage.template, 'purchase-confirmed'),
      ),
    );
const reviewsOf = (orderId: string) =>
  tools.db.select().from(schema.financialReview).where(eq(schema.financialReview.orderId, orderId));
const hasAccess = async (userId: string) =>
  (await resolveAccess(tools.db, userId, courseId, clockNow)).hasAccess;
const factKinds = async (orderId: string) =>
  (
    await tools.db
      .select({ kind: schema.financialEvent.kind })
      .from(schema.financialEvent)
      .where(eq(schema.financialEvent.orderId, orderId))
  )
    .map((row) => row.kind)
    .sort();

describe('liberação por evidência segura', () => {
  it('Pix em RECEIVED: acesso por 12 meses, pedido pago, sessão concluída, UM e-mail e a trilha de fatos', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'RECEIVED', paidAt: T0 });
    expect(await hasAccess(person.id)).toBe(false);

    const result = await apply(pay.id, 'PAYMENT_RECEIVED');
    expect(result).toMatchObject({ outcome: 'granted', orderId });
    expect(await hasAccess(person.id)).toBe(true);

    const [grant] = await grantsOf(person.id);
    expect(grant).toMatchObject({
      sourceRef: `order:${orderId}`,
      courseId,
      revokedAt: null,
    });
    expect(grant!.expiresAt.toISOString()).toBe('2027-10-14T12:00:00.000Z');
    expect((await orderRow(orderId)).status).toBe('paid');
    const [session] = await tools.db
      .select()
      .from(schema.checkoutSession)
      .where(eq(schema.checkoutSession.orderId, orderId));
    expect(session!.state).toBe('completed');
    const [local] = await tools.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.providerPaymentId, pay.id));
    expect(local).toMatchObject({
      orderId,
      method: 'pix',
      amountCents: 19_700,
      providerStatus: 'RECEIVED',
    });
    expect(await emailsOf(person.id)).toHaveLength(1);
    expect(await factKinds(orderId)).toEqual([
      'access.granted',
      'checkout.opened',
      'order.created',
      'order.paid',
      'payment.status',
    ]);
  });

  it('cartão: PENDING e análise de risco NÃO liberam; CONFIRMED libera (e a aprovação posterior destrava)', async () => {
    fresh();
    const person = await newPerson();
    const { sessionId } = await buy(person);
    const pay = payment(sessionId, { billingType: 'CREDIT_CARD', status: 'PENDING' });
    expect((await apply(pay.id)).outcome).toBe('waiting');
    reader.set({ id: pay.id, status: 'AWAITING_RISK_ANALYSIS' });
    expect((await apply(pay.id)).outcome).toBe('waiting');
    expect(await hasAccess(person.id)).toBe(false);
    reader.set({ id: pay.id, status: 'CONFIRMED' });
    expect((await apply(pay.id)).outcome).toBe('granted');
    expect(await hasAccess(person.id)).toBe(true);
    // RECEIVED depois (32 dias) não concede de novo
    reader.set({ id: pay.id, status: 'RECEIVED' });
    expect((await apply(pay.id)).outcome).toBe('already_granted');
    expect(await grantsOf(person.id)).toHaveLength(1);
  });

  it('Pix em CONFIRMED ou PENDING não libera; só RECEIVED libera', async () => {
    fresh();
    const person = await newPerson();
    const { sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'PENDING' });
    expect((await apply(pay.id)).outcome).toBe('waiting');
    reader.set({ id: pay.id, status: 'CONFIRMED' });
    expect((await apply(pay.id)).outcome).toBe('waiting');
    expect(await hasAccess(person.id)).toBe(false);
    reader.set({ id: pay.id, status: 'RECEIVED' });
    expect((await apply(pay.id)).outcome).toBe('granted');
  });

  it('cartão parcelado: o que conta é o TOTAL do parcelamento; várias parcelas confirmadas concedem UMA vez', async () => {
    fresh();
    const person = await newPerson();
    const { sessionId } = await buy(person);
    const first = payment(sessionId, {
      billingType: 'CREDIT_CARD',
      status: 'CONFIRMED',
      valueCents: 1642,
      totalCents: 19_700,
      installmentId: 'ins_1',
    });
    const second = payment(sessionId, {
      billingType: 'CREDIT_CARD',
      status: 'CONFIRMED',
      valueCents: 1642,
      totalCents: 19_700,
      installmentId: 'ins_1',
    });
    expect((await apply(first.id)).outcome).toBe('granted');
    expect((await apply(second.id)).outcome).toBe('already_granted');
    expect(await grantsOf(person.id)).toHaveLength(1);
    expect(await emailsOf(person.id)).toHaveLength(1);
  });
});

describe('o que NUNCA libera', () => {
  it('valor diferente (um centavo): revisão amount_mismatch, pedido em revisão, nenhum acesso nem e-mail', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'RECEIVED', valueCents: 19_699, totalCents: 19_699 });
    const result = await apply(pay.id);
    expect(result).toMatchObject({ outcome: 'review', reviewType: 'amount_mismatch' });
    expect(await hasAccess(person.id)).toBe(false);
    expect(await grantsOf(person.id)).toHaveLength(0);
    expect(await emailsOf(person.id)).toHaveLength(0);
    expect((await orderRow(orderId)).status).toBe('review');
    expect(await reviewsOf(orderId)).toMatchObject([{ type: 'amount_mismatch', state: 'open' }]);
    // repetir não abre a revisão de novo
    await apply(pay.id);
    expect(await reviewsOf(orderId)).toHaveLength(1);
  });

  it('o preço da Offer mudar DEPOIS da compra não afeta: vale o snapshot', async () => {
    fresh();
    const person = await newPerson();
    const offerId = await paidOffer(19_700);
    const { orderId, sessionId } = await buy(person, offerId);
    await tools.db
      .update(schema.offer)
      .set({ priceCents: 29_700 })
      .where(eq(schema.offer.id, offerId));
    const pay = payment(sessionId, { status: 'RECEIVED' });
    expect((await apply(pay.id)).outcome).toBe('granted');
    expect((await orderRow(orderId)).status).toBe('paid');
  });

  it('CHECKOUT_PAID sozinho (sem pagamento no corpo) nunca libera: só dispara a consulta da sessão', async () => {
    fresh();
    const person = await newPerson();
    const { sessionId } = await buy(person);
    const handler = createAsaasEventHandler({ reader, now: () => clockNow });
    const run = (payload: Record<string, unknown>) =>
      handler({
        db: tools.db,
        eventId: crypto.randomUUID(),
        provider: 'asaas',
        payload,
        correlationId: 'c',
        attempt: 1,
      });
    const checkoutPaid = { event: 'CHECKOUT_PAID', paymentId: null, checkoutSessionId: sessionId };
    // o Asaas ainda não mostra pagamento algum: tenta de novo, nada é concedido
    await expect(run(checkoutPaid)).rejects.toBeInstanceOf(TransientError);
    // o pagamento aparece, mas PENDING: continua sem liberar
    const pay = payment(sessionId, { status: 'PENDING' });
    await run(checkoutPaid);
    expect(await hasAccess(person.id)).toBe(false);
    // só quando a API mostra RECEIVED é que libera
    reader.set({ id: pay.id, status: 'RECEIVED' });
    await run(checkoutPaid);
    expect(await hasAccess(person.id)).toBe(true);
  });

  it('webhook que MENTE (evento de recebido, API diz PENDING): nada é liberado', async () => {
    fresh();
    const person = await newPerson();
    const { sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'PENDING' });
    expect((await apply(pay.id, 'PAYMENT_RECEIVED')).outcome).toBe('waiting');
    expect(await hasAccess(person.id)).toBe(false);
  });

  it('sessão de checkout desconhecida ou pagamento sem sessão: revisão unknown_checkout, nada concedido', async () => {
    fresh();
    const person = await newPerson();
    await buy(person);
    const stranger = payment('chk-que-o-hub-nunca-criou', { status: 'RECEIVED' });
    expect(await apply(stranger.id)).toMatchObject({
      outcome: 'review',
      reviewType: 'unknown_checkout',
      orderId: null,
    });
    const orphan = reader.set({
      id: 'pay_sem_sessao',
      status: 'RECEIVED',
      checkoutSessionId: null,
    });
    expect(await apply(orphan.id)).toMatchObject({
      outcome: 'review',
      reviewType: 'unknown_checkout',
    });
    expect(await grantsOf(person.id)).toHaveLength(0);
  });

  it('externalReference de OUTRO pedido: revisão event_anomaly (identificadores conflitantes)', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'RECEIVED', externalReference: crypto.randomUUID() });
    expect(await apply(pay.id)).toMatchObject({ outcome: 'review', reviewType: 'event_anomaly' });
    expect(await grantsOf(person.id)).toHaveLength(0);
    expect((await orderRow(orderId)).status).toBe('review');
  });

  it('forma de pagamento fora de Pix e cartão (boleto) e status desconhecido: revisão', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const boleto = payment(sessionId, { billingType: 'BOLETO', status: 'RECEIVED' });
    expect(await apply(boleto.id)).toMatchObject({
      outcome: 'review',
      reviewType: 'event_anomaly',
    });
    expect(await grantsOf(person.id)).toHaveLength(0);
    // outro pedido para o status desconhecido
    const second = await buy(person);
    const odd = payment(second.sessionId, { status: 'ALGO_NOVO' });
    expect(await apply(odd.id)).toMatchObject({ outcome: 'review', reviewType: 'event_anomaly' });
    expect(await hasAccess(person.id)).toBe(false);
    expect(orderId).not.toBe(second.orderId);
  });

  it('pedido VENCIDO que recebe pagamento: revisão terminal_conflict, sem acesso', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    await tools.db
      .update(schema.purchaseOrder)
      .set({ status: 'expired' })
      .where(eq(schema.purchaseOrder.id, orderId));
    const pay = payment(sessionId, { status: 'RECEIVED' });
    expect(await apply(pay.id)).toMatchObject({
      outcome: 'review',
      reviewType: 'terminal_conflict',
    });
    expect(await hasAccess(person.id)).toBe(false);
  });

  it('pagamento já ligado a OUTRO pedido do Hub: revisão, sem acesso', async () => {
    fresh();
    const person = await newPerson();
    const a = await buy(person);
    const b = await buy(person);
    const pay = payment(a.sessionId, { status: 'PENDING' });
    await apply(pay.id);
    // o Asaas passa a dizer que o MESMO pagamento é da sessão B
    reader.set({ id: pay.id, checkoutSessionId: b.sessionId, status: 'RECEIVED' });
    expect(await apply(pay.id)).toMatchObject({ outcome: 'review', reviewType: 'event_anomaly' });
    expect(await grantsOf(person.id)).toHaveLength(0);
  });
});

describe('eventos repetidos, fora de ordem e em corrida', () => {
  it('o mesmo evento 5 vezes: UM direito, UM e-mail, UM fato de concessão', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'RECEIVED' });
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i += 1) outcomes.push((await apply(pay.id, 'PAYMENT_RECEIVED')).outcome);
    expect(outcomes).toEqual([
      'granted',
      'already_granted',
      'already_granted',
      'already_granted',
      'already_granted',
    ]);
    expect(await grantsOf(person.id)).toHaveLength(1);
    expect(await emailsOf(person.id)).toHaveLength(1);
    expect((await factKinds(orderId)).filter((kind) => kind === 'access.granted')).toHaveLength(1);
  });

  it('evento atrasado (PENDING depois de RECEIVED): regressão ignorada e registrada; o acesso fica', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'RECEIVED' });
    await apply(pay.id);
    reader.set({ id: pay.id, status: 'PENDING' });
    expect((await apply(pay.id)).outcome).toBe('regression_ignored');
    expect(await hasAccess(person.id)).toBe(true);
    const [local] = await tools.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.providerPaymentId, pay.id));
    expect(local!.providerStatus).toBe('RECEIVED');
    expect(await factKinds(orderId)).toContain('payment.regression_ignored');
  });

  it('webhook × retorno × reconciliador SIMULTÂNEOS (conexões separadas): exatamente UM direito e UM e-mail', async () => {
    fresh();
    reader.delayMs = 150;
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'RECEIVED' });
    const connections = await Promise.all(
      [1, 2, 3, 4, 5].map(() => openDatabase(database.connectionString)),
    );
    const results = await Promise.all(
      connections.map((connection, index) =>
        apply(pay.id, index % 2 === 0 ? 'PAYMENT_RECEIVED' : null, connection.db),
      ),
    );
    await Promise.all(connections.map((connection) => connection.close()));
    expect(results.filter((item) => item.outcome === 'granted')).toHaveLength(1);
    expect(results.filter((item) => item.outcome === 'already_granted')).toHaveLength(4);
    expect(await grantsOf(person.id)).toHaveLength(1);
    expect(await emailsOf(person.id)).toHaveLength(1);
    expect((await orderRow(orderId)).status).toBe('paid');
  });

  it('duas compras do mesmo curso pagas em corrida: só a primeira concede; a segunda vai a revisão duplicate_purchase', async () => {
    fresh();
    const person = await newPerson();
    const first = await buy(person);
    const second = await buy(person);
    const payFirst = payment(first.sessionId, { status: 'RECEIVED' });
    const paySecond = payment(second.sessionId, { status: 'RECEIVED' });
    const [a, b] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    const results = await Promise.all([
      apply(payFirst.id, null, a.db),
      apply(paySecond.id, null, b.db),
    ]);
    await Promise.all([a.close(), b.close()]);
    expect(results.map((item) => item.outcome).sort()).toEqual(['granted', 'review']);
    expect(await grantsOf(person.id)).toHaveLength(1);
    const loser = results.find((item) => item.outcome === 'review')!;
    expect(loser.reviewType).toBe('duplicate_purchase');
    expect((await orderRow(loser.orderId!)).status).toBe('review');
  });
});

describe('reembolso, disputa e chargeback', () => {
  async function paid() {
    const person = await newPerson();
    const bought = await buy(person);
    const pay = payment(bought.sessionId, { status: 'RECEIVED' });
    await apply(pay.id);
    expect(await hasAccess(person.id)).toBe(true);
    return { person, ...bought, pay };
  }

  it('REFUND_REQUESTED não revoga ainda (a Staff suspende ao pedir); REFUNDED revoga e fecha o pedido', async () => {
    fresh();
    const { person, orderId, pay } = await paid();
    reader.set({ id: pay.id, status: 'REFUND_REQUESTED' });
    expect((await apply(pay.id)).outcome).toBe('refund_started');
    expect((await orderRow(orderId)).status).toBe('refund_requested');
    expect(await hasAccess(person.id)).toBe(true);
    reader.set({ id: pay.id, status: 'REFUNDED' });
    expect((await apply(pay.id)).outcome).toBe('refunded');
    expect((await orderRow(orderId)).status).toBe('refunded');
    expect(await hasAccess(person.id)).toBe(false);
    const [grant] = await grantsOf(person.id);
    expect(grant!.revokedReason).toBe('refund');
    // repetir não muda nada; refunded é final
    expect((await apply(pay.id)).outcome).toBe('refunded');
    expect((await orderRow(orderId)).status).toBe('refunded');
  });

  it('REFUNDED direto (sem passar por REQUESTED, feito no painel do Asaas): revoga e fecha', async () => {
    fresh();
    const { person, orderId, pay } = await paid();
    reader.set({ id: pay.id, status: 'REFUNDED' });
    expect((await apply(pay.id)).outcome).toBe('refunded');
    expect((await orderRow(orderId)).status).toBe('refunded');
    expect(await hasAccess(person.id)).toBe(false);
  });

  it('chargeback REVOGA e leva o pedido a disputed; revogar vale mesmo com uma revisão aberta', async () => {
    fresh();
    const { person, orderId, pay } = await paid();
    await tools.db.insert(schema.financialReview).values({
      orderId,
      providerPaymentId: pay.id,
      type: 'event_anomaly',
      reason: 'teste',
    });
    reader.set({ id: pay.id, status: 'CHARGEBACK_REQUESTED' });
    expect((await apply(pay.id)).outcome).toBe('chargeback');
    expect((await orderRow(orderId)).status).toBe('disputed');
    expect(await hasAccess(person.id)).toBe(false);
    expect((await grantsOf(person.id))[0]!.revokedReason).toBe('chargeback');
  });

  it('reembolso parcial feito por fora (dica do evento): revisão partial_refund, o acesso NÃO muda', async () => {
    fresh();
    const { person, orderId, pay } = await paid();
    expect(await apply(pay.id, 'PAYMENT_PARTIALLY_REFUNDED')).toMatchObject({
      outcome: 'review',
      reviewType: 'partial_refund',
    });
    expect(await hasAccess(person.id)).toBe(true);
    expect((await reviewsOf(orderId)).map((row) => row.type)).toEqual(['partial_refund']);
  });

  it('reembolso/chargeback de pedido que nunca foi pago aqui: revisão, sem mexer em acesso', async () => {
    fresh();
    const person = await newPerson();
    const { orderId, sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'REFUNDED' });
    expect(await apply(pay.id)).toMatchObject({
      outcome: 'review',
      reviewType: 'terminal_conflict',
    });
    expect((await orderRow(orderId)).status).toBe('review');
    const second = await buy(person);
    const dispute = payment(second.sessionId, { status: 'CHARGEBACK_DISPUTE' });
    expect(await apply(dispute.id)).toMatchObject({
      outcome: 'review',
      reviewType: 'terminal_conflict',
    });
  });
});

describe('o handler da inbox', () => {
  it('falha infra do Asaas = transitória (volta com atraso); recusa definitiva = permanente; pagamento ausente = transitória', async () => {
    fresh();
    const person = await newPerson();
    const { sessionId } = await buy(person);
    const pay = payment(sessionId, { status: 'RECEIVED' });
    const handler = createAsaasEventHandler({ reader, now: () => clockNow });
    const run = (payload: Record<string, unknown>) =>
      handler({
        db: tools.db,
        eventId: crypto.randomUUID(),
        provider: 'asaas',
        payload,
        correlationId: 'c',
        attempt: 1,
      });
    reader.failNext = 1;
    await expect(
      run({ event: 'PAYMENT_RECEIVED', paymentId: pay.id, checkoutSessionId: null }),
    ).rejects.toBeInstanceOf(TransientError);
    expect(await hasAccess(person.id)).toBe(false);
    await expect(
      run({ event: 'PAYMENT_RECEIVED', paymentId: 'pay_que_nao_existe', checkoutSessionId: null }),
    ).rejects.toBeInstanceOf(TransientError);
    reader.getPayment = async () => {
      throw new PaymentReadPermanentError('http_401');
    };
    await expect(
      run({ event: 'PAYMENT_RECEIVED', paymentId: pay.id, checkoutSessionId: null }),
    ).rejects.toBeInstanceOf(PermanentError);
    // payload que não é nosso formato: nada a fazer
    await run({ qualquer: 'coisa' });
  });
});

describe('página de retorno: o pedido e a conferência', () => {
  it('GET do pedido só para a dona (de outra pessoa ou inexistente: 404 igual); sem sessão 401; nada interno no DTO', async () => {
    fresh();
    const owner = await newPerson();
    const other = await newPerson();
    const { orderId } = await buy(owner);
    expect((await call('GET', `/me/orders/${orderId}`)).status).toBe(401);
    const mine = await call('GET', `/me/orders/${orderId}`, owner.headers);
    expect(mine.status).toBe(200);
    const body = await json(mine);
    expect(Object.keys(body.order).sort()).toEqual([
      'courseTitle',
      'expiresAt',
      'id',
      'priceCents',
      'status',
    ]);
    expect(body.order).toMatchObject({ id: orderId, status: 'pending', priceCents: 19_700 });
    const theirs = await call('GET', `/me/orders/${orderId}`, other.headers);
    const missing = await call('GET', `/me/orders/${crypto.randomUUID()}`, other.headers);
    expect(theirs.status).toBe(404);
    expect(await json(theirs)).toEqual(await json(missing));
    expect((await call('GET', '/me/orders/nao-e-uuid', owner.headers)).status).toBe(404);
  });

  it('POST check: lê o pagamento na API e concede; a página não informa resultado; de outra pessoa 404 sem ler o provider', async () => {
    fresh();
    const owner = await newPerson();
    const other = await newPerson();
    const { orderId, sessionId } = await buy(owner);
    payment(sessionId, { status: 'RECEIVED' });
    expect((await call('POST', `/me/orders/${orderId}/check`, other.headers)).status).toBe(404);
    expect(reader.reads).toHaveLength(0);
    expect((await call('POST', `/me/orders/${orderId}/check`)).status).toBe(401);
    const response = await call('POST', `/me/orders/${orderId}/check`, owner.headers);
    expect(response.status).toBe(200);
    expect((await json(response)).order.status).toBe('paid');
    expect(await hasAccess(owner.id)).toBe(true);
    // repetir é seguro
    expect((await call('POST', `/me/orders/${orderId}/check`, owner.headers)).status).toBe(200);
    expect(await grantsOf(owner.id)).toHaveLength(1);
  });

  it('o pedido continua pendente enquanto o Asaas diz PENDING (a URL da página nunca libera)', async () => {
    fresh();
    const owner = await newPerson();
    const { orderId, sessionId } = await buy(owner);
    payment(sessionId, { status: 'PENDING' });
    const response = await call('POST', `/me/orders/${orderId}/check`, owner.headers);
    expect((await json(response)).order.status).toBe('pending');
    expect(await hasAccess(owner.id)).toBe(false);
  });

  it('no máximo 10 conferências por pedido: a 11ª não consulta o Asaas', async () => {
    fresh();
    const owner = await newPerson();
    const { orderId, sessionId } = await buy(owner);
    payment(sessionId, { status: 'PENDING' });
    for (let i = 0; i < 10; i += 1) {
      expect((await call('POST', `/me/orders/${orderId}/check`, owner.headers)).status).toBe(200);
    }
    const readsBefore = reader.reads.length;
    const limited = await call('POST', `/me/orders/${orderId}/check`, owner.headers);
    expect(limited.status).toBe(200);
    expect((await json(limited)).limited).toBe(true);
    expect(reader.reads.length).toBe(readsBefore);
  });

  it('sem Asaas configurado 503; falha do Asaas 503 e nada muda', async () => {
    fresh();
    const owner = await newPerson();
    const { orderId, sessionId } = await buy(owner);
    payment(sessionId, { status: 'RECEIVED' });
    reader.failNext = 1;
    const down = await call('POST', `/me/orders/${orderId}/check`, owner.headers);
    expect(down.status).toBe(503);
    expect((await json(down)).error.code).toBe('payment_provider_unavailable');
    expect(await hasAccess(owner.id)).toBe(false);
    withReader = false;
    const off = await call('POST', `/me/orders/${orderId}/check`, owner.headers);
    expect(off.status).toBe(503);
    expect((await json(off)).error.code).toBe('checkout_not_configured');
  });
});
