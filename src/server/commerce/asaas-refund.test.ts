import { describe, expect, it } from 'vitest';

import { createAsaasRefundProvider } from './asaas-refund';
import { RefundAmbiguousError, RefundRejectedError } from './refund-provider';

const KEY = 'chave-de-teste-nao-e-segredo';
const TARGET = { paymentId: 'p', installmentId: null };

function client(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return {
    calls,
    provider: createAsaasRefundProvider({
      apiKey: KEY,
      baseUrl: 'https://api-sandbox.example.test/',
      fetcher,
    }),
  };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('reembolso no Asaas', () => {
  it('POST sem valor (sempre integral), chave só no cabeçalho; pagamento avulso e parcelamento usam rotas diferentes', async () => {
    const { provider, calls } = client(() => ok({ status: 'REFUND_REQUESTED', refunds: [] }));
    expect(await provider.refund({ paymentId: 'pay_1', installmentId: null })).toEqual({
      status: 'requested',
    });
    expect(await provider.refund({ paymentId: 'pay_2', installmentId: 'ins_9' })).toEqual({
      status: 'requested',
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api-sandbox.example.test/v3/payments/pay_1/refund',
      'https://api-sandbox.example.test/v3/installments/ins_9/refund',
    ]);
    for (const call of calls) {
      expect(call.init.method).toBe('POST');
      expect((call.init.headers as Record<string, string>).access_token).toBe(KEY);
      expect(call.url).not.toContain(KEY);
      expect(JSON.parse(String(call.init.body))).toEqual({});
    }
  });

  it('interpreta o resultado: estornado, aguardando autorização no painel, ou aceito', async () => {
    expect(await client(() => ok({ status: 'REFUNDED' })).provider.refund(TARGET)).toEqual({
      status: 'done',
    });
    expect(
      await client(() =>
        ok({ status: 'RECEIVED', refunds: [{ status: 'AWAITING_CRITICAL_ACTION_AUTHORIZATION' }] }),
      ).provider.refund(TARGET),
    ).toEqual({ status: 'awaiting_authorization' });
  });

  it('4xx é recusa CONHECIDA e guarda só o CÓDIGO do erro (nunca texto livre)', async () => {
    const insufficient = client(() =>
      ok(
        {
          errors: [
            {
              code: 'insufficient_balance',
              description: 'Saldo insuficiente de Maria 123.456.789-09',
            },
          ],
        },
        400,
      ),
    );
    await expect(insufficient.provider.refund(TARGET)).rejects.toMatchObject({
      status: 400,
      code: 'insufficient_balance',
    });
    for (const [status, body] of [
      [400, {}],
      [403, null],
      [404, { errors: [{ code: 'codigo com espaço e texto livre' }] }],
    ] as const) {
      const { provider } = client(() => ok(body, status));
      const error = await provider.refund(TARGET).catch((e) => e);
      expect(error).toBeInstanceOf(RefundRejectedError);
      expect(error.code).toBe(`http_${status}`);
    }
  });

  it('5xx, rede, timeout e resposta ilegível são AMBÍGUOS (nunca reenviar às cegas)', async () => {
    for (const status of [500, 502, 503]) {
      const { provider } = client(() => ok({}, status));
      await expect(provider.refund(TARGET)).rejects.toBeInstanceOf(RefundAmbiguousError);
    }
    const unreadable = client(() => new Response('não é json', { status: 200 }));
    await expect(unreadable.provider.refund(TARGET)).rejects.toMatchObject({
      reason: 'unreadable_response',
    });
    const network = createAsaasRefundProvider({
      apiKey: KEY,
      baseUrl: 'https://x.test',
      fetcher: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(network.refund(TARGET)).rejects.toMatchObject({ reason: 'network' });
    const timeout = createAsaasRefundProvider({
      apiKey: KEY,
      baseUrl: 'https://x.test',
      fetcher: (async () => {
        throw new DOMException('aborted', 'TimeoutError');
      }) as unknown as typeof fetch,
    });
    await expect(timeout.refund(TARGET)).rejects.toMatchObject({ reason: 'timeout' });
  });
});
