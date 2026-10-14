import {
  RefundAmbiguousError,
  RefundRejectedError,
  type RefundAccepted,
  type RefundProvider,
} from './refund-provider';

/**
 * Cliente de reembolso do Asaas (M6-05): `POST /v3/payments/{id}/refund` (ou `/v3/installments/{id}/refund` quando o
 * pagamento é parcela) SEM corpo de valor: o Asaas devolve o total. NÃO foi exercitado contra o sandbox real. A chave
 * vai só no cabeçalho. Classificação: 2xx = aceito; 4xx = recusa conhecida (guarda só o CÓDIGO do erro); 5xx, rede,
 * timeout ou resposta ilegível = AMBÍGUO.
 */
const TIMEOUT_MS = 10_000;
const CODE = /^[A-Za-z0-9_]{1,60}$/;

export function createAsaasRefundProvider(input: {
  apiKey: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): RefundProvider {
  const fetcher = input.fetcher ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, '');
  return {
    async refund(target) {
      const path = target.installmentId
        ? `/v3/installments/${encodeURIComponent(target.installmentId)}/refund`
        : `/v3/payments/${encodeURIComponent(target.paymentId)}/refund`;
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            access_token: input.apiKey,
            'user-agent': 'neurocapacitar-hub',
          },
          // Sem `value`: o reembolso é sempre integral.
          body: '{}',
          signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
        });
      } catch (error) {
        throw new RefundAmbiguousError(
          error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
        );
      }
      if (response.status >= 500) throw new RefundAmbiguousError(`http_${response.status}`);
      const body = (await response.json().catch(() => null)) as {
        status?: unknown;
        refunds?: { status?: unknown }[];
        errors?: { code?: unknown }[];
      } | null;
      if (response.status >= 400) {
        const code = body?.errors?.[0]?.code;
        throw new RefundRejectedError(
          response.status,
          typeof code === 'string' && CODE.test(code) ? code : `http_${response.status}`,
        );
      }
      if (!body || typeof body !== 'object') throw new RefundAmbiguousError('unreadable_response');
      const awaiting = (body.refunds ?? []).some(
        (item) => item?.status === 'AWAITING_CRITICAL_ACTION_AUTHORIZATION',
      );
      const accepted: RefundAccepted = {
        status: awaiting
          ? 'awaiting_authorization'
          : body.status === 'REFUNDED'
            ? 'done'
            : 'requested',
      };
      return accepted;
    },
  };
}
