import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createOffer, setOfferStatus } from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createFakeCheckoutProvider } from '../../src/server/commerce/fake-checkout.ts';
import {
  createFakePaymentReader,
  type FakePaymentReader,
} from '../../src/server/commerce/fake-payments.ts';
import { createPayerEnricher } from '../../src/server/commerce/payer-store.ts';
import { applyPaymentEvidence } from '../../src/server/commerce/payment-evidence-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M6-08 em Postgres 18 real, com o DUBLÊ do Asaas: o pagador lido DEPOIS da confirmação (nome em claro, CPF/CNPJ só
 * CIFRADO e MASCARADO por padrão), a lista financeira da Staff com filtros e totais (o "recebido" não inclui o pendente),
 * e a revelação do documento (grant, reautenticação, auditoria ANTES de devolver, nunca o número em log).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-14T12:00:00.000Z');
const CPF = '12345678909';
const CPF_FORMATTED = '123.456.789-09';
const MASTER_KEY = `1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`;
const OTHER_KEY = `1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let checkoutProvider: ReturnType<typeof createFakeCheckoutProvider>;
let reader: FakePaymentReader;
let courseId: string;
let clockNow = T0;
let vaultKey: string | undefined = MASTER_KEY;
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
  clockNow = T0;
  vaultKey = MASTER_KEY;
}
const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
    ...(vaultKey ? { FINANCE_SECRETS_MASTER_KEY: vaultKey } : {}),
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
  options: { role?: 'support' | 'admin'; grants?: string[]; reauth?: boolean } = {},
): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `fin${seq}@example.test`, name: `Fin ${seq}` });
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

async function paidOffer(priceCents = 19_700) {
  seq += 1;
  const offerId = await createOffer(tools.db, {
    actorId: null,
    courseId,
    name: `Oferta ${seq}`,
    kind: 'paid',
    priceCents,
    accessMonths: 12,
    maxInstallments: 1,
  });
  await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'active' });
  return offerId;
}

/** Abre o checkout e (opcionalmente) paga: devolve pedido, pagamento e o id do pagamento LOCAL. */
async function order(
  options: { pay?: boolean; customerId?: string | null; offerId?: string } = {},
) {
  const student = await newPerson();
  clockNow = T0;
  const response = await call('POST', '/me/checkout', student.headers, {
    offerId: options.offerId ?? (await paidOffer()),
    attemptId: crypto.randomUUID(),
  });
  expect(response.status).toBe(200);
  const [row] = await tools.db
    .select()
    .from(schema.purchaseOrder)
    .where(eq(schema.purchaseOrder.userId, student.id));
  const [session] = await tools.db
    .select()
    .from(schema.checkoutSession)
    .where(eq(schema.checkoutSession.orderId, row!.id));
  const customerId =
    options.customerId === undefined
      ? `cus_${crypto.randomUUID().slice(0, 8)}`
      : options.customerId;
  const pay = reader.set({
    id: `pay_v${(seq += 1)}_${crypto.randomUUID().slice(0, 6)}`,
    checkoutSessionId: session!.providerSessionId!,
    status: options.pay === false ? 'PENDING' : 'RECEIVED',
    // o valor do pagamento é o do pedido (o snapshot), qualquer que seja o preço da oferta
    valueCents: row!.priceCents,
    totalCents: row!.priceCents,
    customerId,
    paidAt: options.pay === false ? null : T0,
  });
  return { student, orderId: row!.id as string, pay, customerId };
}
const enricher = () => createPayerEnricher({ reader, masterKey: vaultKey });
const confirm = (paymentId: string) =>
  applyPaymentEvidence(
    tools.db,
    { reader, now: () => T0, afterGrant: enricher() },
    { paymentId, eventHint: null },
  );
const localPayment = async (providerPaymentId: string) =>
  (
    await tools.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.providerPaymentId, providerPaymentId))
  )[0]!;

async function everyRowText(): Promise<string> {
  const tables = [
    'payment',
    'financial_event',
    'audit_log',
    'purchase_order',
    'outbox_message',
    'email_message',
  ];
  const parts: string[] = [];
  for (const table of tables) {
    const result = await tools.db.execute(
      sql.raw(`select row_to_json(t)::text as j from ${table} t`),
    );
    parts.push(...(result.rows as { j: string }[]).map((row) => row.j));
  }
  return parts.join('\n');
}

describe('o pagador lido depois da confirmação', () => {
  it('guarda o nome em claro e o CPF só CIFRADO e MASCARADO; nenhuma tabela tem o número em claro', async () => {
    fresh();
    const { pay, customerId } = await order();
    reader.customers.set(customerId!, { name: '  Maria da Silva  ', document: '123.456.789-09' });
    expect((await confirm(pay.id)).outcome).toBe('granted');
    const row = await localPayment(pay.id);
    expect(row.payerName).toBe('Maria da Silva');
    expect(row.payerDocumentMasked).toBe('•••.•••.•••-09');
    expect(row.payerDocumentKeyVersion).toBe(1);
    expect(row.payerInfoReadAt).not.toBeNull();
    expect(row.payerDocumentCiphertext).not.toContain(CPF);
    const everything = await everyRowText();
    expect(everything).not.toContain(CPF);
    expect(everything).not.toContain(CPF_FORMATTED);
  });

  it('lê UMA vez por pagamento: repetir a evidência não consulta o cliente de novo', async () => {
    fresh();
    const { pay, customerId } = await order();
    reader.customers.set(customerId!, { name: 'Maria', document: CPF });
    await confirm(pay.id);
    await confirm(pay.id);
    await confirm(pay.id);
    expect(reader.reads.filter((entry) => entry.startsWith('customer:'))).toHaveLength(1);
  });

  it('sem documento no Asaas: guarda o nome, a máscara fica vazia ("não informado") e marca como lido', async () => {
    fresh();
    const { pay, customerId } = await order();
    reader.customers.set(customerId!, { name: 'Empresa Sem Doc', document: null });
    await confirm(pay.id);
    const row = await localPayment(pay.id);
    expect(row).toMatchObject({
      payerName: 'Empresa Sem Doc',
      payerDocumentMasked: null,
      payerDocumentCiphertext: null,
    });
    expect(row.payerInfoReadAt).not.toBeNull();
  });

  it('SEM a chave do cofre o documento NUNCA é guardado (só o nome) e a leitura se repete depois', async () => {
    fresh();
    vaultKey = undefined;
    const { pay, customerId } = await order();
    reader.customers.set(customerId!, { name: 'Maria', document: CPF });
    await confirm(pay.id);
    const row = await localPayment(pay.id);
    expect(row).toMatchObject({
      payerName: 'Maria',
      payerDocumentCiphertext: null,
      payerDocumentMasked: null,
      payerInfoReadAt: null,
    });
    expect(await everyRowText()).not.toContain(CPF);
    // com a chave configurada depois, a próxima evidência guarda o documento cifrado
    vaultKey = MASTER_KEY;
    await confirm(pay.id);
    expect((await localPayment(pay.id)).payerDocumentMasked).toBe('•••.•••.•••-09');
  });

  it('falha ao ler o pagador NUNCA afeta o acesso (melhor esforço)', async () => {
    fresh();
    const { pay, student } = await order();
    // o cliente não existe no dublê: getCustomer devolve null; e uma falha infra em seguida
    const first = await confirm(pay.id);
    expect(first.outcome).toBe('granted');
    expect((await localPayment(pay.id)).payerInfoReadAt).toBeNull();
    // só a leitura do PAGADOR falha (a do pagamento segue normal)
    reader.customers.set(pay.customerId!, { name: 'Maria', document: CPF });
    reader.getCustomer = async () => {
      throw new Error('asaas fora do ar');
    };
    expect((await confirm(pay.id)).outcome).toBe('already_granted');
    const [grant] = await tools.db
      .select()
      .from(schema.entitlement)
      .where(
        and(eq(schema.entitlement.userId, student.id), eq(schema.entitlement.source, 'purchase')),
      );
    expect(grant!.revokedAt).toBeNull();
  });

  it('o banco recusa guardar só parte da cifra (as colunas vêm juntas ou todas vazias)', async () => {
    fresh();
    const { pay } = await order();
    await confirm(pay.id);
    let caught: unknown;
    try {
      await tools.db
        .update(schema.payment)
        .set({ payerDocumentCiphertext: 'x' })
        .where(eq(schema.payment.providerPaymentId, pay.id));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(
      `${(caught as Error).message} ${(caught as { cause?: Error }).cause?.message ?? ''}`,
    ).toMatch(/payment_payer_document_check/);
  });
});

describe('a lista financeira da Staff', () => {
  it('só com finance.view: sem sessão 401, aluno 403, Suporte sem grant 403; com o grant e o Admin passam; query inválida 400', async () => {
    fresh();
    const student = await newPerson();
    const plain = await newPerson({ role: 'support' });
    const viewer = await newPerson({ role: 'support', grants: ['finance.view'] });
    const admin = await newPerson({ role: 'admin' });
    expect((await call('GET', '/staff/finance/orders')).status).toBe(401);
    expect((await call('GET', '/staff/finance/orders', student.headers)).status).toBe(403);
    expect((await call('GET', '/staff/finance/orders', plain.headers)).status).toBe(403);
    expect((await call('GET', '/staff/finance/orders', viewer.headers)).status).toBe(200);
    expect((await call('GET', '/staff/finance/orders', admin.headers)).status).toBe(200);
    for (const query of [
      'from=ontem',
      'status=inventado',
      'courseId=x',
      'limit=1',
      "to=2026-10-14'",
    ]) {
      expect(
        (await call('GET', `/staff/finance/orders?${query}`, viewer.headers)).status,
        query,
      ).toBe(400);
    }
  });

  it('mostra pedido, pagamento e pagador MASCARADO; o recebido NÃO inclui o pendente; o CPF nunca vai na resposta', async () => {
    fresh();
    const viewer = await newPerson({ role: 'support', grants: ['finance.view'] });
    const offerId = await paidOffer(25_000);
    const paid = await order({ offerId });
    reader.customers.set(paid.customerId!, { name: 'Maria da Silva', document: CPF });
    await confirm(paid.pay.id);
    const pending = await order({ offerId, pay: false });

    const response = await call(
      'GET',
      `/staff/finance/orders?courseId=${courseId}&status=paid`,
      viewer.headers,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    const row = body.orders.find((item: any) => item.orderId === paid.orderId);
    expect(row).toMatchObject({
      status: 'paid',
      priceCents: 25_000,
      method: 'pix',
      paymentCount: 1,
      payerName: 'Maria da Silva',
      payerDocumentMasked: '•••.•••.•••-09',
    });
    expect(row.revealablePaymentId).toBe((await localPayment(paid.pay.id)).id);
    expect(JSON.stringify(body)).not.toContain(CPF);
    expect(JSON.stringify(body)).not.toContain(CPF_FORMATTED);
    expect(body.orders.some((item: any) => item.orderId === pending.orderId)).toBe(false);

    // totais do filtro inteiro: pago e pendente SEPARADOS
    const all = await json(
      await call('GET', `/staff/finance/orders?courseId=${courseId}`, viewer.headers),
    );
    expect(all.summary.paidCents).toBeGreaterThanOrEqual(25_000);
    expect(all.summary.pendingCents).toBeGreaterThanOrEqual(25_000);
    const only = await json(
      await call('GET', `/staff/finance/orders?courseId=${crypto.randomUUID()}`, viewer.headers),
    );
    expect(only.summary).toEqual({
      paidCents: 0,
      paidCount: 0,
      refundedCents: 0,
      refundedCount: 0,
      pendingCents: 0,
      pendingCount: 0,
    });
    expect(only.orders).toEqual([]);
  });

  it('filtros: período em dias de São Paulo, estado e curso', async () => {
    fresh();
    const viewer = await newPerson({ role: 'support', grants: ['finance.view'] });
    const { orderId } = await order();
    const q = async (query: string) =>
      json(await call('GET', `/staff/finance/orders?${query}`, viewer.headers));
    expect(
      (await q('from=2026-10-14&to=2026-10-14')).orders.some(
        (item: any) => item.orderId === orderId,
      ),
    ).toBe(true);
    expect((await q('from=2026-10-15')).orders.some((item: any) => item.orderId === orderId)).toBe(
      false,
    );
    expect((await q('to=2026-10-13')).orders.some((item: any) => item.orderId === orderId)).toBe(
      false,
    );
    expect((await q('status=pending')).orders.some((item: any) => item.orderId === orderId)).toBe(
      true,
    );
    expect((await q('status=refunded')).orders.some((item: any) => item.orderId === orderId)).toBe(
      false,
    );
    expect(
      (await q(`courseId=${courseId}`)).orders.some((item: any) => item.orderId === orderId),
    ).toBe(true);
  });
});

describe('revelar o CPF/CNPJ', () => {
  async function withDocument() {
    const { pay, customerId, orderId } = await order();
    reader.customers.set(customerId!, { name: 'Maria', document: CPF });
    await confirm(pay.id);
    return { orderId, paymentId: (await localPayment(pay.id)).id };
  }
  const reveal = (who: Person | undefined, paymentId: string) =>
    call('POST', `/staff/finance/payments/${paymentId}/reveal-document`, who?.headers);

  it('exige finance.view e reautenticação recente; sem eles 401/403 e nada é revelado nem auditado', async () => {
    fresh();
    const { paymentId } = await withDocument();
    const plain = await newPerson({ role: 'support', reauth: true });
    const noReauth = await newPerson({ role: 'support', grants: ['finance.view'] });
    expect((await reveal(undefined, paymentId)).status).toBe(401);
    expect((await reveal(plain, paymentId)).status).toBe(403);
    const blocked = await reveal(noReauth, paymentId);
    expect(blocked.status).toBe(403);
    expect(await json(blocked)).toEqual({ error: { code: 'reauth_required' } });
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'finance.document.reveal'));
    expect(audits.filter((entry) => entry.targetId === paymentId)).toHaveLength(0);
  });

  it('revela o documento formatado, sem cache, e audita ANTES: quem e qual pagamento, NUNCA o número', async () => {
    fresh();
    const { paymentId, orderId } = await withDocument();
    const staff = await newPerson({ role: 'support', grants: ['finance.view'], reauth: true });
    const response = await reveal(staff, paymentId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await json(response)).toEqual({ document: CPF_FORMATTED });
    const [audit] = await tools.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'finance.document.reveal'),
          eq(schema.auditLog.targetId, paymentId),
        ),
      );
    expect(audit).toMatchObject({ actorId: staff.id, targetType: 'payment' });
    expect(audit!.details).toEqual({ orderId });
    expect(JSON.stringify(audit)).not.toContain(CPF);
    // cada revelação é uma linha de auditoria
    await reveal(staff, paymentId);
    const all = await tools.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'finance.document.reveal'),
          eq(schema.auditLog.targetId, paymentId),
        ),
      );
    expect(all).toHaveLength(2);
  });

  it('pagamento sem documento ou inexistente: 404 igual; id malformado 404; cofre sem chave ou chave errada: 503 e SEM auditoria', async () => {
    fresh();
    const staff = await newPerson({ role: 'support', grants: ['finance.view'], reauth: true });
    const { pay } = await order();
    await confirm(pay.id);
    const noDoc = await reveal(staff, (await localPayment(pay.id)).id);
    const missing = await reveal(staff, crypto.randomUUID());
    expect(noDoc.status).toBe(404);
    expect(await json(noDoc)).toEqual(await json(missing));
    expect((await reveal(staff, 'nao-uuid')).status).toBe(404);

    const { paymentId } = await withDocument();
    const before = (
      await tools.db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'finance.document.reveal'))
    ).length;
    vaultKey = undefined;
    expect((await reveal(staff, paymentId)).status).toBe(503);
    vaultKey = OTHER_KEY;
    const wrong = await reveal(staff, paymentId);
    expect(wrong.status).toBe(503);
    expect(JSON.stringify(await json(wrong))).not.toContain(CPF);
    const after = (
      await tools.db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'finance.document.reveal'))
    ).length;
    expect(after).toBe(before);
  });

  it('a cifra é amarrada ao pagamento: copiar o texto cifrado para OUTRO pagamento não abre', async () => {
    fresh();
    const a = await withDocument();
    const b = await withDocument();
    const [source] = await tools.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.id, a.paymentId));
    await tools.db
      .update(schema.payment)
      .set({
        payerDocumentCiphertext: source!.payerDocumentCiphertext,
        payerDocumentNonce: source!.payerDocumentNonce,
        payerDocumentKeyVersion: source!.payerDocumentKeyVersion,
      })
      .where(eq(schema.payment.id, b.paymentId));
    const staff = await newPerson({ role: 'support', grants: ['finance.view'], reauth: true });
    expect((await reveal(staff, a.paymentId)).status).toBe(200);
    expect((await reveal(staff, b.paymentId)).status).toBe(503);
  });
});
