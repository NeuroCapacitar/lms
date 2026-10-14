import {
  CheckoutAmbiguousError,
  CheckoutRejectedError,
  type CheckoutProvider,
} from './checkout-provider';

/**
 * Cliente do Asaas (M6-02): SÓ `POST /v3/checkouts`. A chave vai no cabeçalho `access_token`, nunca na URL, no corpo
 * nem em log. NADA aqui foi exercitado contra o sandbox real nesta entrega (precisa da conta do cliente): o corpo e a
 * resposta seguem a referência pública; o spike 5 confirma no sandbox.
 *
 * Classificação do resultado (decide se a sessão fica `failed` ou `unknown`):
 * - 2xx com `id` e `link` → sucesso;
 * - 4xx (inclui 401, 403 e 429): o Asaas não criou nada → recusa conhecida;
 * - 5xx, timeout, queda de rede ou 2xx sem `id`/`link` legível → AMBÍGUO (pode ter criado).
 */
const TIMEOUT_MS = 8000;

export function createAsaasCheckoutProvider(input: {
  apiKey: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): CheckoutProvider {
  const fetcher = input.fetcher ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, '');
  return {
    async createCheckout(request) {
      let response: Response;
      try {
        response = await fetcher(`${base}/v3/checkouts`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            access_token: input.apiKey,
            // O Asaas recusa chamadas sem User-Agent em contas novas.
            'user-agent': 'neurocapacitar-hub',
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
        });
      } catch (error) {
        throw new CheckoutAmbiguousError(
          error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
        );
      }
      if (response.status >= 500) throw new CheckoutAmbiguousError(`http_${response.status}`);
      if (response.status >= 400) {
        throw new CheckoutRejectedError(response.status, `http_${response.status}`);
      }
      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
        link?: unknown;
      } | null;
      if (
        !body ||
        typeof body.id !== 'string' ||
        body.id === '' ||
        typeof body.link !== 'string' ||
        body.link === ''
      ) {
        throw new CheckoutAmbiguousError('unreadable_response');
      }
      return { id: body.id, link: body.link };
    },
  };
}
