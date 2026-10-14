import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { createOffer, setOfferStatus } from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import {
  createFakeCheckoutProvider,
  type FakeCheckoutProvider,
} from '../../src/server/commerce/fake-checkout.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M6-02 em Postgres 18 real, com o DUBLÊ do Asaas (o sandbox real não foi exercitado, ver STATUS): a compra só abre
 * o Checkout para pessoa autenticada e verificada, com o preço do snapshot; resultado ambíguo nunca recria a sessão;
 * a URL devolvida só vale se for https de um host da allowlist; cliques simultâneos geram UMA chamada ao provider.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-14T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let provider: FakeCheckoutProvider;
let courseId: string;
let freeOfferId: string;
let clockNow = T0;
let withProvider = true;
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

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

function newProvider() {
  provider = createFakeCheckoutProvider();
  withProvider = true;
  clockNow = T0;
}
const app = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    clock: () => clockNow,
    ...(withProvider ? { checkoutProvider: provider } : {}),
  });

interface Person {
  id: string;
  headers: Headers;
}
async function newPerson(options: { verified?: boolean } = {}): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `compra${seq}@example.test`, name: `Compra ${seq}` });
  await tools.test.saveUser(user);
  await tools.db
    .update(schema.user)
    .set({ emailVerified: options.verified ?? true })
    .where(eq(schema.user.id, user.id));
  return { id: user.id as string, headers: (await tools.test.login({ userId: user.id })).headers };
}

function post(path: string, headers: Headers | undefined, body: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method: 'POST', headers: merged, body: JSON.stringify(body) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;
const checkout = (who: Person | undefined, offerId: string, attemptId: string) =>
  post('/me/checkout', who?.headers, { offerId, attemptId });
const attempt = () => crypto.randomUUID();

async function paidOffer(terms: { priceCents?: number; maxInstallments?: number } = {}) {
  seq += 1;
  const offerId = await createOffer(tools.db, {
    actorId: null,
    courseId,
    name: `Oferta paga ${seq}`,
    kind: 'paid',
    priceCents: terms.priceCents ?? 19_700,
    accessMonths: 12,
    maxInstallments: terms.maxInstallments ?? 12,
  });
  await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'active' });
  return offerId;
}
const sessionsOf = async (orderId: string) =>
  tools.db.select().from(schema.checkoutSession).where(eq(schema.checkoutSession.orderId, orderId));
const ordersOf = async (userId: string) =>
  tools.db.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.userId, userId));
const factKinds = async (orderId: string) =>
  (
    await tools.db
      .select({ kind: schema.financialEvent.kind })
      .from(schema.financialEvent)
      .where(eq(schema.financialEvent.orderId, orderId))
  )
    .map((row) => row.kind)
    .sort();

describe('entrada da compra', () => {
  it('sem sessão 401; corpo com preço, e-mail ou callback 400; sem Asaas configurado 503 e nada é gravado', async () => {
    newProvider();
    const offerId = await paidOffer();
    expect((await checkout(undefined, offerId, attempt())).status).toBe(401);
    const person = await newPerson();
    for (const extra of [
      { priceCents: 1 },
      { price: 1 },
      { email: 'x@example.test' },
      { successUrl: 'https://evil.example' },
      { userId: 'outra' },
      { amount: 1 },
    ]) {
      const response = await post('/me/checkout', person.headers, {
        offerId,
        attemptId: attempt(),
        ...extra,
      });
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
    for (const body of [
      {},
      { offerId },
      { offerId: 'x', attemptId: attempt() },
      { offerId, attemptId: 'x' },
    ]) {
      expect((await post('/me/checkout', person.headers, body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
    withProvider = false;
    const off = await checkout(person, offerId, attempt());
    expect(off.status).toBe(503);
    expect(await json(off)).toEqual({ error: { code: 'checkout_not_configured' } });
    expect(await ordersOf(person.id)).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });
});

describe('abrir o Checkout', () => {
  it('pessoa verificada: pedido com o preço do SNAPSHOT, sessão aberta com a URL do provider e fatos na trilha', async () => {
    newProvider();
    const person = await newPerson();
    const offerId = await paidOffer({ priceCents: 19_705, maxInstallments: 10 });
    const response = await checkout(person, offerId, attempt());
    expect(response.status).toBe(200);
    const body = await json(response);
    const [order] = await ordersOf(person.id);
    expect(body).toEqual({
      orderId: order!.id,
      checkoutUrl: provider.created[0]!.link,
      expiresAt: '2026-10-14T13:00:00.000Z',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');

    // o que SERIA enviado ao Asaas
    expect(provider.requests).toHaveLength(1);
    const sent = provider.requests[0]!;
    expect(sent).toMatchObject({
      billingTypes: ['PIX', 'CREDIT_CARD'],
      chargeTypes: ['DETACHED', 'INSTALLMENT'],
      minutesToExpire: 60,
      externalReference: order!.id,
      callback: {
        successUrl: `${BASE_URL}/compra/retorno?pedido=${order!.id}&resultado=sucesso`,
        cancelUrl: `${BASE_URL}/compra/retorno?pedido=${order!.id}&resultado=cancelado`,
        expiredUrl: `${BASE_URL}/compra/retorno?pedido=${order!.id}&resultado=expirado`,
      },
      installment: { maxInstallmentCount: 10 },
    });
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0]).toMatchObject({ quantity: 1, value: 197.05 });
    expect(sent.items[0]!.name.length).toBeLessThanOrEqual(30);
    expect(JSON.stringify(sent)).not.toContain('customerData');
    expect(JSON.stringify(sent)).not.toContain(person.id);

    const [session] = await sessionsOf(order!.id);
    expect(session).toMatchObject({
      state: 'open',
      providerSessionId: provider.created[0]!.id,
      checkoutUrl: provider.created[0]!.link,
    });
    expect(order!.priceCents).toBe(19_705);
    expect(await factKinds(order!.id)).toEqual(['checkout.opened', 'order.created']);
  });

  it('repetir o mesmo attemptId reaproveita a sessão: o MESMO endereço e UMA só chamada ao provider', async () => {
    newProvider();
    const person = await newPerson();
    const offerId = await paidOffer();
    const attemptId = attempt();
    const first = await json(await checkout(person, offerId, attemptId));
    const second = await json(await checkout(person, offerId, attemptId));
    expect(second).toEqual(first);
    expect(provider.requests).toHaveLength(1);
    expect(await ordersOf(person.id)).toHaveLength(1);
    // outro attemptId é outro pedido (outro clique de propósito)
    const other = await json(await checkout(person, offerId, attempt()));
    expect(other.orderId).not.toBe(first.orderId);
  });

  it('pedido de OUTRA pessoa com o mesmo attemptId é um pedido dela, nunca o da primeira', async () => {
    newProvider();
    const one = await newPerson();
    const two = await newPerson();
    const offerId = await paidOffer();
    const attemptId = attempt();
    const a = await json(await checkout(one, offerId, attemptId));
    const b = await json(await checkout(two, offerId, attemptId));
    expect(a.orderId).not.toBe(b.orderId);
    expect((await ordersOf(one.id))[0]!.userId).toBe(one.id);
    expect((await ordersOf(two.id))[0]!.userId).toBe(two.id);
  });

  it('cliques simultâneos do mesmo pedido: UMA chamada ao provider, UM pedido, UMA sessão', async () => {
    newProvider();
    provider.delayMs = 400;
    const person = await newPerson();
    const offerId = await paidOffer();
    const attemptId = attempt();
    const responses = await Promise.all(
      [1, 2, 3, 4].map(() => checkout(person, offerId, attemptId)),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    for (const response of responses.filter((item) => item.status !== 200)) {
      expect(response.status).toBe(409);
      expect((await json(response)).error.code).toBe('checkout_in_progress');
    }
    expect(provider.requests).toHaveLength(1);
    const orders = await ordersOf(person.id);
    expect(orders).toHaveLength(1);
    expect(await sessionsOf(orders[0]!.id)).toHaveLength(1);
  });
});

describe('bloqueios antes de qualquer cobrança', () => {
  it('conta suspensa 403, e-mail não verificado 403, e o provider não é chamado nem o pedido criado', async () => {
    newProvider();
    const offerId = await paidOffer();
    const suspended = await newPerson();
    await tools.db.insert(schema.userSuspension).values({ userId: suspended.id });
    const response = await checkout(suspended, offerId, attempt());
    expect(response.status).toBe(403);
    expect((await json(response)).error.code).toBe('account_suspended');
    const unverified = await newPerson({ verified: false });
    const second = await checkout(unverified, offerId, attempt());
    expect(second.status).toBe(403);
    expect((await json(second)).error.code).toBe('email_not_verified');
    expect(provider.requests).toHaveLength(0);
    expect(await ordersOf(suspended.id)).toHaveLength(0);
    expect(await ordersOf(unverified.id)).toHaveLength(0);
  });

  it('Offer gratuita, pausada, em rascunho ou inexistente: 409 offer_unavailable', async () => {
    newProvider();
    const person = await newPerson();
    const paused = await paidOffer();
    await setOfferStatus(tools.db, { actorId: null, courseId, offerId: paused, status: 'paused' });
    for (const offerId of [freeOfferId, paused, crypto.randomUUID()]) {
      const response = await checkout(person, offerId, attempt());
      expect(response.status).toBe(409);
      expect((await json(response)).error.code).toBe('offer_unavailable');
    }
    expect(provider.requests).toHaveLength(0);
  });

  it('quem já tem direito efetivo ao curso: 409 already_has_access, sem pedido; direito expirado compra de novo', async () => {
    newProvider();
    const person = await newPerson();
    const offerId = await paidOffer();
    await grantEntitlement(tools.db, {
      userId: person.id,
      courseId,
      offerId: null,
      source: 'admin_grant',
      sourceRef: `cortesia:${person.id}`,
      reason: 'cortesia',
      accessMonths: 3,
      startsAt: T0,
      grantedBy: person.id,
    });
    const blocked = await checkout(person, offerId, attempt());
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error.code).toBe('already_has_access');
    expect(await ordersOf(person.id)).toHaveLength(0);
    // 4 meses depois o direito expirou: pode comprar de novo
    clockNow = new Date(T0.getTime() + 125 * 86_400_000);
    expect((await checkout(person, offerId, attempt())).status).toBe(200);
  });

  it('o mesmo attemptId com OUTRA Offer é recusado e não abre nada', async () => {
    newProvider();
    const person = await newPerson();
    const a = await paidOffer();
    const b = await paidOffer();
    const attemptId = attempt();
    expect((await checkout(person, a, attemptId)).status).toBe(200);
    const response = await checkout(person, b, attemptId);
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe('attempt_conflict');
    expect(provider.requests).toHaveLength(1);
  });
});

describe('resultado do provider', () => {
  it('recusa conhecida: 502, sessão failed com fato; repetir o attemptId abre uma sessão NOVA', async () => {
    newProvider();
    const person = await newPerson();
    const offerId = await paidOffer();
    const attemptId = attempt();
    provider.next = 'reject';
    const failed = await checkout(person, offerId, attemptId);
    expect(failed.status).toBe(502);
    expect((await json(failed)).error.code).toBe('checkout_failed');
    const [order] = await ordersOf(person.id);
    expect((await sessionsOf(order!.id)).map((row) => row.state)).toEqual(['failed']);
    expect(await factKinds(order!.id)).toEqual(['checkout.rejected', 'order.created']);

    provider.next = 'ok';
    const retry = await checkout(person, offerId, attemptId);
    expect(retry.status).toBe(200);
    expect((await sessionsOf(order!.id)).map((row) => row.state).sort()).toEqual([
      'failed',
      'open',
    ]);
    expect(await ordersOf(person.id)).toHaveLength(1);
  });

  it('AMBÍGUO (timeout): 409 checkout_unknown, sessão unknown; repetir NÃO chama o provider de novo; expirou, novo pedido', async () => {
    newProvider();
    const person = await newPerson();
    const offerId = await paidOffer();
    const attemptId = attempt();
    provider.next = 'ambiguous_after_create';
    const first = await checkout(person, offerId, attemptId);
    expect(first.status).toBe(409);
    expect((await json(first)).error.code).toBe('checkout_unknown');
    const [order] = await ordersOf(person.id);
    expect((await sessionsOf(order!.id)).map((row) => row.state)).toEqual(['unknown']);
    expect(order!.status).toBe('pending');
    expect(await factKinds(order!.id)).toEqual(['checkout.unknown', 'order.created']);

    // o provider "criou" do lado de lá: o Hub NÃO cria um segundo
    provider.next = 'ok';
    for (let i = 0; i < 3; i += 1) {
      const again = await checkout(person, offerId, attemptId);
      expect(again.status).toBe(409);
      expect((await json(again)).error.code).toBe('checkout_unknown');
    }
    expect(provider.requests).toHaveLength(1);
    expect(provider.created).toHaveLength(1);
    expect(await sessionsOf(order!.id)).toHaveLength(1);

    // passada a janela de 60 minutos, o pedido venceu: precisa de uma tentativa nova
    clockNow = new Date(T0.getTime() + 61 * 60_000);
    const late = await checkout(person, offerId, attemptId);
    expect(late.status).toBe(409);
    expect((await json(late)).error.code).toBe('order_expired');
    expect((await checkout(person, offerId, attempt())).status).toBe(200);
  });

  it('endereço fora da allowlist (host parecido, http, subdomínio): 502, nada guardado nem seguido', async () => {
    for (const host of ['sandbox.asaas.com.evil.example', 'evil.example', 'www.asaas.com']) {
      newProvider();
      provider.host = host;
      const person = await newPerson();
      const offerId = await paidOffer();
      const response = await checkout(person, offerId, attempt());
      expect(response.status, host).toBe(502);
      expect(JSON.stringify(await json(response))).not.toContain(host);
      const [order] = await ordersOf(person.id);
      const [session] = await sessionsOf(order!.id);
      expect(session).toMatchObject({
        state: 'failed',
        checkoutUrl: null,
        providerSessionId: null,
      });
      expect(await factKinds(order!.id)).toEqual(['checkout.invalid_url', 'order.created']);
    }
  });

  it('pedido já aberto que passou dos 60 minutos: order_expired (não devolve URL vencida)', async () => {
    newProvider();
    const person = await newPerson();
    const offerId = await paidOffer();
    const attemptId = attempt();
    expect((await checkout(person, offerId, attemptId)).status).toBe(200);
    clockNow = new Date(T0.getTime() + 60 * 60_000);
    const late = await checkout(person, offerId, attemptId);
    expect(late.status).toBe(409);
    expect((await json(late)).error.code).toBe('order_expired');
  });

  it('pedido que já não está pendente (pago, em revisão) não reabre checkout', async () => {
    newProvider();
    const person = await newPerson();
    const offerId = await paidOffer();
    const attemptId = attempt();
    expect((await checkout(person, offerId, attemptId)).status).toBe(200);
    const [order] = await ordersOf(person.id);
    await tools.db
      .update(schema.purchaseOrder)
      .set({ status: 'review' })
      .where(and(eq(schema.purchaseOrder.id, order!.id)));
    const response = await checkout(person, offerId, attemptId);
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe('order_not_pending');
    expect(provider.requests).toHaveLength(1);
  });
});
