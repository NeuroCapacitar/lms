import { and, desc, eq, ne } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { checkoutSession, financialReview, purchaseOrder, user } from '../../db/schema';
import { canTransitionOrder, type OrderStatus } from '../../features/commerce/commerce';
import { statusClassOf } from '../../features/commerce/payment-evidence';
import { DISMISSABLE_REVIEW_TYPES, type ReviewDto } from '../../features/commerce/review';
import { auditEvent } from '../auth/access-store';
import type { DomainTx } from '../async/outbox-store';
import { recordFinancialEventIn, transitionOrderIn } from './order-store';
import { applyReadIn, grantAccess } from './payment-evidence-store';
import type { PaymentReader } from './payment-reader';

/**
 * Revisão financeira (M6-04): a Staff com o grant `finance.review` lista e resolve o que o sistema não pôde decidir.
 * Sempre com MOTIVO e auditoria. Regras: SÓ `amount_mismatch` admite APROVAR (com o valor observado gravado e nenhuma
 * outra revisão aberta no pedido); os demais exigem RECONCILIAR (reler o pagamento e ver se a divergência acabou) ou,
 * quando não há o que reconciliar, DISPENSAR com motivo. Aprovar nunca é a saída de reembolso, disputa ou duplicidade.
 */
export class ReviewNotFoundError extends Error {
  constructor() {
    super('review_not_found');
  }
}
export class ReviewAlreadyResolvedError extends Error {
  constructor() {
    super('review_already_resolved');
  }
}
/** A ação não vale para este tipo de revisão (aprovar só em valor divergente; dispensar só nos tipos sem pagamento). */
export class ReviewActionNotAllowedError extends Error {
  constructor() {
    super('review_action_not_allowed');
  }
}
/** O pagamento ou o valor observado mudou desde que a revisão foi aberta: reabra a decisão com o estado atual. */
export class ReviewStaleError extends Error {
  constructor() {
    super('review_stale');
  }
}
export class OtherOpenReviewsError extends Error {
  constructor() {
    super('other_open_reviews');
  }
}
/** Reconciliar releu o pagamento e a divergência continua: a revisão segue aberta. */
export class ReviewStillDivergentError extends Error {
  constructor() {
    super('review_still_divergent');
  }
}
export class ReviewNotReconcilableError extends Error {
  constructor() {
    super('review_not_reconcilable');
  }
}

export async function listReviews(
  db: Database,
  options: { state?: 'open' | 'resolved' } = {},
): Promise<ReviewDto[]> {
  const rows = await db
    .select({
      review: financialReview,
      orderStatus: purchaseOrder.status,
      courseTitle: purchaseOrder.courseTitle,
      priceCents: purchaseOrder.priceCents,
      buyerName: user.name,
    })
    .from(financialReview)
    .leftJoin(purchaseOrder, eq(purchaseOrder.id, financialReview.orderId))
    .leftJoin(user, eq(user.id, purchaseOrder.userId))
    .where(options.state ? eq(financialReview.state, options.state) : undefined)
    .orderBy(desc(financialReview.createdAt))
    .limit(200);
  return rows.map(({ review, ...order }) => {
    const details = review.details as { observedCents?: number; expectedCents?: number };
    return {
      id: review.id,
      type: review.type,
      state: review.state,
      reason: review.reason,
      createdAt: review.createdAt.toISOString(),
      orderId: review.orderId,
      orderStatus: order.orderStatus,
      courseTitle: order.courseTitle,
      priceCents: order.priceCents,
      buyerName: order.buyerName,
      providerPaymentId: review.providerPaymentId,
      observedCents: details.observedCents ?? null,
      expectedCents: details.expectedCents ?? null,
      resolution: review.resolution,
      resolvedAt: review.resolvedAt?.toISOString() ?? null,
    };
  });
}

interface Deps {
  reader: PaymentReader;
  now?: () => Date;
}

type ReviewRow = typeof financialReview.$inferSelect;
type OrderRow = typeof purchaseOrder.$inferSelect;

async function lockReview(tx: DomainTx, reviewId: string): Promise<ReviewRow> {
  const [review] = await tx
    .select()
    .from(financialReview)
    .where(eq(financialReview.id, reviewId))
    .for('update');
  if (!review) throw new ReviewNotFoundError();
  if (review.state !== 'open') throw new ReviewAlreadyResolvedError();
  return review;
}

async function lockOrder(tx: DomainTx, orderId: string): Promise<OrderRow> {
  const [order] = await tx
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.id, orderId))
    .for('update');
  return order!;
}

async function otherOpenReviews(tx: DomainTx, review: ReviewRow): Promise<number> {
  if (!review.orderId) return 0;
  const others = await tx
    .select({ id: financialReview.id })
    .from(financialReview)
    .where(
      and(
        eq(financialReview.orderId, review.orderId),
        eq(financialReview.state, 'open'),
        ne(financialReview.id, review.id),
      ),
    );
  return others.length;
}

/** Devolve o pedido ao estado de antes da revisão, se ela era a última aberta e o pedido ainda está em `review`. */
async function restoreOrder(tx: DomainTx, review: ReviewRow, order: OrderRow | undefined) {
  if (!order || order.status !== 'review' || (await otherOpenReviews(tx, review)) > 0) return;
  const before = (review.details as { orderStatusBefore?: OrderStatus }).orderStatusBefore;
  if (before && before !== 'review' && canTransitionOrder('review', before)) {
    await transitionOrderIn(tx, { orderId: order.id, to: before, source: 'admin' });
  }
}

async function markResolved(
  tx: DomainTx,
  review: ReviewRow,
  input: { actorId: string; action: string; reason: string; resolution: string },
) {
  await tx
    .update(financialReview)
    .set({
      state: 'resolved',
      resolution: input.resolution,
      resolvedBy: input.actorId,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(financialReview.id, review.id));
  await auditEvent(tx, {
    actorId: input.actorId,
    action: 'finance.review.resolve',
    targetType: 'financial_review',
    targetId: review.id,
    details: { type: review.type, action: input.action, reason: input.reason },
  });
  await recordFinancialEventIn(tx, {
    orderId: review.orderId,
    kind: 'review.resolved',
    source: 'admin',
    details: { reviewId: review.id, type: review.type, action: input.action },
  });
}

/**
 * Resolve uma revisão aberta. A leitura do pagamento (aprovar e reconciliar) acontece FORA de transação; a decisão,
 * com a revisão e o pedido travados. Falha de leitura sobe ao chamador e nada muda.
 */
export async function resolveReview(
  db: Database,
  deps: Deps,
  input: {
    reviewId: string;
    actorId: string;
    action: 'approve' | 'reconcile' | 'dismiss';
    reason: string;
  },
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const [current] = await db
    .select()
    .from(financialReview)
    .where(eq(financialReview.id, input.reviewId));
  if (!current) throw new ReviewNotFoundError();
  if (current.state !== 'open') throw new ReviewAlreadyResolvedError();

  if (input.action === 'dismiss') {
    if (!(DISMISSABLE_REVIEW_TYPES as readonly string[]).includes(current.type)) {
      throw new ReviewActionNotAllowedError();
    }
    await db.transaction(async (tx) => {
      const review = await lockReview(tx, input.reviewId);
      const order = review.orderId ? await lockOrder(tx, review.orderId) : undefined;
      // `uncertain_result`: a Staff conferiu no Asaas que NÃO há pagamento; o pedido é encerrado como cancelado.
      if (review.type === 'uncertain_result' && order && order.status === 'review') {
        // `review → canceled` não está na máquina: passa por `pending`, que ela permite.
        await transitionOrderIn(tx, { orderId: order.id, to: 'pending', source: 'admin' });
        await transitionOrderIn(tx, { orderId: order.id, to: 'canceled', source: 'admin' });
        await tx
          .update(checkoutSession)
          .set({ state: 'expired' })
          .where(and(eq(checkoutSession.orderId, order.id), eq(checkoutSession.state, 'unknown')));
      } else {
        await restoreOrder(tx, review, order);
      }
      await markResolved(tx, review, {
        actorId: input.actorId,
        action: 'dismiss',
        reason: input.reason,
        resolution: `dismissed: ${input.reason}`,
      });
    });
    return;
  }

  if (!current.providerPaymentId) throw new ReviewNotReconcilableError();
  if (input.action === 'approve' && current.type !== 'amount_mismatch') {
    throw new ReviewActionNotAllowedError();
  }
  // Leitura FORA de transação.
  const read = await deps.reader.getPayment(current.providerPaymentId);
  if (!read) throw new ReviewStaleError();

  await db.transaction(async (tx) => {
    const review = await lockReview(tx, input.reviewId);
    const order = review.orderId ? await lockOrder(tx, review.orderId) : undefined;

    if (input.action === 'approve') {
      const observed = (review.details as { observedCents?: number }).observedCents;
      const current_ = statusClassOf(read.status);
      const grantable =
        current_ === 'received' || (current_ === 'confirmed' && read.billingType === 'CREDIT_CARD');
      // O que a Staff aprova é o valor que ficou GRAVADO: se o provider mostra outro, a decisão está velha.
      if (!order || observed === undefined || read.totalCents !== observed || !grantable) {
        throw new ReviewStaleError();
      }
      if (order.status !== 'review') throw new ReviewStaleError();
      if ((await otherOpenReviews(tx, review)) > 0) throw new OtherOpenReviewsError();
      const duplicate = async () => {
        throw new OtherOpenReviewsError();
      };
      await grantAccess(tx, order, read, { source: 'admin', now }, duplicate);
      await markResolved(tx, review, {
        actorId: input.actorId,
        action: 'approve',
        reason: input.reason,
        resolution: `approved: ${input.reason}`,
      });
      return;
    }

    // reconcile: devolve o pedido ao estado anterior (se esta for a última revisão) e reaplica a evidência.
    await restoreOrder(tx, review, order);
    const outcome = await applyReadIn(tx, read, {
      paymentId: read.id,
      eventHint: null,
      source: 'admin',
      now,
    });
    if (outcome.outcome === 'review') throw new ReviewStillDivergentError();
    await markResolved(tx, review, {
      actorId: input.actorId,
      action: 'reconcile',
      reason: input.reason,
      resolution: `reconciled: ${outcome.outcome}`,
    });
  });
}
