import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { isQueuePaused } from '../../src/server/async/flags.ts';
import { createOffer, setOfferStatus } from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createFakeCheckoutProvider } from '../../src/server/commerce/fake-checkout.ts';
import {
  createFakePaymentReader,
  type FakePaymentReader,
} from '../../src/server/commerce/fake-payments.ts';
import { createFakeRefundProvider } from '../../src/server/commerce/fake-refund.ts';
import { applyPaymentEvidence } from '../../src/server/commerce/payment-evidence-store.ts';
import { createRefundHandler, requestRefund } from '../../src/server/commerce/refund-store.ts';
import { queueEmail } from '../../src/server/email/email-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import {
  quarantineQueues,
  releaseQuarantine,
  resyncPaymentsFromProvider,
  supersedePendingEmails,
} from '../../src/server/ops/restore-reconcile.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-05 em Postgres 18 real, com o DUBLÊ do Asaas: a reconciliação depois de restaurar um backup. O "banco restaurado" é o
 * estado de antes (pedido pago, acesso concedido, e-mail pendente); o "mundo" é o Asaas, que andou depois do backup.
 * Prova: quarentena das duas filas; um reembolso feito DEPOIS do backup revoga o acesso e fecha o pedido; o executor de
 * reembolso NÃO reenvia o que já existe no provedor; falha do provedor interrompe e dá para repetir; os e-mails que
 * estavam pendentes saem da fila e ninguém recebe duas vezes.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-14T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let checkoutProvider: ReturnType<typeof createFakeCheckoutProvider>;
let reader: FakePaymentReader;
let courseId: string;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  courseId = (await seedDemoCourse(tools.db)).courseId;
}, 120_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

function fresh() {
  checkoutProvider = createFakeCheckoutProvider();
  reader = createFakePaymentReader();
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
    clock: () => T0,
    checkoutProvider,
    paymentReader: reader,
  });

async function newPerson() {
  seq += 1;
  const user = tools.test.createUser({
    email: `restore${seq}@example.test`,
    name: `Restore ${seq}`,
  });
  await tools.test.saveUser(user);
  await tools.db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, user.id));
  return { id: user.id as string, headers: (await tools.test.login({ userId: user.id })).headers };
}

/** Compra pelo Checkout (dublê) e confirma o pagamento: o estado que o BACKUP guardou (pedido pago, acesso concedido). */
async function paidPurchase(status: 'RECEIVED' | 'PENDING' = 'RECEIVED') {
  const person = await newPerson();
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
  const headers = new Headers(person.headers);
  headers.set('origin', BASE_URL);
  headers.set('content-type', 'application/json');
  const response = await app().request(
    '/api/me/checkout',
    { method: 'POST', headers, body: JSON.stringify({ offerId, attemptId: crypto.randomUUID() }) },
    env(),
  );
  expect(response.status).toBe(200);
  const { orderId } = (await response.json()) as { orderId: string };
  const [session] = await tools.db
    .select()
    .from(schema.checkoutSession)
    .where(eq(schema.checkoutSession.orderId, orderId));
  const pay = reader.set({
    id: `pay_${seq}_${crypto.randomUUID().slice(0, 8)}`,
    checkoutSessionId: session!.providerSessionId!,
    status,
    paidAt: status === 'RECEIVED' ? T0 : null,
  });
  if (status === 'RECEIVED')
    await applyPaymentEvidence(
      tools.db,
      { reader, now: () => T0 },
      { paymentId: pay.id, eventHint: null },
    );
  return { person, orderId, paymentId: pay.id };
}

const orderStatus = async (orderId: string) =>
  (
    await tools.db.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, orderId))
  )[0]!.status;
const purchaseGrant = async (orderId: string) =>
  (
    await tools.db
      .select()
      .from(schema.entitlement)
      .where(
        and(
          eq(schema.entitlement.source, 'purchase'),
          eq(schema.entitlement.sourceRef, `order:${orderId}`),
        ),
      )
  )[0];

describe('quarentena das filas', () => {
  it('pausa as DUAS filas com o motivo na auditoria, é idempotente e a liberação retoma', async () => {
    await quarantineQueues(tools.db, { actorId: 'restore-script', reason: 'restauração de teste' });
    await quarantineQueues(tools.db, { actorId: 'restore-script', reason: 'restauração de teste' });
    expect(await isQueuePaused(tools.db, 'finance')).toBe(true);
    expect(await isQueuePaused(tools.db, 'general')).toBe(true);
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'ops.queue_pause'));
    expect(audits.some((row) => JSON.stringify(row.details).includes('restauração de teste'))).toBe(
      true,
    );

    await releaseQuarantine(tools.db, { actorId: 'restore-script', reason: 'reconciliado' });
    expect(await isQueuePaused(tools.db, 'finance')).toBe(false);
    expect(await isQueuePaused(tools.db, 'general')).toBe(false);
  });
});

describe('releitura dos pagamentos no Asaas', () => {
  it('reembolso feito DEPOIS do backup: o pedido fecha em refunded e o acesso é revogado; o que não mudou fica como está', async () => {
    fresh();
    const refunded = await paidPurchase();
    const unchanged = await paidPurchase();
    expect(await orderStatus(refunded.orderId)).toBe('paid');
    expect((await purchaseGrant(refunded.orderId))?.revokedAt).toBeNull();

    // O mundo andou depois do backup: o estorno aconteceu no painel do Asaas.
    reader.set({ id: refunded.paymentId, status: 'REFUNDED' });
    reader.reads.length = 0;

    const summary = await resyncPaymentsFromProvider(tools.db, { reader, now: () => T0 });
    expect(summary).toMatchObject({ checked: 2, notFound: 0, remaining: 0, stopped: null });
    expect(summary.outcomes).toMatchObject({ refunded: 1, already_granted: 1 });
    expect(reader.reads.filter((read) => read.startsWith('payment:'))).toHaveLength(2);

    expect(await orderStatus(refunded.orderId)).toBe('refunded');
    expect((await purchaseGrant(refunded.orderId))?.revokedAt).not.toBeNull();
    expect(await orderStatus(unchanged.orderId)).toBe('paid');
    expect((await purchaseGrant(unchanged.orderId))?.revokedAt).toBeNull();

    // Repetir não muda nada (o pedido refunded saiu do escopo; o outro continua igual).
    const again = await resyncPaymentsFromProvider(tools.db, { reader, now: () => T0 });
    expect(again.checked).toBe(1);
    expect(await orderStatus(refunded.orderId)).toBe('refunded');
  });

  it('o executor de reembolso NÃO reenvia o que já existe no Asaas (pedido de antes do backup, estorno feito depois)', async () => {
    fresh();
    const purchase = await paidPurchase();
    // O reembolso foi PEDIDO antes do backup (a intenção ficou `requested` no banco restaurado)...
    const refund = await requestRefund(tools.db, {
      orderId: purchase.orderId,
      actorId: purchase.person.id,
      actorIsAdmin: true,
      reason: 'desistência dentro de 7 dias',
      now: T0,
    });
    const [request] = await tools.db
      .select()
      .from(schema.refundRequest)
      .where(eq(schema.refundRequest.orderId, purchase.orderId));
    expect(request?.state).toBe('requested');
    // ...e o estorno JÁ aconteceu no Asaas, depois do backup.
    reader.set({ id: purchase.paymentId, status: 'REFUNDED' });

    await resyncPaymentsFromProvider(tools.db, { reader, now: () => T0 });
    expect(await orderStatus(purchase.orderId)).toBe('refunded');

    // A fila é reaberta e o executor roda a intenção velha: lê o provedor, vê o estorno e NÃO chama o reembolso de novo.
    const provider = createFakeRefundProvider();
    await createRefundHandler({ provider, reader, now: () => T0 })({
      db: tools.db,
      payload: { refundRequestId: refund.id },
      intentId: refund.intentId,
      correlationId: 'c',
      idempotencyKey: `refund:${refund.id}`,
      attempt: 1,
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('falha do provedor INTERROMPE e informa quantos faltam; repetir conclui', async () => {
    fresh();
    await paidPurchase();
    await paidPurchase();
    reader.failNext = 1;
    const first = await resyncPaymentsFromProvider(tools.db, { reader, now: () => T0 });
    expect(first.stopped).toBe('transient');
    expect(first.remaining).toBeGreaterThanOrEqual(1);
    reader.failNext = 0;
    const second = await resyncPaymentsFromProvider(tools.db, { reader, now: () => T0 });
    expect(second.stopped).toBeNull();
    expect(second.remaining).toBe(0);
  });

  it('pagamento que o Asaas já não conhece é contado e NADA muda', async () => {
    fresh();
    const purchase = await paidPurchase();
    reader.payments.delete(purchase.paymentId);
    const summary = await resyncPaymentsFromProvider(tools.db, { reader, now: () => T0 });
    expect(summary.notFound).toBeGreaterThanOrEqual(1);
    expect(await orderStatus(purchase.orderId)).toBe('paid');
  });
});

describe('e-mails pendentes no banco restaurado', () => {
  it('saem da fila (podem já ter sido enviados) e ninguém recebe duas vezes; o resumo diz por modelo', async () => {
    const person = await newPerson();
    const queue = async (template: 'access-granted' | 'purchase-confirmed') =>
      tools.db.transaction((tx) =>
        queueEmail(tx, {
          template,
          recipientUserId: person.id,
          variables:
            template === 'access-granted'
              ? { COURSE_TITLE: 'Curso', EXPIRES_AT: '12/01/2027' }
              : { COURSE_TITLE: 'Curso', AMOUNT_BRL: 'R$ 197,00' },
          dedupeKey: `restore:${template}:${crypto.randomUUID()}`,
          correlationId: 'c',
        }),
      );
    const a = await queue('access-granted');
    const b = await queue('access-granted');
    await queue('purchase-confirmed');
    // Um já estava em processamento (lease vivo) quando o backup foi feito.
    await tools.db.execute(sql`
      update outbox_message set state = 'leased', lease_owner = 'consumidor-antigo', lease_until = now() + interval '5 minutes'
       where payload->>'emailMessageId' = ${a.emailMessageId}`);

    const summary = await supersedePendingEmails(tools.db, { actorId: 'restore-script' });
    expect(summary.total).toBeGreaterThanOrEqual(3);
    expect(summary.byTemplate['access-granted']).toBeGreaterThanOrEqual(2);
    expect(summary.byTemplate['purchase-confirmed']).toBeGreaterThanOrEqual(1);

    const rows = (
      (await tools.db.execute(sql`
        select o.state, o.lease_owner, e.state as email_state, e.last_error_code
          from outbox_message o join email_message e on e.id = (o.payload->>'emailMessageId')::uuid
         where e.id in (${a.emailMessageId}::uuid, ${b.emailMessageId}::uuid)`)) as unknown as {
        rows: {
          state: string;
          lease_owner: string | null;
          email_state: string;
          last_error_code: string;
        }[];
      }
    ).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        state: 'superseded',
        lease_owner: null,
        email_state: 'failed',
        last_error_code: 'restore_superseded',
      });
    }
    // Repetir não acha mais nada.
    expect((await supersedePendingEmails(tools.db, { actorId: 'restore-script' })).total).toBe(0);
    const audit = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'ops.restore_supersede_emails'));
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit)).not.toContain('example.test');
  });
});
