import type { OrderStatus } from './commerce';

/**
 * Matriz de liberação (M6-07), parte PURA: dado o Payment LIDO NA API do Asaas, o que acontece com o pedido. O evento
 * do webhook é só uma dica; quem decide é o estado relido. Fail-closed: qualquer ambiguidade vira revisão, nunca acesso.
 * Dinheiro em centavos inteiros; o valor decimal do Asaas é convertido na borda (`decimalToCents`).
 */

/** O Payment como o Hub o enxerga depois de ler a API (campos mínimos; nada de dado pessoal). */
export interface ProviderPayment {
  id: string;
  status: string;
  billingType: string;
  /** Valor DESTA cobrança em centavos (cada parcela do cartão é uma cobrança). */
  valueCents: number;
  /** Valor TOTAL do parcelamento em centavos, quando a cobrança é parcela; senão, igual a `valueCents`. */
  totalCents: number;
  checkoutSessionId: string | null;
  installmentId: string | null;
  externalReference: string | null;
  paidAt: Date | null;
}

/** Valor decimal do Asaas para centavos inteiros, sem erro de ponto flutuante (`197.05` vira `19705`). */
export function decimalToCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  // Mais de duas casas decimais não é dinheiro válido: recusa em vez de arredondar em silêncio.
  return Math.abs(value * 100 - cents) < 1e-6 && Number.isSafeInteger(cents) ? cents : null;
}

type StatusClass =
  | 'pending'
  | 'risk_pending'
  | 'confirmed'
  | 'received'
  | 'overdue'
  | 'refund_started'
  | 'refunded'
  | 'chargeback'
  | 'unknown';

const CLASS_BY_STATUS: Record<string, StatusClass> = {
  PENDING: 'pending',
  AWAITING_RISK_ANALYSIS: 'risk_pending',
  CONFIRMED: 'confirmed',
  RECEIVED: 'received',
  RECEIVED_IN_CASH: 'received',
  OVERDUE: 'overdue',
  REFUND_REQUESTED: 'refund_started',
  REFUND_IN_PROGRESS: 'refund_started',
  REFUNDED: 'refunded',
  CHARGEBACK_REQUESTED: 'chargeback',
  CHARGEBACK_DISPUTE: 'chargeback',
  AWAITING_CHARGEBACK_REVERSAL: 'chargeback',
};

/**
 * A ordem do estado do provider na linha principal (só avança). Refund e chargeback são outro grupo: prevalecem sobre
 * a linha principal e nunca contam como regressão.
 */
const MAIN_RANK: Partial<Record<StatusClass, number>> = {
  pending: 0,
  overdue: 0,
  risk_pending: 1,
  confirmed: 2,
  received: 3,
};

export function statusClassOf(status: string): StatusClass {
  return CLASS_BY_STATUS[status] ?? 'unknown';
}

const REVIEW_TYPES = [
  'amount_mismatch',
  'terminal_conflict',
  'event_anomaly',
  'partial_refund',
  'uncertain_result',
  'unknown_checkout',
  'duplicate_purchase',
] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export type EvidenceDecision =
  | { kind: 'grant' }
  /** Nada a fazer agora (pendente, risco em análise, vencida...): não libera nem revoga. */
  | { kind: 'wait' }
  /** O estado do provider voltou atrás na linha principal: ignora e registra. */
  | { kind: 'regression_ignored' }
  | { kind: 'refund_started' }
  | { kind: 'refunded' }
  | { kind: 'chargeback' }
  | { kind: 'review'; type: ReviewType; reason: string };

/**
 * Decide o efeito de UM Payment relido sobre o pedido. `previousStatus` é o estado do provider já guardado.
 * Ordem: dica de reembolso parcial → status desconhecido → reembolso/chargeback (prevalecem e NÃO dependem de valor)
 * → regressão → status que não libera → liberação (Pix só em RECEIVED, cartão em CONFIRMED ou RECEIVED; valor com
 * tolerância ZERO contra o snapshot; só o pedido ainda pendente ou já pago libera).
 */
export function decideEvidence(input: {
  payment: ProviderPayment;
  previousStatus: string | null;
  orderStatus: OrderStatus;
  orderPriceCents: number;
  /** Tipo do evento do webhook (dica); `null` quando a leitura veio do retorno ou do reconciliador. */
  eventHint: string | null;
}): EvidenceDecision {
  const { payment, orderStatus } = input;
  if (input.eventHint === 'PAYMENT_PARTIALLY_REFUNDED') {
    return { kind: 'review', type: 'partial_refund', reason: 'partially_refunded' };
  }
  const current = statusClassOf(payment.status);
  if (current === 'unknown') {
    return { kind: 'review', type: 'event_anomaly', reason: 'unknown_status' };
  }
  if (current === 'refunded') return { kind: 'refunded' };
  if (current === 'refund_started') return { kind: 'refund_started' };
  if (current === 'chargeback') return { kind: 'chargeback' };

  const previous = input.previousStatus ? statusClassOf(input.previousStatus) : null;
  const rankNow = MAIN_RANK[current];
  const rankBefore = previous ? MAIN_RANK[previous] : undefined;
  if (rankNow !== undefined && rankBefore !== undefined && rankNow < rankBefore) {
    return { kind: 'regression_ignored' };
  }
  // O provider estava em refund/chargeback e voltou para a linha principal: não é regressão simples, é conflito.
  if (previous === 'refunded' || previous === 'chargeback' || previous === 'refund_started') {
    return { kind: 'review', type: 'terminal_conflict', reason: `back_from_${previous}` };
  }
  if (current === 'pending' || current === 'risk_pending' || current === 'overdue') {
    return { kind: 'wait' };
  }

  // `confirmed` ou `received`: só falta conferir se ESTA forma de pagamento libera neste estado.
  if (payment.billingType === 'PIX') {
    if (current !== 'received') return { kind: 'wait' };
  } else if (payment.billingType !== 'CREDIT_CARD') {
    return { kind: 'review', type: 'event_anomaly', reason: 'billing_type_not_allowed' };
  }
  if (payment.totalCents !== input.orderPriceCents) {
    return { kind: 'review', type: 'amount_mismatch', reason: 'total_differs_from_snapshot' };
  }
  if (orderStatus === 'pending' || orderStatus === 'paid') return { kind: 'grant' };
  if (orderStatus === 'expired' || orderStatus === 'canceled') {
    return { kind: 'review', type: 'terminal_conflict', reason: `order_${orderStatus}` };
  }
  // review, refund_requested, disputed, refunded: a decisão já é de um humano ou do reembolso.
  return { kind: 'wait' };
}
