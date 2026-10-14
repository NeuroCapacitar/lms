import { z } from 'zod';

/**
 * Comércio (M6-01): Order, CheckoutSession e Payment são coisas DISTINTAS. O Order guarda para sempre as condições
 * do momento da compra (snapshot); o preço NUNCA vem do cliente. Puro: sem rede, sem banco. Dinheiro é sempre em
 * centavos inteiros (BRL); a conversão decimal só existe na borda com o Asaas (M6-02).
 */

/** Preço mínimo de uma Offer paga e valor mínimo de cada parcela: R$ 10,00. */
const MIN_PAID_PRICE_CENTS = 1000;
const MIN_INSTALLMENT_CENTS = 1000;
const MAX_PAID_INSTALLMENTS = 12;

/** Quanto tempo um Order e a sessão de checkout ficam abertos. */
export const ORDER_TTL_MINUTES = 60;

/** Meios de pagamento fixos (sem boleto). */
const PAYMENT_METHODS = ['pix', 'card'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Maior número de parcelas que o preço permite: no máximo 12 e nunca parcela abaixo de R$ 10,00. */
export function maxInstallmentsForPrice(priceCents: number): number {
  if (!Number.isSafeInteger(priceCents) || priceCents < MIN_PAID_PRICE_CENTS) return 0;
  return Math.min(MAX_PAID_INSTALLMENTS, Math.floor(priceCents / MIN_INSTALLMENT_CENTS));
}

/**
 * Regras de PUBLICAÇÃO (ativação) da Offer paga: preço de pelo menos R$ 10,00 e parcelas de 1 até o limite do preço.
 * Devolve os campos com problema (vazio = pode publicar). Offer gratuita não passa por aqui.
 */
export function validatePaidPublication(offer: {
  priceCents: number;
  maxInstallments: number;
  accessMonths: number;
}): string[] {
  const problems: string[] = [];
  if (!Number.isSafeInteger(offer.priceCents) || offer.priceCents < MIN_PAID_PRICE_CENTS) {
    problems.push('priceCents');
  }
  if (!Number.isInteger(offer.accessMonths) || offer.accessMonths < 1) {
    problems.push('accessMonths');
  }
  const limit = maxInstallmentsForPrice(offer.priceCents);
  if (
    !Number.isInteger(offer.maxInstallments) ||
    offer.maxInstallments < 1 ||
    offer.maxInstallments > limit
  ) {
    problems.push('maxInstallments');
  }
  return problems;
}

/** Estados do Order. `paid`, `expired`, `canceled`, `refunded` e `disputed` não voltam a `pending`. */
export const ORDER_STATUSES = [
  'pending',
  'paid',
  'expired',
  'canceled',
  'refund_requested',
  'refunded',
  'disputed',
  'review',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Transições permitidas, explícitas. `review` é o desvio para a Staff (divergência, correlação incerta): sai dele para
 * o estado que a revisão decidir. `refunded` é terminal. Qualquer outra transição é erro de domínio.
 */
const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'expired', 'canceled', 'review'],
  paid: ['refund_requested', 'disputed', 'review'],
  expired: ['review'],
  canceled: ['review'],
  refund_requested: ['refunded', 'paid', 'review'],
  refunded: [],
  disputed: ['paid', 'refunded', 'review'],
  review: ['pending', 'paid', 'expired', 'canceled', 'refund_requested', 'refunded', 'disputed'],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Transição inválida de Order. */
export class InvalidOrderTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`invalid_order_transition:${from}->${to}`);
  }
}

/** Fontes dos fatos financeiros (proveniência). */
const FINANCIAL_EVENT_SOURCES = ['webhook', 'reconciliation', 'api', 'admin'] as const;
export type FinancialEventSource = (typeof FINANCIAL_EVENT_SOURCES)[number];

/**
 * O que o Order guarda para sempre (sem dado pessoal além do id da pessoa, que fica na própria linha). Vem SEMPRE da
 * Offer e do Course lidos no servidor: o corpo da requisição nunca traz preço, prazo nem parcelas.
 */
export interface OrderSnapshot {
  courseTitle: string;
  offerName: string;
  priceCents: number;
  currency: 'BRL';
  accessMonths: number;
  maxInstallments: number;
  methods: readonly PaymentMethod[];
}

export function buildOrderSnapshot(input: {
  courseTitle: string;
  offerName: string;
  priceCents: number;
  accessMonths: number;
  maxInstallments: number;
}): OrderSnapshot {
  return {
    courseTitle: input.courseTitle,
    offerName: input.offerName,
    priceCents: input.priceCents,
    currency: 'BRL',
    accessMonths: input.accessMonths,
    maxInstallments: input.maxInstallments,
    methods: PAYMENT_METHODS,
  };
}

/** Quando o Order vence (60 min depois de criado). */
export function orderExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ORDER_TTL_MINUTES * 60_000);
}

/**
 * Corpo do pedido de compra: SÓ a Offer e a tentativa (UUID gerado pelo cliente para repetir com segurança). Preço,
 * e-mail, callbacks e qualquer outro campo são recusados (`strictObject`).
 */
export const createOrderInputSchema = z.strictObject({
  offerId: z.uuid(),
  attemptId: z.uuid(),
});

/** Quantas leituras da página de retorno cada pedido pode provocar (cada uma gasta cota do Asaas). */
export const MAX_ORDER_CHECKS = 10;

/** O pedido como a pessoa dona o vê: estado resumido, nada interno. */
export interface OrderDto {
  id: string;
  status: OrderStatus;
  courseTitle: string;
  priceCents: number;
  expiresAt: string;
}
