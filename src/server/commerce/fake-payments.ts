import type { ProviderPayment } from '../../features/commerce/payment-evidence';
import { PaymentReadTransientError, type PaymentReader } from './payment-reader';

/**
 * Dublê da leitura de pagamentos do Asaas (M6-07), só para testes e desenvolvimento sem conta. O teste "cria" e
 * altera pagamentos como o Asaas faria e programa falhas; `reads` conta as consultas (o limite de consultas é regra).
 */
export interface FakePaymentReader extends PaymentReader {
  /** Pagamentos existentes do lado do provider, por id. */
  readonly payments: Map<string, ProviderPayment>;
  /** Cria ou substitui um pagamento. */
  set(payment: Partial<ProviderPayment> & { id: string }): ProviderPayment;
  /** Consultas feitas: `getPayment` e `listPaymentIds`. */
  readonly reads: string[];
  /** Pagadores existentes do lado do provider, por id do cliente. */
  readonly customers: Map<string, { name: string | null; document: string | null }>;
  /** Falha infra programada nas próximas N leituras (rede, 429, 5xx). */
  failNext: number;
  /** O motivo da falha programada (`network`, `http_429`, `http_503`...). */
  failReason: string;
  /** Espera antes de responder (para corridas). */
  delayMs: number;
}

export function createFakePaymentReader(): FakePaymentReader {
  const reader: FakePaymentReader = {
    payments: new Map(),
    customers: new Map(),
    reads: [],
    failNext: 0,
    failReason: 'network',
    delayMs: 0,
    set(payment) {
      const merged: ProviderPayment = {
        status: 'PENDING',
        billingType: 'PIX',
        valueCents: 19_700,
        totalCents: payment.valueCents ?? 19_700,
        checkoutSessionId: null,
        installmentId: null,
        externalReference: null,
        paidAt: null,
        customerId: null,
        ...reader.payments.get(payment.id),
        ...payment,
      };
      reader.payments.set(payment.id, merged);
      return merged;
    },
    async getPayment(paymentId) {
      reader.reads.push(`payment:${paymentId}`);
      if (reader.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, reader.delayMs));
      if (reader.failNext > 0) {
        reader.failNext -= 1;
        throw new PaymentReadTransientError(reader.failReason);
      }
      const found = reader.payments.get(paymentId);
      return found ? { ...found } : null;
    },
    async getCustomer(customerId) {
      reader.reads.push(`customer:${customerId}`);
      if (reader.failNext > 0) {
        reader.failNext -= 1;
        throw new PaymentReadTransientError(reader.failReason);
      }
      const found = reader.customers.get(customerId);
      return found ? { ...found } : null;
    },
    async listPaymentIds(checkoutSessionId) {
      reader.reads.push(`session:${checkoutSessionId}`);
      if (reader.failNext > 0) {
        reader.failNext -= 1;
        throw new PaymentReadTransientError(reader.failReason);
      }
      return [...reader.payments.values()]
        .filter((payment) => payment.checkoutSessionId === checkoutSessionId)
        .map((payment) => payment.id);
    },
  };
  return reader;
}
