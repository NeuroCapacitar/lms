import { describe, expect, it } from 'vitest';

import {
  PaymentReadPermanentError,
  PaymentReadTransientError,
  createAsaasPaymentReader,
} from './payment-reader';

const KEY = 'chave-de-teste-nao-e-segredo';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function reader(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return {
    calls,
    reader: createAsaasPaymentReader({
      apiKey: KEY,
      baseUrl: 'https://api-sandbox.example.test/',
      fetcher,
    }),
  };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const PIX = {
  id: 'pay_1',
  status: 'RECEIVED',
  billingType: 'PIX',
  value: 197,
  checkoutSession: 'chk-1',
  confirmedDate: '2026-10-14',
  externalReference: null,
  customer: 'cus_123',
};

describe('leitura do pagamento no Asaas', () => {
  it('GET com a chave só no cabeçalho; converte o valor em centavos e devolve só o necessário', async () => {
    const { reader: r, calls } = reader(() => ok(PIX));
    const payment = await r.getPayment('pay_1');
    expect(payment).toEqual({
      id: 'pay_1',
      status: 'RECEIVED',
      billingType: 'PIX',
      valueCents: 19_700,
      totalCents: 19_700,
      checkoutSessionId: 'chk-1',
      installmentId: null,
      externalReference: null,
      customerId: 'cus_123',
      paidAt: new Date('2026-10-14'),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api-sandbox.example.test/v3/payments/pay_1');
    expect(calls[0]!.init.method).toBe('GET');
    expect((calls[0]!.init.headers as Record<string, string>).access_token).toBe(KEY);
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('cartão parcelado: lê também o parcelamento e usa o TOTAL dele', async () => {
    const { reader: r, calls } = reader((url) =>
      url.includes('/installments/')
        ? ok({ id: 'ins_1', value: 360, paymentValue: 30, installmentCount: 12 })
        : ok({
            ...PIX,
            billingType: 'CREDIT_CARD',
            status: 'CONFIRMED',
            value: 30,
            installment: 'ins_1',
          }),
    );
    const payment = await r.getPayment('pay_2');
    expect(payment).toMatchObject({ valueCents: 3000, totalCents: 36_000, installmentId: 'ins_1' });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api-sandbox.example.test/v3/payments/pay_2',
      'https://api-sandbox.example.test/v3/installments/ins_1',
    ]);
  });

  it('sem o total do parcelamento legível não dá para conferir: erro transitório, nunca valor chutado', async () => {
    const { reader: r } = reader((url) =>
      url.includes('/installments/') ? ok({ id: 'ins_1' }) : ok({ ...PIX, installment: 'ins_1' }),
    );
    await expect(r.getPayment('pay_3')).rejects.toBeInstanceOf(PaymentReadTransientError);
  });

  it('404 = o Asaas não conhece o pagamento (null)', async () => {
    const { reader: r } = reader(() => new Response('{}', { status: 404 }));
    expect(await r.getPayment('pay_x')).toBeNull();
  });

  it('429, 5xx, rede e timeout são transitórios; 401, 403 e 400 são permanentes', async () => {
    for (const status of [429, 500, 502, 503]) {
      const { reader: r } = reader(() => new Response('{}', { status }));
      await expect(r.getPayment('p'), String(status)).rejects.toBeInstanceOf(
        PaymentReadTransientError,
      );
    }
    for (const status of [400, 401, 403]) {
      const { reader: r } = reader(() => new Response('{}', { status }));
      await expect(r.getPayment('p'), String(status)).rejects.toBeInstanceOf(
        PaymentReadPermanentError,
      );
    }
    const network = createAsaasPaymentReader({
      apiKey: KEY,
      baseUrl: 'https://x.test',
      fetcher: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(network.getPayment('p')).rejects.toMatchObject({ reason: 'network' });
    const timeout = createAsaasPaymentReader({
      apiKey: KEY,
      baseUrl: 'https://x.test',
      fetcher: (async () => {
        throw new DOMException('aborted', 'TimeoutError');
      }) as unknown as typeof fetch,
    });
    await expect(timeout.getPayment('p')).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('corpo ilegível, sem id, sem status ou com valor que não é dinheiro: transitório (nunca interpretado)', async () => {
    for (const body of [
      null,
      {},
      { ...PIX, id: undefined },
      { ...PIX, status: '' },
      { ...PIX, value: '197' },
      { ...PIX, value: 1.005 },
      { ...PIX, value: -1 },
    ]) {
      const { reader: r } = reader(() => ok(body));
      await expect(r.getPayment('p'), JSON.stringify(body)).rejects.toBeInstanceOf(
        PaymentReadTransientError,
      );
    }
  });

  it('lista os ids dos pagamentos de uma sessão (e ignora lixo)', async () => {
    const { reader: r, calls } = reader(() =>
      ok({ data: [{ id: 'pay_1' }, { id: 'pay_2' }, { nada: 1 }, null, { id: '' }] }),
    );
    expect(await r.listPaymentIds('chk 1')).toEqual(['pay_1', 'pay_2']);
    expect(calls[0]!.url).toBe(
      'https://api-sandbox.example.test/v3/payments?checkoutSession=chk%201&limit=100',
    );
    const empty = reader(() => ok({ data: [] }));
    expect(await empty.reader.listPaymentIds('x')).toEqual([]);
    const missing = reader(() => new Response('{}', { status: 404 }));
    expect(await missing.reader.listPaymentIds('x')).toEqual([]);
  });

  it('lê o pagador: nome e CPF/CNPJ, 404 = desconhecido, e falhas classificadas', async () => {
    const { reader: r, calls } = reader(() =>
      ok({ id: 'cus_123', name: 'Maria da Silva', cpfCnpj: '12345678909' }),
    );
    expect(await r.getCustomer('cus_123')).toEqual({
      name: 'Maria da Silva',
      document: '12345678909',
    });
    expect(calls[0]!.url).toBe('https://api-sandbox.example.test/v3/customers/cus_123');
    expect((calls[0]!.init.headers as Record<string, string>).access_token).toBe(KEY);
    expect(await reader(() => ok({ id: 'cus_1' })).reader.getCustomer('cus_1')).toEqual({
      name: null,
      document: null,
    });
    expect(
      await reader(() => new Response('{}', { status: 404 })).reader.getCustomer('x'),
    ).toBeNull();
    await expect(
      reader(() => new Response('{}', { status: 503 })).reader.getCustomer('x'),
    ).rejects.toBeInstanceOf(PaymentReadTransientError);
    await expect(
      reader(() => new Response('{}', { status: 401 })).reader.getCustomer('x'),
    ).rejects.toBeInstanceOf(PaymentReadPermanentError);
  });
});
