import { and, eq, notInArray } from 'drizzle-orm';

import { refundRequest } from '../../db/schema';
import { formatBrl } from '../../features/catalog/money';
import type { DomainTx } from '../async/outbox-store';
import { queueEmail } from '../email/email-store';
import { recordFinancialEventIn } from './order-store';

/**
 * Conclui o pedido de reembolso ATIVO do pedido quando a evidência segura (o Payment relido na API do Asaas) mostra
 * `REFUNDED` (M6-05). Fica em módulo próprio para a evidência de pagamento poder chamá-lo sem ciclo com o executor.
 * Idempotente: sem pedido ativo (reembolso feito por fora no painel do Asaas) não faz nada nem manda e-mail. Um só
 * e-mail `refund-completed` por pedido. O certificado já emitido PERMANECE (nada é revogado aqui).
 */
export async function completeRefundIn(
  tx: DomainTx,
  order: { id: string; userId: string; courseTitle: string; priceCents: number },
  now: Date,
): Promise<boolean> {
  const done = await tx
    .update(refundRequest)
    .set({ state: 'done', completedAt: now })
    .where(
      and(eq(refundRequest.orderId, order.id), notInArray(refundRequest.state, ['done', 'failed'])),
    )
    .returning({ id: refundRequest.id });
  if (done.length === 0) return false;
  await recordFinancialEventIn(tx, {
    orderId: order.id,
    kind: 'refund.completed',
    source: 'reconciliation',
    providerEventId: `${done[0]!.id}:completed`,
    details: { refundRequestId: done[0]!.id },
  });
  await queueEmail(tx, {
    template: 'refund-completed',
    dedupeKey: `refund-completed:${order.id}`,
    recipientUserId: order.userId,
    variables: {
      COURSE_TITLE: order.courseTitle,
      AMOUNT_BRL: formatBrl(order.priceCents).replaceAll(' ', ' '),
    },
    correlationId: crypto.randomUUID(),
  });
  return true;
}
