import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import {
  InvalidOrderTransitionError,
  type OrderStatus,
} from '../../src/features/commerce/commerce.ts';
import {
  InvalidOfferTermsError,
  createOffer,
  setOfferStatus,
  updateOffer,
} from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import {
  OrderAttemptConflictError,
  OrderOfferNotPaidError,
  OrderOfferUnavailableError,
  createOrder,
  getOrder,
  recordFinancialEventIn,
  transitionOrder,
} from '../../src/server/commerce/order-store.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M6-01 em Postgres 18 real: Order com snapshot imutável, CheckoutSession, Payment e FinancialEvent append-only.
 * Nenhuma chamada ao Asaas: só o modelo, a máquina de estados e os gatilhos. Os testes não limpam as tabelas (os
 * fatos financeiros são append-only e os pedidos não se apagam): cada teste cria a sua pessoa e a sua oferta.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let courseId: string;
let freeOfferId: string;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  const seeded = await seedDemoCourse(tools.db);
  courseId = seeded.courseId;
  freeOfferId = seeded.offerId;
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});

async function newUser() {
  seq += 1;
  const user = tools.test.createUser({ email: `compra${seq}@example.test`, name: `Compra ${seq}` });
  await tools.test.saveUser(user);
  return user.id as string;
}

/** Uma oferta PAGA ativa no curso demonstrativo (que já tem currículo publicado). */
async function paidOffer(
  terms: { priceCents?: number; maxInstallments?: number; accessMonths?: number } = {},
  activate = true,
) {
  const offerId = await createOffer(tools.db, {
    actorId: null,
    courseId,
    name: `Oferta paga ${(seq += 1)}`,
    kind: 'paid',
    priceCents: terms.priceCents ?? 19_700,
    accessMonths: terms.accessMonths ?? 12,
    maxInstallments: terms.maxInstallments ?? 12,
  });
  if (activate)
    await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'active' });
  return offerId;
}
const attempt = () => crypto.randomUUID();

/** Erros do Drizzle trazem a mensagem do Postgres em `cause`: confere nas duas. */
async function violation(work: PromiseLike<unknown>, pattern: RegExp) {
  let caught: unknown;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'esperava uma violação').toBeDefined();
  const text = [caught, (caught as { cause?: unknown }).cause]
    .map((item) => (item as Error | undefined)?.message ?? '')
    .join(' | ');
  expect(text).toMatch(pattern);
}

const eventsOf = (orderId: string) =>
  tools.db
    .select()
    .from(schema.financialEvent)
    .where(eq(schema.financialEvent.orderId, orderId))
    .orderBy(schema.financialEvent.createdAt, schema.financialEvent.kind);

async function newOrder(options: { priceCents?: number; maxInstallments?: number } = {}) {
  const userId = await newUser();
  const offerId = await paidOffer(options);
  const { order } = await createOrder(tools.db, { userId, offerId, attemptId: attempt() });
  return { userId, offerId, order };
}

describe('regras de publicação da Offer paga', () => {
  it('piso de R$ 10,00 e parcela mínima de R$ 10,00 na ativação', async () => {
    const tooCheap = await paidOffer({ priceCents: 999, maxInstallments: 1 }, false);
    await expect(
      setOfferStatus(tools.db, { actorId: null, courseId, offerId: tooCheap, status: 'active' }),
    ).rejects.toBeInstanceOf(InvalidOfferTermsError);

    const floor = await paidOffer({ priceCents: 1000, maxInstallments: 1 });
    expect(floor).toBeTruthy();

    // 11.999 centavos permite 11 parcelas (R$ 10,00 cada), não 12
    const twelve = await paidOffer({ priceCents: 11_999, maxInstallments: 12 }, false);
    await expect(
      setOfferStatus(tools.db, { actorId: null, courseId, offerId: twelve, status: 'active' }),
    ).rejects.toMatchObject({ fields: ['maxInstallments'] });
    const eleven = await paidOffer({ priceCents: 11_999, maxInstallments: 11 });
    expect(eleven).toBeTruthy();
    const exact = await paidOffer({ priceCents: 12_000, maxInstallments: 12 });
    expect(exact).toBeTruthy();
  });

  it('editar uma Offer paga ATIVA não contorna o piso nem o limite de parcelas; rascunho e gratuita seguem livres', async () => {
    const active = await paidOffer({ priceCents: 12_000, maxInstallments: 12 });
    await expect(
      updateOffer(tools.db, { actorId: 'x', courseId, offerId: active, priceCents: 5000 }),
    ).rejects.toBeInstanceOf(InvalidOfferTermsError);
    await expect(
      updateOffer(tools.db, { actorId: 'x', courseId, offerId: active, priceCents: 999 }),
    ).rejects.toBeInstanceOf(InvalidOfferTermsError);
    const [row] = await tools.db.select().from(schema.offer).where(eq(schema.offer.id, active));
    expect(row!.priceCents).toBe(12_000);

    const draft = await paidOffer({ priceCents: 12_000, maxInstallments: 12 }, false);
    await updateOffer(tools.db, {
      actorId: 'x',
      courseId,
      offerId: draft,
      priceCents: 500,
      maxInstallments: 1,
    });
    expect(freeOfferId).toBeTruthy();
  });
});

describe('criar o pedido', () => {
  it('o snapshot vem da Offer lida no servidor e NÃO muda quando a Offer muda depois', async () => {
    const userId = await newUser();
    const offerId = await paidOffer({ priceCents: 19_700, maxInstallments: 10, accessMonths: 12 });
    const now = new Date('2026-10-14T12:00:00.000Z');
    const { order, created } = await createOrder(tools.db, {
      userId,
      offerId,
      attemptId: attempt(),
      now,
    });
    expect(created).toBe(true);
    expect(order).toMatchObject({
      userId,
      offerId,
      courseId,
      status: 'pending',
      snapshot: {
        offerName: expect.stringContaining('Oferta paga'),
        priceCents: 19_700,
        currency: 'BRL',
        accessMonths: 12,
        maxInstallments: 10,
        methods: ['pix', 'card'],
      },
    });
    expect(order.expiresAt.toISOString()).toBe('2026-10-14T13:00:00.000Z');

    await updateOffer(tools.db, {
      actorId: 'x',
      courseId,
      offerId,
      name: 'Outro nome',
      priceCents: 29_700,
      accessMonths: 6,
      maxInstallments: 3,
    });
    await tools.db
      .update(schema.course)
      .set({ title: 'Título novo' })
      .where(eq(schema.course.id, courseId));
    const reread = await getOrder(tools.db, order.id);
    expect(reread!.snapshot).toEqual(order.snapshot);
    expect(reread!.snapshot.priceCents).toBe(19_700);
  });

  it('recusa Offer gratuita, pausada, em rascunho e inexistente', async () => {
    const userId = await newUser();
    await expect(
      createOrder(tools.db, { userId, offerId: freeOfferId, attemptId: attempt() }),
    ).rejects.toBeInstanceOf(OrderOfferNotPaidError);
    const paused = await paidOffer();
    await setOfferStatus(tools.db, { actorId: null, courseId, offerId: paused, status: 'paused' });
    await expect(
      createOrder(tools.db, { userId, offerId: paused, attemptId: attempt() }),
    ).rejects.toBeInstanceOf(OrderOfferUnavailableError);
    await expect(
      createOrder(tools.db, { userId, offerId: crypto.randomUUID(), attemptId: attempt() }),
    ).rejects.toBeInstanceOf(OrderOfferUnavailableError);
    const draft = await paidOffer({}, false);
    await expect(
      createOrder(tools.db, { userId, offerId: draft, attemptId: attempt() }),
    ).rejects.toBeInstanceOf(OrderOfferUnavailableError);
    const none = await tools.db
      .select()
      .from(schema.purchaseOrder)
      .where(eq(schema.purchaseOrder.userId, userId));
    expect(none).toHaveLength(0);
  });

  it('repetir o attemptId devolve o MESMO pedido (mesmo com a Offer alterada); outra Offer com o mesmo attemptId é recusada', async () => {
    const userId = await newUser();
    const offerId = await paidOffer({ priceCents: 19_700 });
    const attemptId = attempt();
    const first = await createOrder(tools.db, { userId, offerId, attemptId });
    await updateOffer(tools.db, { actorId: 'x', courseId, offerId, priceCents: 25_000 });
    const again = await createOrder(tools.db, { userId, offerId, attemptId });
    expect(again.created).toBe(false);
    expect(again.order.id).toBe(first.order.id);
    expect(again.order.snapshot.priceCents).toBe(19_700);
    const other = await paidOffer();
    await expect(
      createOrder(tools.db, { userId, offerId: other, attemptId }),
    ).rejects.toBeInstanceOf(OrderAttemptConflictError);
    expect(
      await tools.db
        .select()
        .from(schema.purchaseOrder)
        .where(eq(schema.purchaseOrder.userId, userId)),
    ).toHaveLength(1);
    // um attemptId igual de OUTRA pessoa é um pedido dela (não vaza o pedido alheio)
    const stranger = await newUser();
    const theirs = await createOrder(tools.db, { userId: stranger, offerId, attemptId });
    expect(theirs.created).toBe(true);
    expect(theirs.order.id).not.toBe(first.order.id);
  });

  it('cliques simultâneos com o mesmo attemptId (conexões separadas) criam UM pedido e UM fato', async () => {
    const userId = await newUser();
    const offerId = await paidOffer();
    const attemptId = attempt();
    const connections = await Promise.all(
      [1, 2, 3, 4].map(() => openDatabase(database.connectionString)),
    );
    const results = await Promise.all(
      connections.map((connection) => createOrder(connection.db, { userId, offerId, attemptId })),
    );
    await Promise.all(connections.map((connection) => connection.close()));
    expect(new Set(results.map((result) => result.order.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const events = await eventsOf(results[0]!.order.id);
    expect(events.map((event) => event.kind)).toEqual(['order.created']);
  });
});

describe('o pedido no banco', () => {
  it('snapshot, pessoa, Offer e tentativa são imutáveis por gatilho; o pedido não se apaga', async () => {
    const { order, userId } = await newOrder();
    for (const set of [
      'price_cents = price_cents + 1',
      'access_months = 1',
      'max_installments = 1',
      `course_title = 'x'`,
      `offer_name = 'x'`,
      `currency = 'BRL', expires_at = now()`,
      `payment_methods = array['pix']::text[]`,
      `attempt_id = gen_random_uuid()`,
    ]) {
      await violation(
        tools.db.execute(sql.raw(`update purchase_order set ${set} where id = '${order.id}'`)),
        /order_snapshot_locked/,
      );
    }
    const other = await newUser();
    await violation(
      tools.db.execute(sql`update purchase_order set user_id = ${other} where id = ${order.id}`),
      /order_snapshot_locked/,
    );
    await violation(
      tools.db.execute(sql`delete from purchase_order where id = ${order.id}`),
      /purchase_order_not_deletable/,
    );
    const reread = await getOrder(tools.db, order.id);
    expect(reread!.snapshot).toEqual(order.snapshot);
    expect(reread!.userId).toBe(userId);
  });

  it('CHECKs: preço abaixo de R$ 10, parcelas além do preço ou de 12, meios fora de Pix e cartão, status inventado', async () => {
    const userId = await newUser();
    const offerId = await paidOffer();
    const insert = (override: string) =>
      tools.db.execute(
        sql.raw(
          `insert into purchase_order (user_id, offer_id, course_id, attempt_id, course_title, offer_name, price_cents, access_months, max_installments, payment_methods, expires_at) select '${userId}', '${offerId}', '${courseId}', gen_random_uuid(), 'c', 'o', ${override}`,
        ),
      );
    await violation(
      insert(`999, 12, 1, array['pix'], now()`),
      /purchase_order_(price|installments)_check/,
    );
    await violation(
      insert(`11999, 12, 12, array['pix'], now()`),
      /purchase_order_installments_check/,
    );
    await violation(
      insert(`50000, 12, 13, array['pix'], now()`),
      /purchase_order_installments_check/,
    );
    await violation(insert(`19700, 12, 1, array['boleto'], now()`), /purchase_order_methods_check/);
    await violation(insert(`19700, 12, 1, array[]::text[], now()`), /purchase_order_methods_check/);
    await violation(
      insert(`19700, 0, 1, array['pix'], now()`),
      /purchase_order_access_months_check/,
    );
    const { order } = await newOrder();
    await violation(
      tools.db.execute(sql`update purchase_order set status = 'inventado' where id = ${order.id}`),
      /purchase_order_status_check/,
    );
  });
});

describe('máquina de estados do pedido', () => {
  it('pending → paid → refund_requested → refunded deixa um fato por passo e refunded é final', async () => {
    const { order } = await newOrder();
    for (const to of ['paid', 'refund_requested', 'refunded'] as const) {
      const updated = await transitionOrder(tools.db, { orderId: order.id, to, source: 'admin' });
      expect(updated.status).toBe(to);
    }
    const kinds = (await eventsOf(order.id)).map((event) => event.kind).sort();
    expect(kinds).toEqual([
      'order.created',
      'order.paid',
      'order.refund_requested',
      'order.refunded',
    ]);
    await expect(
      transitionOrder(tools.db, { orderId: order.id, to: 'paid', source: 'admin' }),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
    await violation(
      tools.db.execute(sql`update purchase_order set status = 'pending' where id = ${order.id}`),
      /order_refunded_is_final/,
    );
  });

  it('transição inválida lança erro de domínio e não muda nada nem grava fato', async () => {
    const { order } = await newOrder();
    for (const to of ['refunded', 'refund_requested', 'disputed'] as const) {
      await expect(
        transitionOrder(tools.db, { orderId: order.id, to, source: 'admin' }),
      ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
    }
    // pedido vencido ou cancelado NÃO vira pago direto: só passa por revisão
    await transitionOrder(tools.db, { orderId: order.id, to: 'expired', source: 'reconciliation' });
    await expect(
      transitionOrder(tools.db, { orderId: order.id, to: 'paid', source: 'webhook' }),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
    await transitionOrder(tools.db, { orderId: order.id, to: 'review', source: 'reconciliation' });
    await transitionOrder(tools.db, { orderId: order.id, to: 'paid', source: 'admin' });
    expect((await getOrder(tools.db, order.id))!.status).toBe('paid');
    expect((await eventsOf(order.id)).map((event) => event.kind).sort()).toEqual([
      'order.created',
      'order.expired',
      'order.paid',
      'order.review',
    ]);
    await expect(
      transitionOrder(tools.db, { orderId: crypto.randomUUID(), to: 'paid', source: 'admin' }),
    ).rejects.toThrow(/order_not_found/);
  });

  it('transições concorrentes (paid x expired, conexões separadas): exatamente uma vence e fica um só fato', async () => {
    const { order } = await newOrder();
    const [a, b] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    const outcomes = await Promise.allSettled([
      transitionOrder(a.db, { orderId: order.id, to: 'paid', source: 'webhook' }),
      transitionOrder(b.db, { orderId: order.id, to: 'expired', source: 'reconciliation' }),
    ]);
    await Promise.all([a.close(), b.close()]);
    const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    const final = (await getOrder(tools.db, order.id))!.status as OrderStatus;
    expect(['paid', 'expired']).toContain(final);
    const transitions = (await eventsOf(order.id)).filter(
      (event) => event.kind !== 'order.created',
    );
    expect(transitions).toHaveLength(1);
  });
});

describe('sessão de checkout', () => {
  it('no máximo UMA sessão ativa por pedido; depois de falhar ou expirar, outra pode nascer', async () => {
    const { order } = await newOrder();
    const first = await tools.db
      .insert(schema.checkoutSession)
      .values({ orderId: order.id, expiresAt: new Date(Date.now() + 3_600_000) })
      .returning();
    await violation(
      tools.db
        .insert(schema.checkoutSession)
        .values({ orderId: order.id, expiresAt: new Date(Date.now() + 3_600_000) }),
      /checkout_session_active_idx|duplicate key/,
    );
    await tools.db
      .update(schema.checkoutSession)
      .set({ state: 'failed' })
      .where(eq(schema.checkoutSession.id, first[0]!.id));
    const second = await tools.db
      .insert(schema.checkoutSession)
      .values({ orderId: order.id, state: 'unknown', expiresAt: new Date(Date.now() + 3_600_000) })
      .returning();
    expect(second).toHaveLength(1);
    // `unknown` ainda ocupa a vaga: não dá para criar outra até expirar
    await violation(
      tools.db
        .insert(schema.checkoutSession)
        .values({ orderId: order.id, expiresAt: new Date(Date.now() + 3_600_000) }),
      /checkout_session_active_idx|duplicate key/,
    );
  });

  it('`open` exige id do provider e URL https; URL http, gigante ou sem id é recusada; o id do provider é único', async () => {
    const { order } = await newOrder();
    const base = { orderId: order.id, expiresAt: new Date(Date.now() + 3_600_000) };
    await violation(
      tools.db.insert(schema.checkoutSession).values({ ...base, state: 'open' }),
      /checkout_session_open_check/,
    );
    await violation(
      tools.db.insert(schema.checkoutSession).values({
        ...base,
        state: 'open',
        providerSessionId: 'chk_1',
        checkoutUrl: 'http://pay.example.test/x',
      }),
      /checkout_session_url_check/,
    );
    await violation(
      tools.db.insert(schema.checkoutSession).values({
        ...base,
        state: 'open',
        providerSessionId: 'chk_1',
        checkoutUrl: `https://pay.example.test/${'a'.repeat(2100)}`,
      }),
      /checkout_session_url_check/,
    );
    const [opened] = await tools.db
      .insert(schema.checkoutSession)
      .values({
        ...base,
        state: 'open',
        providerSessionId: `chk_${crypto.randomUUID()}`,
        checkoutUrl: 'https://pay.example.test/abc',
      })
      .returning();
    const another = await newOrder();
    await violation(
      tools.db.insert(schema.checkoutSession).values({
        orderId: another.order.id,
        expiresAt: new Date(Date.now() + 3_600_000),
        state: 'open',
        providerSessionId: opened!.providerSessionId,
        checkoutUrl: 'https://pay.example.test/xyz',
      }),
      /checkout_session_provider_session_id_unique|duplicate key/,
    );
    await violation(
      tools.db.execute(sql`delete from checkout_session where id = ${opened!.id}`),
      /checkout_session_not_deletable/,
    );
    await violation(
      tools.db.execute(
        sql`update checkout_session set order_id = ${another.order.id} where id = ${opened!.id}`,
      ),
      /checkout_session_key_locked/,
    );
  });
});

describe('pagamento', () => {
  it('o id do provider é único; valor positivo; só Pix e cartão; identidade imutável; não se apaga', async () => {
    const { order } = await newOrder();
    const providerPaymentId = `pay_${crypto.randomUUID()}`;
    const [created] = await tools.db
      .insert(schema.payment)
      .values({
        orderId: order.id,
        providerPaymentId,
        method: 'pix',
        amountCents: order.snapshot.priceCents,
        providerStatus: 'PENDING',
      })
      .returning();
    const other = await newOrder();
    const base = {
      orderId: other.order.id,
      method: 'pix',
      amountCents: 1000,
      providerStatus: 'PENDING',
    };
    await violation(
      tools.db.insert(schema.payment).values({ ...base, providerPaymentId }),
      /payment_provider_payment_unique|duplicate key/,
    );
    await violation(
      tools.db.insert(schema.payment).values({ ...base, providerPaymentId: 'p2', amountCents: 0 }),
      /payment_amount_check/,
    );
    await violation(
      tools.db
        .insert(schema.payment)
        .values({ ...base, providerPaymentId: 'p3', method: 'boleto' }),
      /payment_method_check/,
    );
    for (const set of [
      `amount_cents = 1`,
      `provider_payment_id = 'outro'`,
      `method = 'card'`,
      `order_id = '${other.order.id}'`,
    ]) {
      await violation(
        tools.db.execute(sql.raw(`update payment set ${set} where id = '${created!.id}'`)),
        /payment_identity_locked/,
      );
    }
    // o que muda com o tempo (estado do provider, data do pagamento) pode mudar
    await tools.db
      .update(schema.payment)
      .set({ providerStatus: 'RECEIVED', paidAt: new Date() })
      .where(eq(schema.payment.id, created!.id));
    await violation(
      tools.db.execute(sql`delete from payment where id = ${created!.id}`),
      /payment_not_deletable/,
    );
  });
});

describe('fatos financeiros (append-only)', () => {
  it('UPDATE e DELETE são recusados; o mesmo (kind, provider_event_id) vale uma só vez', async () => {
    const { order } = await newOrder();
    const providerEventId = `evt_${crypto.randomUUID()}`;
    const first = await tools.db.transaction((tx) =>
      recordFinancialEventIn(tx, {
        orderId: order.id,
        kind: 'webhook.received',
        source: 'webhook',
        providerEventId,
        details: { n: 1 },
      }),
    );
    const second = await tools.db.transaction((tx) =>
      recordFinancialEventIn(tx, {
        orderId: order.id,
        kind: 'webhook.received',
        source: 'webhook',
        providerEventId,
        details: { n: 2 },
      }),
    );
    expect([first.recorded, second.recorded]).toEqual([true, false]);
    // outro `kind` com o mesmo id do provider é outro fato
    const third = await tools.db.transaction((tx) =>
      recordFinancialEventIn(tx, {
        orderId: order.id,
        kind: 'webhook.applied',
        source: 'webhook',
        providerEventId,
      }),
    );
    expect(third.recorded).toBe(true);

    await violation(
      tools.db.execute(sql`update financial_event set kind = 'x' where order_id = ${order.id}`),
      /append-only/,
    );
    await violation(
      tools.db.execute(sql`delete from financial_event where order_id = ${order.id}`),
      /append-only/,
    );
    // tampouco por apagar o pedido ou o pagamento a que se referem (FK restrict)
    await violation(
      tools.db.execute(sql`delete from purchase_order where id = ${order.id}`),
      /purchase_order_not_deletable|violates foreign key/,
    );
    const kept = (await eventsOf(order.id)).filter((event) => event.kind.startsWith('webhook'));
    expect(kept).toHaveLength(2);
    expect(kept.find((event) => event.kind === 'webhook.received')!.details).toEqual({ n: 1 });
  });

  it('fonte e tipo inválidos são recusados', async () => {
    const { order } = await newOrder();
    await violation(
      tools.db
        .insert(schema.financialEvent)
        .values({ orderId: order.id, kind: 'x', source: 'cliente' }),
      /financial_event_source_check/,
    );
    await violation(
      tools.db.insert(schema.financialEvent).values({ orderId: order.id, kind: '', source: 'api' }),
      /financial_event_kind_check/,
    );
  });
});
