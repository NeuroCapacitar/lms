import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/pg-errors';
import {
  enrollment,
  entitlement,
  financialReview,
  payment,
  purchaseOrder,
  refundRequest,
  user,
} from '../../db/schema';
import { refundWindow, type RefundRequestDto } from '../../features/commerce/refund';
import { statusClassOf } from '../../features/commerce/payment-evidence';
import { auditEvent } from '../auth/access-store';
import { DeferError, PermanentError, TransientError } from '../async/handler-types';
import type { HandlerRegistry } from '../async/handler-types';
import { enqueueIntent, type DomainTx } from '../async/outbox-store';
import { recordFinancialEventIn, transitionOrderIn } from './order-store';
import { applyPaymentEvidence } from './payment-evidence-store';
import {
  PaymentReadPermanentError,
  PaymentReadTransientError,
  type PaymentReader,
} from './payment-reader';
import { RefundAmbiguousError, RefundRejectedError, type RefundProvider } from './refund-provider';

/**
 * Reembolso integral (M6-05). A Staff cria o `refund_request` (durável); o executor (`finance.refund`, na fila
 * `finance`) lê do banco, RELÊ o pagamento antes de qualquer chamada e NUNCA chama o provider dentro de transação nem o
 * reenvia às cegas: depois de um resultado incerto só relê. Ao pedir, o acesso é SUSPENSO (fail-closed); falha
 * inequívoca restaura; confirmado (pagamento relido como `REFUNDED`) o direito é revogado pela evidência do M6-07.
 */
export class RefundOrderNotFoundError extends Error {
  constructor() {
    super('order_not_found');
  }
}
/** O pedido não está pago com direito ativo e pagamento reembolsável. */
export class OrderNotRefundableError extends Error {
  constructor() {
    super('order_not_refundable');
  }
}
/** Já passaram os 7 dias: só o Admin reembolsa. */
export class RefundWindowClosedError extends Error {
  constructor() {
    super('refund_window_closed');
  }
}
export class RefundAlreadyActiveError extends Error {
  constructor() {
    super('refund_already_active');
  }
}

const marker = (refundId: string) => `refund:${refundId}`;

/**
 * Cria o pedido de reembolso e, na MESMA transação, suspende o acesso, leva o pedido a `refund_requested`, audita e grava a
 * intenção do executor. Dentro dos 7 dias qualquer Suporte com o grant; depois, só o Admin. Sempre valor integral.
 */
export async function requestRefund(
  db: Database,
  input: {
    orderId: string;
    actorId: string;
    actorIsAdmin: boolean;
    reason: string;
    now?: Date;
  },
): Promise<{ id: string; intentId: string }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.id, input.orderId))
      .for('update');
    if (!order) throw new RefundOrderNotFoundError();
    if (order.status !== 'paid') throw new OrderNotRefundableError();

    const [granted] = await tx
      .select({ startsAt: entitlement.startsAt, revokedAt: entitlement.revokedAt })
      .from(entitlement)
      .where(
        and(eq(entitlement.source, 'purchase'), eq(entitlement.sourceRef, `order:${order.id}`)),
      );
    if (!granted || granted.revokedAt !== null) throw new OrderNotRefundableError();
    const [target] = await tx
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.orderId, order.id),
          inArray(payment.providerStatus, ['RECEIVED', 'CONFIRMED']),
        ),
      )
      .orderBy(payment.createdAt)
      .limit(1);
    if (!target) throw new OrderNotRefundableError();

    // Marco = o momento em que o acesso foi concedido (a confirmação do pagamento vista pelo Hub).
    if (refundWindow(granted.startsAt, now) === 'after' && !input.actorIsAdmin) {
      throw new RefundWindowClosedError();
    }

    let created: typeof refundRequest.$inferSelect;
    try {
      [created] = (await tx
        .insert(refundRequest)
        .values({
          orderId: order.id,
          paymentId: target.id,
          requestedBy: input.actorId,
          reason: input.reason,
        })
        .returning()) as [typeof refundRequest.$inferSelect];
    } catch (error) {
      if (isUniqueViolation(error)) throw new RefundAlreadyActiveError();
      throw error;
    }

    // Fail-closed: o acesso fica suspenso enquanto o reembolso não se resolve.
    await tx
      .update(enrollment)
      .set({ suspendedAt: now, suspendedReason: marker(created.id), suspendedBy: input.actorId })
      .where(
        and(
          eq(enrollment.userId, order.userId),
          eq(enrollment.courseId, order.courseId),
          isNull(enrollment.suspendedAt),
        ),
      );
    await transitionOrderIn(tx, {
      orderId: order.id,
      to: 'refund_requested',
      source: 'admin',
      details: { refundRequestId: created.id },
    });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'refund.request',
      targetType: 'refund_request',
      targetId: created.id,
      details: { orderId: order.id, reason: input.reason },
    });
    const intent = await enqueueIntent(tx, {
      kind: 'finance.refund',
      dedupeKey: marker(created.id),
      payload: { refundRequestId: created.id },
      correlationId: crypto.randomUUID(),
    });
    return { id: created.id, intentId: intent.id };
  });
}

export async function listRefunds(db: Database): Promise<RefundRequestDto[]> {
  const rows = await db
    .select({
      refund: refundRequest,
      courseTitle: purchaseOrder.courseTitle,
      priceCents: purchaseOrder.priceCents,
      buyerName: user.name,
    })
    .from(refundRequest)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, refundRequest.orderId))
    .innerJoin(user, eq(user.id, purchaseOrder.userId))
    .orderBy(desc(refundRequest.createdAt))
    .limit(100);
  return rows.map(({ refund, ...order }) => ({
    id: refund.id,
    orderId: refund.orderId,
    state: refund.state,
    reason: refund.reason,
    courseTitle: order.courseTitle,
    buyerName: order.buyerName,
    priceCents: order.priceCents,
    failureCode: refund.failureCode,
    createdAt: refund.createdAt.toISOString(),
    completedAt: refund.completedAt?.toISOString() ?? null,
  }));
}

/** Devolve o acesso e o pedido ao estado de antes (falha INEQUÍVOCA do reembolso). */
async function restoreAccessIn(tx: DomainTx, refund: typeof refundRequest.$inferSelect) {
  const [order] = await tx
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.id, refund.orderId))
    .for('update');
  if (!order) return;
  // Só reativa se a suspensão foi ESTE reembolso (nunca desfaz uma suspensão da Staff por outro motivo).
  await tx
    .update(enrollment)
    .set({ suspendedAt: null, suspendedReason: null, suspendedBy: null })
    .where(
      and(
        eq(enrollment.userId, order.userId),
        eq(enrollment.courseId, order.courseId),
        eq(enrollment.suspendedReason, marker(refund.id)),
      ),
    );
  if (order.status === 'refund_requested') {
    await transitionOrderIn(tx, { orderId: order.id, to: 'paid', source: 'admin' });
  }
}

interface ExecutorDeps {
  provider: RefundProvider;
  reader: PaymentReader;
  now?: () => Date;
}

/** Handler da intenção `finance.refund` (fila `finance`; lease, fencing e backoff são da outbox). */
export function createRefundHandler(deps: ExecutorDeps): HandlerRegistry['finance.refund'] {
  const nowOf = () => (deps.now ?? (() => new Date()))();

  async function relerPagamento(providerPaymentId: string) {
    try {
      return await deps.reader.getPayment(providerPaymentId);
    } catch (error) {
      if (error instanceof PaymentReadTransientError) throw new TransientError(error.reason);
      if (error instanceof PaymentReadPermanentError) throw new PermanentError(error.reason);
      throw error;
    }
  }

  return async ({ db, payload }) => {
    const [row] = await db
      .select({
        refund: refundRequest,
        providerPaymentId: payment.providerPaymentId,
        installmentId: payment.installmentId,
      })
      .from(refundRequest)
      .innerJoin(payment, eq(payment.id, refundRequest.paymentId))
      .where(eq(refundRequest.id, payload.refundRequestId));
    if (!row) throw new PermanentError('refund_not_found');
    const refund = row.refund;
    if (refund.state === 'done' || refund.state === 'failed') return;

    const evidence = () =>
      applyPaymentEvidence(
        db,
        { reader: deps.reader, now: nowOf },
        { paymentId: row.providerPaymentId, eventHint: null, source: 'reconciliation' },
      );
    const markState = (state: string) =>
      db.update(refundRequest).set({ state }).where(eq(refundRequest.id, refund.id));
    const fail = async (code: string) => {
      await db.transaction(async (tx) => {
        await tx
          .update(refundRequest)
          .set({ state: 'failed', failureCode: code })
          .where(
            and(
              eq(refundRequest.id, refund.id),
              inArray(refundRequest.state, [
                'requested',
                'submitting',
                'unknown',
                'submitted',
                'awaiting_external_authorization',
              ]),
            ),
          );
        await restoreAccessIn(tx, refund);
        await recordFinancialEventIn(tx, {
          orderId: refund.orderId,
          kind: 'refund.failed',
          source: 'api',
          providerEventId: `${refund.id}:failed`,
          details: { refundRequestId: refund.id, code },
        });
      });
    };

    // Já enviado: só aplica a evidência (o reconciliador continua lendo os intermediários).
    if (refund.state === 'submitted' || refund.state === 'awaiting_external_authorization') {
      await evidence();
      return;
    }

    const read = await relerPagamento(row.providerPaymentId);
    if (!read) {
      if (refund.state === 'requested') return fail('payment_not_found');
      throw new DeferError('refund_payment_not_visible', 3600);
    }
    const current = statusClassOf(read.status);

    // O estorno já existe do lado do Asaas (nosso envio anterior, ou feito por fora): só confirma e segue.
    if (current === 'refund_started' || current === 'refunded') {
      await markState('submitted');
      await evidence();
      return;
    }

    // `unknown` ou `submitting` (queda no meio): NUNCA reenvia às cegas. Só relê; sem sinal por 24 h, a Staff decide.
    if (refund.state === 'unknown' || refund.state === 'submitting') {
      if (nowOf().getTime() - refund.updatedAt.getTime() > 24 * 3_600_000) {
        await db.transaction(async (tx) => {
          await tx
            .insert(financialReview)
            .values({
              orderId: refund.orderId,
              providerPaymentId: row.providerPaymentId,
              type: 'uncertain_result',
              reason: 'refund_result_unknown',
              details: { orderStatusBefore: 'refund_requested', refundRequestId: refund.id },
            })
            .onConflictDoNothing();
        });
        return;
      }
      throw new DeferError('refund_unknown_recheck', 3600);
    }

    if (current !== 'received' && current !== 'confirmed') return fail('payment_not_refundable');

    // refund.state === 'requested': marca o envio ANTES de chamar (uma queda aqui vira `submitting`, sem reenvio).
    const claimed = await db
      .update(refundRequest)
      .set({ state: 'submitting' })
      .where(and(eq(refundRequest.id, refund.id), eq(refundRequest.state, 'requested')))
      .returning({ id: refundRequest.id });
    if (claimed.length === 0) return;

    try {
      const accepted = await deps.provider.refund({
        paymentId: row.providerPaymentId,
        installmentId: row.installmentId,
      });
      await markState(
        accepted.status === 'awaiting_authorization'
          ? 'awaiting_external_authorization'
          : 'submitted',
      );
    } catch (error) {
      if (error instanceof RefundRejectedError) return fail(error.code);
      if (error instanceof RefundAmbiguousError) {
        await markState('unknown');
        await recordFailureFact(db, refund, error.reason);
        throw new DeferError('refund_result_unknown', 600);
      }
      throw error;
    }
    await evidence();
  };
}

async function recordFailureFact(
  db: Database,
  refund: typeof refundRequest.$inferSelect,
  reason: string,
) {
  await db.transaction((tx) =>
    recordFinancialEventIn(tx, {
      orderId: refund.orderId,
      kind: 'refund.unknown',
      source: 'api',
      providerEventId: `${refund.id}:unknown`,
      details: { refundRequestId: refund.id, reason },
    }),
  );
}
