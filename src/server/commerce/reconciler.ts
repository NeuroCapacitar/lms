import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { checkoutSession, financialReview, payment, purchaseOrder } from '../../db/schema';
import {
  INTERMEDIATE_PROVIDER_STATUSES,
  RECONCILE_MAX_ORDERS_PER_RUN,
  RECONCILE_MAX_PAYMENTS_PER_RUN,
  RECONCILE_MIN_AGE_MS,
  reconcileBackoffMs,
} from '../../features/commerce/commerce';
import type { ProviderPayment } from '../../features/commerce/payment-evidence';
import type { DomainTx } from '../async/outbox-store';
import { recordFinancialEventIn, transitionOrderIn } from './order-store';
import { applyPaymentEvidence } from './payment-evidence-store';
import { PaymentReadTransientError, type PaymentReader } from './payment-reader';

/**
 * Reconciliação (M6-04): resolve o que o webhook não resolveu gastando POUCAS consultas ao Asaas. Roda no Cron e só
 * toca: (1) pedidos `pending` com sessão ativa há mais de 10 minutos e vencimento do backoff (consulta
 * `GET /v3/payments?checkoutSession=` pelo id EXATO da sessão); (2) pagamentos em estado intermediário. Sem varredura
 * cega. Cada execução tem teto de pedidos e de pagamentos; 429 ou falha do Asaas INTERROMPE o lote.
 *
 * Só marca o pedido `expired` depois de confirmar que a API não mostra pagamento algum da sessão. Sessão sem id do
 * provider (a chamada de criação teve resultado incerto) NUNCA expira sozinha: vira revisão `uncertain_result`,
 * porque o pagamento pode existir do outro lado sem que o Hub saiba a sessão.
 */
export interface ReconcileResult {
  /** Pedidos consultados. */
  orders: number;
  /** Pagamentos relidos. */
  payments: number;
  /** Pedidos marcados `expired` depois de confirmar que não há pagamento. */
  expired: number;
  /** Revisões abertas por incerteza. */
  uncertain: number;
  /** O lote parou por 429 (esperado, sem erro) ou por falha do provider. */
  stopped: 'rate_limited' | 'provider_unavailable' | null;
}

interface Deps {
  reader: PaymentReader;
  now: Date;
  afterGrant?: (db: Database, read: ProviderPayment) => Promise<void>;
}

const ACTIVE_STATES = ['creating', 'open', 'unknown'] as const;

/** Há algo a reconciliar agora? (sonda barata do Cron: não acorda o job à toa) */
export async function hasReconcileWork(db: Database, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - RECONCILE_MIN_AGE_MS);
  const [order] = await db
    .select({ id: purchaseOrder.id })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.status, 'pending'),
        lt(purchaseOrder.createdAt, cutoff),
        or(isNull(purchaseOrder.reconcileNextAt), lt(purchaseOrder.reconcileNextAt, now)),
      ),
    )
    .limit(1);
  if (order) return true;
  const [intermediate] = await db
    .select({ id: payment.id })
    .from(payment)
    .where(
      and(
        inArray(payment.providerStatus, [...INTERMEDIATE_PROVIDER_STATUSES]),
        lt(payment.updatedAt, new Date(now.getTime() - 3_600_000)),
        gt(payment.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
      ),
    )
    .limit(1);
  return intermediate !== undefined;
}

async function scheduleNext(
  db: Database,
  order: { id: string; reconcileAttempts: number },
  now: Date,
): Promise<void> {
  await db
    .update(purchaseOrder)
    .set({
      reconcileAttempts: order.reconcileAttempts + 1,
      reconcileNextAt: new Date(now.getTime() + reconcileBackoffMs(order.reconcileAttempts)),
    })
    .where(eq(purchaseOrder.id, order.id));
}

async function expireOrder(tx: DomainTx, orderId: string): Promise<boolean> {
  const [locked] = await tx
    .select({ status: purchaseOrder.status })
    .from(purchaseOrder)
    .where(eq(purchaseOrder.id, orderId))
    .for('update');
  // Outra execução (webhook, retorno) pode ter decidido o pedido entre a leitura e aqui.
  if (!locked || locked.status !== 'pending') return false;
  await transitionOrderIn(tx, {
    orderId,
    to: 'expired',
    source: 'reconciliation',
    details: { confirmedNoPayment: true },
  });
  await tx
    .update(checkoutSession)
    .set({ state: 'expired' })
    .where(
      and(eq(checkoutSession.orderId, orderId), inArray(checkoutSession.state, [...ACTIVE_STATES])),
    );
  return true;
}

export async function reconcilePending(db: Database, deps: Deps): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    orders: 0,
    payments: 0,
    expired: 0,
    uncertain: 0,
    stopped: null,
  };
  const { now } = deps;
  const cutoff = new Date(now.getTime() - RECONCILE_MIN_AGE_MS);

  const orders = await db
    .select({
      id: purchaseOrder.id,
      expiresAt: purchaseOrder.expiresAt,
      reconcileAttempts: purchaseOrder.reconcileAttempts,
    })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.status, 'pending'),
        lt(purchaseOrder.createdAt, cutoff),
        or(isNull(purchaseOrder.reconcileNextAt), lt(purchaseOrder.reconcileNextAt, now)),
      ),
    )
    .orderBy(asc(sql`coalesce(${purchaseOrder.reconcileNextAt}, ${purchaseOrder.createdAt})`))
    .limit(RECONCILE_MAX_ORDERS_PER_RUN);

  try {
    for (const order of orders) {
      result.orders += 1;
      const sessions = await db
        .select({ id: checkoutSession.id, providerSessionId: checkoutSession.providerSessionId })
        .from(checkoutSession)
        .where(
          and(
            eq(checkoutSession.orderId, order.id),
            inArray(checkoutSession.state, [...ACTIVE_STATES]),
          ),
        );
      const withoutId = sessions.some((session) => !session.providerSessionId);

      let paymentIds: string[] = [];
      for (const session of sessions) {
        if (session.providerSessionId) {
          paymentIds.push(...(await deps.reader.listPaymentIds(session.providerSessionId)));
        }
      }
      paymentIds = [...new Set(paymentIds)];
      for (const paymentId of paymentIds) {
        await applyPaymentEvidence(
          db,
          { reader: deps.reader, now: () => now, afterGrant: deps.afterGrant },
          { paymentId, eventHint: null, source: 'reconciliation' },
        );
        result.payments += 1;
      }

      const [current] = await db
        .select({ status: purchaseOrder.status })
        .from(purchaseOrder)
        .where(eq(purchaseOrder.id, order.id));
      if (current?.status === 'pending' && now.getTime() >= order.expiresAt.getTime()) {
        if (withoutId) {
          // Não dá para provar que NÃO houve pagamento: a Staff decide.
          await db.transaction(async (tx) => {
            await tx
              .insert(financialReview)
              .values({
                orderId: order.id,
                providerPaymentId: null,
                type: 'uncertain_result',
                reason: 'session_without_provider_id',
                details: { orderStatusBefore: 'pending' },
              })
              .onConflictDoNothing();
            await recordFinancialEventIn(tx, {
              orderId: order.id,
              kind: 'review.opened',
              source: 'reconciliation',
              providerEventId: `${order.id}:uncertain_result`,
              details: { type: 'uncertain_result', reason: 'session_without_provider_id' },
            });
            await transitionOrderIn(tx, {
              orderId: order.id,
              to: 'review',
              source: 'reconciliation',
            });
          });
          result.uncertain += 1;
          continue;
        }
        // Todos os pagamentos da sessão (se houver) já são só "vencidos"? Então não há o que esperar.
        const open = await db
          .select({ id: payment.id })
          .from(payment)
          .innerJoin(checkoutSession, eq(checkoutSession.id, payment.checkoutSessionId))
          .where(
            and(
              eq(checkoutSession.orderId, order.id),
              inArray(payment.providerStatus, [...INTERMEDIATE_PROVIDER_STATUSES]),
            ),
          );
        if (open.length === 0 && (await db.transaction((tx) => expireOrder(tx, order.id)))) {
          result.expired += 1;
          continue;
        }
      }
      await scheduleNext(db, order, now);
    }

    // Pagamentos em estado intermediário (poucos e espaçados: o `updated_at` só muda quando o estado muda, então
    // a releitura é "tocada" para só voltar a valer depois de 1 hora).
    const stale = await db
      .select({ id: payment.id, providerPaymentId: payment.providerPaymentId })
      .from(payment)
      .where(
        and(
          inArray(payment.providerStatus, [...INTERMEDIATE_PROVIDER_STATUSES]),
          lt(payment.updatedAt, new Date(now.getTime() - 3_600_000)),
          gt(payment.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
        ),
      )
      .orderBy(asc(payment.updatedAt))
      .limit(RECONCILE_MAX_PAYMENTS_PER_RUN);
    for (const item of stale) {
      await applyPaymentEvidence(
        db,
        { reader: deps.reader, now: () => now, afterGrant: deps.afterGrant },
        { paymentId: item.providerPaymentId, eventHint: null, source: 'reconciliation' },
      );
      result.payments += 1;
      await db.update(payment).set({ updatedAt: now }).where(eq(payment.id, item.id));
    }
  } catch (error) {
    if (error instanceof PaymentReadTransientError) {
      // 429 é esperado (o Asaas pede calma): para o lote sem tratar como erro do job.
      result.stopped = error.reason === 'http_429' ? 'rate_limited' : 'provider_unavailable';
      return result;
    }
    throw error;
  }
  return result;
}
