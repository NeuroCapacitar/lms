import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { payment, purchaseOrder, user } from '../../db/schema';
import type { OrderStatus } from '../../features/commerce/commerce';
import {
  dayEnd,
  dayStart,
  type FinanceOrderRowDto,
  type FinanceOrdersQuery,
  type FinanceSummaryDto,
} from '../../features/commerce/finance-view';

/**
 * Lista financeira da Staff (M6-08): pedidos com o pagamento e o pagador, e os totais do mesmo filtro. O CPF/CNPJ sai
 * SÓ mascarado; o id do pagamento "revelável" existe apenas quando há documento guardado. "Recebido" são os pedidos
 * pagos: o potencial dos checkouts abertos vai separado como "pendente" e nunca entra no recebido.
 */
const LIMIT = 200;

function filtersOf(query: FinanceOrdersQuery) {
  return and(
    query.from ? gte(purchaseOrder.createdAt, dayStart(query.from)) : undefined,
    query.to ? lte(purchaseOrder.createdAt, dayEnd(query.to)) : undefined,
    query.courseId ? eq(purchaseOrder.courseId, query.courseId) : undefined,
    query.status ? eq(purchaseOrder.status, query.status) : undefined,
  );
}

export async function listFinanceOrders(
  db: Database,
  query: FinanceOrdersQuery,
): Promise<{ orders: FinanceOrderRowDto[]; summary: FinanceSummaryDto; truncated: boolean }> {
  const where = filtersOf(query);
  const rows = await db
    .select({ order: purchaseOrder, buyerName: user.name })
    .from(purchaseOrder)
    .innerJoin(user, eq(user.id, purchaseOrder.userId))
    .where(where)
    .orderBy(desc(purchaseOrder.createdAt))
    .limit(LIMIT + 1);
  const page = rows.slice(0, LIMIT);

  const payments = page.length
    ? await db
        .select()
        .from(payment)
        .where(
          inArray(
            payment.orderId,
            page.map((row) => row.order.id),
          ),
        )
        .orderBy(asc(payment.createdAt))
    : [];

  const orders: FinanceOrderRowDto[] = page.map(({ order, buyerName }) => {
    const own = payments.filter((item) => item.orderId === order.id);
    const first = own[0];
    const withDocument = own.find((item) => item.payerDocumentMasked !== null);
    const paidDates = own.flatMap((item) => (item.paidAt ? [item.paidAt.getTime()] : []));
    return {
      orderId: order.id,
      createdAt: order.createdAt.toISOString(),
      status: order.status as OrderStatus,
      courseTitle: order.courseTitle,
      offerName: order.offerName,
      priceCents: order.priceCents,
      buyerName,
      method: first ? (first.method as 'pix' | 'card') : null,
      paidAt: paidDates.length ? new Date(Math.min(...paidDates)).toISOString() : null,
      paymentCount: own.length,
      payerName: own.find((item) => item.payerName !== null)?.payerName ?? null,
      payerDocumentMasked: withDocument?.payerDocumentMasked ?? null,
      revealablePaymentId: withDocument?.id ?? null,
    };
  });

  const totals = await db
    .select({
      status: purchaseOrder.status,
      count: sql<number>`count(*)::int`,
      cents: sql<number>`coalesce(sum(${purchaseOrder.priceCents}), 0)::bigint`,
    })
    .from(purchaseOrder)
    .where(where)
    .groupBy(purchaseOrder.status);
  const of = (status: string) => {
    const found = totals.find((item) => item.status === status);
    return { count: Number(found?.count ?? 0), cents: Number(found?.cents ?? 0) };
  };
  return {
    orders,
    truncated: rows.length > LIMIT,
    summary: {
      paidCents: of('paid').cents,
      paidCount: of('paid').count,
      refundedCents: of('refunded').cents,
      refundedCount: of('refunded').count,
      pendingCents: of('pending').cents,
      pendingCount: of('pending').count,
    },
  };
}
