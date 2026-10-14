import { z } from 'zod';

/**
 * Revisão financeira (M6-04), parte compartilhada entre servidor e tela: o corpo da resolução, os tipos que a Staff
 * pode dispensar e o DTO da lista. Sem e-mail, CPF nem id de usuário: só o necessário para decidir.
 */
export const resolveReviewSchema = z.strictObject({
  action: z.enum(['approve', 'reconcile', 'dismiss']),
  reason: z.string().trim().min(5).max(500),
});

/** Tipos que a Staff pode dispensar (não há pagamento para reconciliar ou a anomalia é do lado do provider). */
export const DISMISSABLE_REVIEW_TYPES = [
  'unknown_checkout',
  'event_anomaly',
  'uncertain_result',
] as const;

export const REVIEW_TYPE_LABELS: Record<string, string> = {
  amount_mismatch: 'Valor diferente do pedido',
  terminal_conflict: 'Pagamento em pedido já encerrado',
  event_anomaly: 'Evento ou dado fora do esperado',
  partial_refund: 'Reembolso parcial',
  uncertain_result: 'Resultado incerto ao abrir o pagamento',
  unknown_checkout: 'Pagamento sem pedido correspondente',
  duplicate_purchase: 'Compra em duplicidade',
};

export interface ReviewDto {
  id: string;
  type: string;
  state: string;
  reason: string;
  createdAt: string;
  orderId: string | null;
  orderStatus: string | null;
  courseTitle: string | null;
  priceCents: number | null;
  buyerName: string | null;
  providerPaymentId: string | null;
  observedCents: number | null;
  expectedCents: number | null;
  resolution: string | null;
  resolvedAt: string | null;
}
