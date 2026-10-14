import { decimalToCents, type ProviderPayment } from '../../features/commerce/payment-evidence';

/**
 * Leitura do Payment NA API do Asaas (M6-07): é a ÚNICA fonte do estado do pagamento (o webhook é só uma dica).
 * Porta com duas implementações: o Asaas de verdade (abaixo, NÃO exercitado contra o sandbox real) e o dublê dos
 * testes (`fake-payments.ts`). NUNCA é chamada dentro de transação PG.
 */
export interface PaymentReader {
  /** O pagamento com o valor TOTAL (no cartão parcelado, lê também o parcelamento). `null` = o Asaas não o conhece. */
  getPayment(paymentId: string): Promise<ProviderPayment | null>;
  /** Ids dos pagamentos de uma sessão de checkout (`GET /v3/payments?checkoutSession=`). */
  listPaymentIds(checkoutSessionId: string): Promise<string[]>;
}

/** Falha de infraestrutura (429, 5xx, rede, timeout, resposta ilegível): tentar de novo é seguro. */
export class PaymentReadTransientError extends Error {
  constructor(readonly reason: string) {
    super(`payment_read_transient:${reason}`);
  }
}

/** O Asaas recusou a leitura de forma definitiva (401, 403, 400): repetir não adianta. */
export class PaymentReadPermanentError extends Error {
  constructor(readonly reason: string) {
    super(`payment_read_permanent:${reason}`);
  }
}

const TIMEOUT_MS = 8000;
const LIST_LIMIT = 100;

type Json = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export function createAsaasPaymentReader(input: {
  apiKey: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): PaymentReader {
  const fetcher = input.fetcher ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, '');

  async function get(path: string): Promise<{ status: number; body: Json | null }> {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          access_token: input.apiKey,
          'user-agent': 'neurocapacitar-hub',
        },
        signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaymentReadTransientError(
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
      );
    }
    if (response.status === 404) return { status: 404, body: null };
    if (response.status === 429 || response.status >= 500) {
      throw new PaymentReadTransientError(`http_${response.status}`);
    }
    if (response.status >= 400) throw new PaymentReadPermanentError(`http_${response.status}`);
    const body = (await response.json().catch(() => null)) as Json | null;
    if (!body || typeof body !== 'object') throw new PaymentReadTransientError('unreadable');
    return { status: response.status, body };
  }

  return {
    async getPayment(paymentId) {
      const { body } = await get(`/v3/payments/${encodeURIComponent(paymentId)}`);
      if (!body) return null;
      const id = text(body.id);
      const status = text(body.status);
      const billingType = text(body.billingType);
      const valueCents = decimalToCents(body.value);
      if (!id || !status || !billingType || valueCents === null) {
        throw new PaymentReadTransientError('unreadable_payment');
      }
      const installmentId = text(body.installment) ?? text(body.installmentId);
      let totalCents = valueCents;
      if (installmentId) {
        const { body: installment } = await get(
          `/v3/installments/${encodeURIComponent(installmentId)}`,
        );
        const total = installment ? decimalToCents(installment.value) : null;
        // Sem o total do parcelamento não dá para conferir o valor: tenta de novo mais tarde, nunca libera.
        if (total === null) throw new PaymentReadTransientError('installment_unreadable');
        totalCents = total;
      }
      const paid =
        text(body.confirmedDate) ?? text(body.paymentDate) ?? text(body.clientPaymentDate);
      const paidAt = paid ? new Date(paid) : null;
      return {
        id,
        status,
        billingType,
        valueCents,
        totalCents,
        checkoutSessionId: text(body.checkoutSession),
        installmentId,
        externalReference: text(body.externalReference),
        paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
      };
    },

    async listPaymentIds(checkoutSessionId) {
      const { body } = await get(
        `/v3/payments?checkoutSession=${encodeURIComponent(checkoutSessionId)}&limit=${LIST_LIMIT}`,
      );
      const data = Array.isArray(body?.data) ? (body.data as unknown[]) : [];
      return data.flatMap((item) => {
        const id = text((item as Json | null)?.id);
        return id ? [id] : [];
      });
    },
  };
}
