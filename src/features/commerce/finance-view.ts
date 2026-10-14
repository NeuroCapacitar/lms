import { z } from 'zod';

import { ORDER_STATUSES, type OrderStatus } from './commerce';

/**
 * Visão financeira da Staff (M6-08), parte PURA: máscara do CPF/CNPJ, filtros e DTOs. O CPF/CNPJ é dado pessoal: só
 * existe no banco CIFRADO, aparece MASCARADO por padrão e revelar completo grava auditoria (sem o número). Nada aqui
 * guarda nem devolve o número em claro.
 */

/** Só os dígitos de um CPF (11) ou CNPJ (14); qualquer outra coisa vira `null` (o Asaas pode não devolver o documento). */
export function normalizeDocument(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replaceAll(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? digits : null;
}

/** `•••.•••.•••-09` (CPF) ou `••.•••.•••/••••-34` (CNPJ): só os 2 últimos dígitos aparecem. */
export function maskDocument(digits: string): string {
  const last = digits.slice(-2);
  return digits.length === 14 ? `••.•••.•••/••••-${last}` : `•••.•••.•••-${last}`;
}

/** O documento formatado para exibir (só depois de revelar com auditoria). */
export function formatDocument(digits: string): string {
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Filtros da lista: período (dias de São Paulo), curso e estado. Todos opcionais; valor inválido é 400. */
export const financeOrdersQuerySchema = z.strictObject({
  from: day.optional(),
  to: day.optional(),
  courseId: z.uuid().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
});
export type FinanceOrdersQuery = z.infer<typeof financeOrdersQuerySchema>;

/** Início do dia (00:00) e fim do dia (23:59:59.999) em São Paulo (UTC-3, sem horário de verão). */
export function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000-03:00`);
}
export function dayEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999-03:00`);
}

export interface FinanceOrderRowDto {
  orderId: string;
  createdAt: string;
  status: OrderStatus;
  courseTitle: string;
  offerName: string;
  priceCents: number;
  buyerName: string;
  /** Forma de pagamento da cobrança confirmada, ou `null` se não há pagamento. */
  method: 'pix' | 'card' | null;
  paidAt: string | null;
  /** Quantas cobranças o pedido tem (cartão parcelado = várias). */
  paymentCount: number;
  payerName: string | null;
  /** Máscara do CPF/CNPJ, ou `null` ("não informado" ou ainda não lido). */
  payerDocumentMasked: string | null;
  /** Id do pagamento local cujo documento pode ser revelado (com auditoria), ou `null`. */
  revealablePaymentId: string | null;
}

/** "Recebido" NÃO inclui o potencial dos checkouts abertos: o pendente vai separado. */
export interface FinanceSummaryDto {
  paidCents: number;
  paidCount: number;
  refundedCents: number;
  refundedCount: number;
  pendingCents: number;
  pendingCount: number;
}
