import { and, count, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { financialEvent, purchaseOrder } from '../../db/schema';
import {
  MAX_ORDER_CHECKS,
  type OrderDto,
  type OrderStatus,
} from '../../features/commerce/commerce';
import { recordFinancialEventIn } from './order-store';
import { reconcileOrderSession } from './payment-evidence-store';
import type { ProviderPayment } from '../../features/commerce/payment-evidence';
import type { PaymentReader } from './payment-reader';

/**
 * O pedido como a PESSOA dona o vê (M6-07): estado resumido, nada interno (sem id do provider, sem pagamento, sem
 * revisão). O pedido de outra pessoa é indistinguível de um pedido que não existe.
 */
function toDto(row: typeof purchaseOrder.$inferSelect): OrderDto {
  return {
    id: row.id,
    status: row.status as OrderStatus,
    courseTitle: row.courseTitle,
    priceCents: row.priceCents,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function getOrderForUser(
  db: Database,
  userId: string,
  orderId: string,
): Promise<OrderDto | null> {
  const [row] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, orderId), eq(purchaseOrder.userId, userId)));
  return row ? toDto(row) : null;
}

/**
 * A página de retorno chama o MESMO caso de uso uma vez: lê os pagamentos da sessão na API e aplica a evidência.
 * Limite de `MAX_ORDER_CHECKS` leituras por pedido (cada uma gasta cota do Asaas): passado o limite, só devolve o
 * estado atual. Devolve `null` se o pedido não é da pessoa. Falha do Asaas sobe ao chamador (a rota responde 503).
 */
export async function checkOrderForUser(
  db: Database,
  deps: {
    reader: PaymentReader;
    now?: () => Date;
    afterGrant?: (db: Database, read: ProviderPayment) => Promise<void>;
  },
  input: { userId: string; orderId: string },
): Promise<{ order: OrderDto; limited: boolean } | null> {
  const current = await getOrderForUser(db, input.userId, input.orderId);
  if (!current) return null;
  const [checks] = await db
    .select({ total: count() })
    .from(financialEvent)
    .where(and(eq(financialEvent.orderId, input.orderId), eq(financialEvent.kind, 'order.check')));
  if ((checks?.total ?? 0) >= MAX_ORDER_CHECKS) return { order: current, limited: true };
  await db.transaction((tx) =>
    recordFinancialEventIn(tx, { orderId: input.orderId, kind: 'order.check', source: 'api' }),
  );
  await reconcileOrderSession(db, deps, { orderId: input.orderId, source: 'api' });
  return { order: (await getOrderForUser(db, input.userId, input.orderId))!, limited: false };
}
