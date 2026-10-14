import { describe, expect, it } from 'vitest';

import { buildCheckoutRequest, checkoutReturnUrls } from '../../features/commerce/checkout';
import { buildOrderSnapshot } from '../../features/commerce/commerce';
import { createAsaasCheckoutProvider } from './asaas-client';
import { CheckoutAmbiguousError, CheckoutRejectedError } from './checkout-provider';

const request = buildCheckoutRequest({
  orderId: 'o-1',
  snapshot: buildOrderSnapshot({
    courseTitle: 'Curso',
    offerName: 'Oferta',
    priceCents: 19_700,
    accessMonths: 12,
    maxInstallments: 12,
  }),
  minutesToExpire: 60,
  urls: checkoutReturnUrls('https://hub.example.test', 'o-1'),
  imageBase64: 'AAAA',
});

const KEY = 'chave-de-teste-nao-e-segredo';

function provider(fetcher: typeof fetch) {
  return createAsaasCheckoutProvider({
    apiKey: KEY,
    baseUrl: 'https://api-sandbox.example.test/',
    fetcher,
  });
}

const respond = (status: number, body: unknown) =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as unknown as typeof fetch;

describe('cliente do Asaas (POST /v3/checkouts)', () => {
  it('envia a chave só no cabeçalho access_token, JSON, User-Agent e o corpo conferido; devolve id e link', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: 'chk_1', link: 'https://sandbox.asaas.com/x' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const created = await provider(fetcher).createCheckout(request);
    expect(created).toEqual({ id: 'chk_1', link: 'https://sandbox.asaas.com/x' });
    expect(seen!.url).toBe('https://api-sandbox.example.test/v3/checkouts');
    expect(seen!.init.method).toBe('POST');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.access_token).toBe(KEY);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toBeTruthy();
    // a chave nunca vai na URL nem no corpo
    expect(seen!.url).not.toContain(KEY);
    expect(String(seen!.init.body)).not.toContain(KEY);
    expect(JSON.parse(String(seen!.init.body))).toEqual(request);
  });

  it('4xx (inclui 401, 403 e 429) é recusa CONHECIDA: nada foi criado', async () => {
    for (const status of [400, 401, 403, 404, 422, 429]) {
      await expect(
        provider(respond(status, { errors: [] })).createCheckout(request),
        String(status),
      ).rejects.toBeInstanceOf(CheckoutRejectedError);
    }
  });

  it('5xx, rede, timeout e resposta ilegível são AMBÍGUOS: pode ter sido criado', async () => {
    for (const status of [500, 502, 503, 504]) {
      await expect(
        provider(respond(status, {})).createCheckout(request),
        String(status),
      ).rejects.toBeInstanceOf(CheckoutAmbiguousError);
    }
    await expect(
      provider(respond(200, 'não é json')).createCheckout(request),
    ).rejects.toMatchObject({
      reason: 'unreadable_response',
    });
    for (const body of [
      {},
      { id: 'x' },
      { link: 'https://x' },
      { id: '', link: 'https://x' },
      { id: 1, link: 2 },
      null,
    ]) {
      await expect(
        provider(respond(200, body)).createCheckout(request),
        JSON.stringify(body),
      ).rejects.toBeInstanceOf(CheckoutAmbiguousError);
    }
    const network = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(provider(network).createCheckout(request)).rejects.toMatchObject({
      reason: 'network',
    });
    const timeout = (async () => {
      throw new DOMException('aborted', 'TimeoutError');
    }) as unknown as typeof fetch;
    await expect(provider(timeout).createCheckout(request)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });
});
