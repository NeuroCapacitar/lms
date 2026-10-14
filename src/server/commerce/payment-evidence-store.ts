import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  checkoutSession,
  entitlement,
  financialReview,
  payment,
  purchaseOrder,
} from '../../db/schema';
import { formatBrl } from '../../features/catalog/money';
import {
  InvalidOrderTransitionError,
  canTransitionOrder,
  type FinancialEventSource,
  type OrderStatus,
} from '../../features/commerce/commerce';
import {
  decideEvidence,
  type ProviderPayment,
  type ReviewType,
} from '../../features/commerce/payment-evidence';
import {
  grantEntitlementIn,
  lockEnrollmentIn,
  revokeEntitlementIn,
} from '../access/entitlement-store';
import type { DomainTx } from '../async/outbox-store';
import { queueEmail } from '../email/email-store';
import { recordFinancialEventIn, transitionOrderIn } from './order-store';
import { completeRefundIn } from './refund-completion';
import type { PaymentReader } from './payment-reader';

/**
 * Caso de uso ÚNICO de evidência de pagamento (M6-07): chamado pelo webhook (pela inbox), pela página de retorno e
 * pelo reconciliador. (a) FORA de transação, lê o Payment na API do Asaas; (b) numa transação, trava o pedido, confere
 * a correlação pela SESSÃO de checkout, o valor contra o snapshot (tolerância zero) e a forma de pagamento, aplica a
 * matriz e acrescenta os fatos. Idempotente: webhook × retorno × reconciliador simultâneos concedem UMA vez. Nunca
 * libera com informação incerta; reembolso e chargeback revogam mesmo com revisão aberta.
 */

type ApplyOutcome =
  | 'granted'
  | 'already_granted'
  | 'waiting'
  | 'refund_started'
  | 'refunded'
  | 'chargeback'
  | 'regression_ignored'
  | 'review'
  | 'not_found';

export interface ApplyResult {
  outcome: ApplyOutcome;
  orderId: string | null;
  reviewType?: ReviewType;
}

interface ApplyDeps {
  reader: PaymentReader;
  now?: () => Date;
  /** Depois da concessão (fora de transação, melhor esforço): lê o pagador (M6-08). Nunca afeta o acesso. */
  afterGrant?: (db: Database, read: ProviderPayment) => Promise<void>;
}

type OrderRowDb = typeof purchaseOrder.$inferSelect;

const METHOD_BY_BILLING: Record<string, 'pix' | 'card'> = { PIX: 'pix', CREDIT_CARD: 'card' };

const purchaseRef = (orderId: string) => `order:${orderId}`;

/** Abre a revisão (no máximo uma ABERTA por tipo, pagamento e pedido) e deixa o fato. */
async function openReview(
  tx: DomainTx,
  input: {
    orderId: string | null;
    paymentId: string;
    type: ReviewType;
    reason: string;
    source: FinancialEventSource;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await tx
    .insert(financialReview)
    .values({
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      type: input.type,
      reason: input.reason,
      details: input.details ?? {},
    })
    .onConflictDoNothing();
  await recordFinancialEventIn(tx, {
    orderId: input.orderId,
    kind: 'review.opened',
    source: input.source,
    providerEventId: `${input.paymentId}:${input.type}:${input.reason}`,
    details: { type: input.type, reason: input.reason, ...input.details },
  });
}

/** Leva o pedido a `review` quando a máquina permite (refunded é final; já em review não repete). */
async function sendToReview(tx: DomainTx, order: OrderRowDb, source: FinancialEventSource) {
  const from = order.status as OrderStatus;
  if (from === 'review' || !canTransitionOrder(from, 'review')) return;
  await transitionOrderIn(tx, { orderId: order.id, to: 'review', source });
}

async function revokePurchase(
  tx: DomainTx,
  order: OrderRowDb,
  reason: 'refund' | 'chargeback',
  now: Date,
): Promise<void> {
  const [granted] = await tx
    .select({ id: entitlement.id })
    .from(entitlement)
    .where(
      and(eq(entitlement.source, 'purchase'), eq(entitlement.sourceRef, purchaseRef(order.id))),
    );
  if (granted) {
    await revokeEntitlementIn(tx, { entitlementId: granted.id, reason, actorId: null, now });
  }
}

/** Vai de `paid` até `target` passando pelos estados intermediários da máquina (paid → refund_requested → refunded). */
async function moveFromPaid(
  tx: DomainTx,
  order: OrderRowDb,
  target: 'refund_requested' | 'refunded' | 'disputed',
  source: FinancialEventSource,
  providerEventId: string,
): Promise<void> {
  let status = order.status as OrderStatus;
  if (status === target) return;
  if (target === 'refunded' && status === 'paid') {
    await transitionOrderIn(tx, { orderId: order.id, to: 'refund_requested', source });
    status = 'refund_requested';
  }
  if (canTransitionOrder(status, target)) {
    await transitionOrderIn(tx, { orderId: order.id, to: target, source, providerEventId });
  } else {
    throw new InvalidOrderTransitionError(status, target);
  }
}

export async function applyPaymentEvidence(
  db: Database,
  deps: ApplyDeps,
  input: { paymentId: string; eventHint: string | null; source?: FinancialEventSource },
): Promise<ApplyResult> {
  const source = input.source ?? 'webhook';
  // (a) Fora de transação: a verdade vem da API do Asaas, não do evento.
  const read = await deps.reader.getPayment(input.paymentId);
  if (!read) return { outcome: 'not_found', orderId: null };
  const now = (deps.now ?? (() => new Date()))();
  const result = await db.transaction((tx) => applyReadIn(tx, read, { ...input, source, now }));
  if (deps.afterGrant && (result.outcome === 'granted' || result.outcome === 'already_granted')) {
    await deps.afterGrant(db, read).catch(() => undefined);
  }
  return result;
}

export async function applyReadIn(
  tx: DomainTx,
  read: ProviderPayment,
  input: { paymentId: string; eventHint: string | null; source: FinancialEventSource; now: Date },
): Promise<ApplyResult> {
  const { source, now } = input;
  const key = `${read.id}`;

  // Correlação pela SESSÃO de checkout (o `externalReference` do Checkout pode vir nulo).
  const [session] = read.checkoutSessionId
    ? await tx
        .select()
        .from(checkoutSession)
        .where(eq(checkoutSession.providerSessionId, read.checkoutSessionId))
    : [];
  if (!session) {
    await openReview(tx, {
      orderId: null,
      paymentId: key,
      type: 'unknown_checkout',
      reason: read.checkoutSessionId ? 'session_not_found' : 'no_session_on_payment',
      source,
    });
    return { outcome: 'review', orderId: null, reviewType: 'unknown_checkout' };
  }
  // Trava o pedido: webhook, retorno e reconciliador entram em fila aqui.
  const [order] = await tx
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.id, session.orderId))
    .for('update');
  if (!order) throw new Error('order_missing_for_session');

  const reviewOutcome = async (
    type: ReviewType,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<ApplyResult> => {
    // `orderStatusBefore` permite devolver o pedido ao estado anterior quando a revisão for resolvida.
    await openReview(tx, {
      orderId: order.id,
      paymentId: key,
      type,
      reason,
      source,
      details: { orderStatusBefore: order.status, ...extra },
    });
    await sendToReview(tx, order, source);
    return { outcome: 'review', orderId: order.id, reviewType: type };
  };

  // Identificador conflitante: o Asaas aponta para OUTRO pedido do Hub.
  if (read.externalReference !== null && read.externalReference !== order.id) {
    return reviewOutcome('event_anomaly', 'external_reference_conflict');
  }
  const method = METHOD_BY_BILLING[read.billingType];
  if (!method || read.valueCents <= 0) {
    return reviewOutcome('event_anomaly', 'payment_shape_not_allowed');
  }

  // O registro local do Payment (único por id do provider).
  const [existing] = await tx
    .select()
    .from(payment)
    .where(and(eq(payment.provider, 'asaas'), eq(payment.providerPaymentId, read.id)));
  if (existing && existing.orderId !== order.id) {
    return reviewOutcome('event_anomaly', 'payment_belongs_to_another_order');
  }
  let local = existing;
  if (!local) {
    [local] = await tx
      .insert(payment)
      .values({
        orderId: order.id,
        checkoutSessionId: session.id,
        providerPaymentId: read.id,
        installmentId: read.installmentId,
        method,
        amountCents: read.valueCents,
        providerStatus: read.status,
        paidAt: read.paidAt,
      })
      .returning();
  }
  const previousStatus = existing ? existing.providerStatus : null;

  const decision = decideEvidence({
    payment: read,
    previousStatus,
    orderStatus: order.status as OrderStatus,
    orderPriceCents: order.priceCents,
    eventHint: input.eventHint,
  });

  if (decision.kind === 'regression_ignored') {
    await recordFinancialEventIn(tx, {
      orderId: order.id,
      paymentId: local!.id,
      kind: 'payment.regression_ignored',
      source,
      details: { from: previousStatus, observed: read.status },
    });
    return { outcome: 'regression_ignored', orderId: order.id };
  }

  // O estado do provider SÓ avança (a regressão foi tratada acima).
  if (previousStatus !== read.status) {
    await tx
      .update(payment)
      .set({
        providerStatus: read.status,
        paidAt: read.paidAt ?? local!.paidAt,
      })
      .where(eq(payment.id, local!.id));
    await recordFinancialEventIn(tx, {
      orderId: order.id,
      paymentId: local!.id,
      kind: 'payment.status',
      source,
      providerEventId: `${read.id}:${read.status}`,
      details: { from: previousStatus, to: read.status },
    });
  }

  switch (decision.kind) {
    case 'wait':
      return { outcome: 'waiting', orderId: order.id };
    case 'review':
      return reviewOutcome(
        decision.type,
        decision.reason,
        // O valor observado fica gravado: é o que a aprovação humana confere (só `amount_mismatch` admite aprovar).
        decision.type === 'amount_mismatch'
          ? {
              observedCents: read.totalCents,
              expectedCents: order.priceCents,
              providerStatus: read.status,
            }
          : {},
      );
    case 'refund_started': {
      if (order.status === 'paid') {
        await moveFromPaid(tx, order, 'refund_requested', source, `${read.id}:${read.status}`);
      }
      return { outcome: 'refund_started', orderId: order.id };
    }
    case 'refunded': {
      if (
        order.status !== 'paid' &&
        order.status !== 'refund_requested' &&
        order.status !== 'refunded' &&
        order.status !== 'disputed'
      ) {
        // Reembolso de um pedido que nunca foi pago aqui: não é estado possível, vai para a revisão.
        return reviewOutcome('terminal_conflict', `refunded_while_${order.status}`);
      }
      await revokePurchase(tx, order, 'refund', now);
      if (order.status !== 'refunded') {
        if (order.status === 'disputed') {
          await transitionOrderIn(tx, { orderId: order.id, to: 'refunded', source });
        } else {
          await moveFromPaid(tx, order, 'refunded', source, `${read.id}:${read.status}`);
        }
      }
      // Se a Staff pediu este reembolso, ele está concluído: fecha o pedido de reembolso e avisa a pessoa (uma vez).
      await completeRefundIn(tx, order, now);
      return { outcome: 'refunded', orderId: order.id };
    }
    case 'chargeback': {
      if (order.status === 'pending' || order.status === 'expired' || order.status === 'canceled') {
        return reviewOutcome('terminal_conflict', `chargeback_while_${order.status}`);
      }
      await revokePurchase(tx, order, 'chargeback', now);
      if (order.status === 'paid' || order.status === 'refund_requested') {
        await moveFromPaid(tx, order, 'disputed', source, `${read.id}:${read.status}`);
      }
      return { outcome: 'chargeback', orderId: order.id };
    }
    case 'grant':
      return grantAccess(tx, order, read, { source, now }, reviewOutcome);
    default:
      return { outcome: 'waiting', orderId: order.id };
  }
}

/** Concede o acesso do pedido (idempotente por pedido). Também usada pela aprovação humana de `amount_mismatch` (M6-04). */
export async function grantAccess(
  tx: DomainTx,
  order: OrderRowDb,
  read: ProviderPayment,
  context: { source: FinancialEventSource; now: Date },
  reviewOutcome: (
    type: ReviewType,
    reason: string,
    extra?: Record<string, unknown>,
  ) => Promise<ApplyResult>,
): Promise<ApplyResult> {
  const { source, now } = context;
  // Serializa as compras da mesma pessoa e curso (a matrícula é a trava) e procura OUTRA compra ainda válida.
  await lockEnrollmentIn(tx, order.userId, order.courseId, now);
  const [other] = await tx
    .select({ id: entitlement.id })
    .from(entitlement)
    .where(
      and(
        eq(entitlement.userId, order.userId),
        eq(entitlement.courseId, order.courseId),
        eq(entitlement.source, 'purchase'),
        ne(entitlement.sourceRef, purchaseRef(order.id)),
        isNull(entitlement.revokedAt),
        sql`${entitlement.expiresAt} > ${now}`,
      ),
    );
  if (other) return reviewOutcome('duplicate_purchase', 'another_purchase_active');

  const granted = await grantEntitlementIn(tx, {
    userId: order.userId,
    courseId: order.courseId,
    offerId: order.offerId,
    source: 'purchase',
    sourceRef: purchaseRef(order.id),
    accessMonths: order.accessMonths,
    startsAt: now,
    grantedBy: null,
  });
  let becamePaid = false;
  if (order.status === 'pending' || order.status === 'review') {
    await transitionOrderIn(tx, {
      orderId: order.id,
      to: 'paid',
      source,
      providerEventId: `${read.id}:${read.status}`,
      details: { paymentId: read.id },
    });
    becamePaid = true;
  }
  await tx
    .update(checkoutSession)
    .set({ state: 'completed' })
    .where(
      and(
        eq(checkoutSession.orderId, order.id),
        sql`${checkoutSession.state} in ('creating', 'open', 'unknown')`,
      ),
    );
  if (granted.created) {
    await recordFinancialEventIn(tx, {
      orderId: order.id,
      kind: 'access.granted',
      source,
      providerEventId: `${read.id}:granted`,
      details: { entitlementId: granted.entitlementId },
    });
  }
  if (becamePaid || granted.created) {
    // Um e-mail só por pedido (a chave de deduplicação garante, mesmo repetindo a concessão).
    await queueEmail(tx, {
      template: 'purchase-confirmed',
      dedupeKey: `purchase-confirmed:${order.id}`,
      recipientUserId: order.userId,
      variables: {
        COURSE_TITLE: order.courseTitle,
        AMOUNT_BRL: formatBrl(order.priceCents).replaceAll(' ', ' '),
      },
      correlationId: crypto.randomUUID(),
    });
  }
  return { outcome: granted.created ? 'granted' : 'already_granted', orderId: order.id };
}

/**
 * Reconcilia UM pedido pela sessão de checkout: lê os pagamentos da sessão na API e aplica a evidência de cada um.
 * Usado pela página de retorno e (M6-04) pelo reconciliador. Falha de leitura sobe ao chamador (que decide tentar
 * de novo); nada é concedido sem a leitura.
 */
export async function reconcileOrderSession(
  db: Database,
  deps: ApplyDeps,
  input: { orderId: string; source: FinancialEventSource },
): Promise<ApplyResult[]> {
  const sessions = await db
    .select({ providerSessionId: checkoutSession.providerSessionId })
    .from(checkoutSession)
    .where(eq(checkoutSession.orderId, input.orderId));
  const results: ApplyResult[] = [];
  for (const { providerSessionId } of sessions) {
    if (!providerSessionId) continue;
    for (const paymentId of await deps.reader.listPaymentIds(providerSessionId)) {
      results.push(
        await applyPaymentEvidence(db, deps, {
          paymentId,
          eventHint: null,
          source: input.source,
        }),
      );
    }
  }
  return results;
}
