import { describe, expect, it } from 'vitest';

import { minimizeAsaasEvent } from './asaas-webhook';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const minimize = (body: string) => minimizeAsaasEvent(body, sha256Hex);

const received = JSON.stringify({
  id: 'evt_05b708f961d739ea7eba7e4db318f621&368604920',
  event: 'PAYMENT_RECEIVED',
  dateCreated: '2026-10-14 10:00:00',
  payment: {
    object: 'payment',
    id: 'pay_080225913252',
    customer: 'cus_000005219613',
    checkoutSession: 'f5b2c1d0-1111-4222-8333-444455556666',
    installment: 'ins_000000123',
    value: 197.05,
    billingType: 'PIX',
    status: 'RECEIVED',
    description: 'Maria da Silva 123.456.789-09 maria@example.com',
    externalReference: null,
  },
});

describe('webhook do Asaas reduzido aos ids', () => {
  it('guarda o tipo, os ids e a dica de status, e NADA mais (sem valor, descrição, cliente nem PII)', async () => {
    const result = await minimize(received);
    expect(result.eventId).toBe('evt_05b708f961d739ea7eba7e4db318f621&368604920');
    expect(result.payload).toEqual({
      event: 'PAYMENT_RECEIVED',
      paymentId: 'pay_080225913252',
      checkoutSessionId: 'f5b2c1d0-1111-4222-8333-444455556666',
      installmentId: 'ins_000000123',
      statusHint: 'RECEIVED',
      malformed: false,
    });
    const stored = JSON.stringify(result);
    for (const leak of ['Maria', '123.456', 'maria@', '197', 'cus_', 'PIX', 'description']) {
      expect(stored, leak).not.toContain(leak);
    }
  });

  it('CHECKOUT_PAID usa o id do checkout como sessão e não traz pagamento', async () => {
    const result = await minimize(
      JSON.stringify({ id: 'evt_1', event: 'CHECKOUT_PAID', checkout: { id: 'chk-123' } }),
    );
    expect(result.payload).toMatchObject({
      event: 'CHECKOUT_PAID',
      paymentId: null,
      checkoutSessionId: 'chk-123',
    });
  });

  it('evento desconhecido ou sem id ainda vira evento: a chave é o hash do corpo (repetir não duplica)', async () => {
    const body = JSON.stringify({ event: 'ALGO_NOVO', payment: { id: 'pay_1' } });
    const a = await minimize(body);
    const b = await minimize(body);
    expect(a.eventId).toMatch(/^noid:[0-9a-f]{64}$/);
    expect(b.eventId).toBe(a.eventId);
    expect(a.payload).toMatchObject({ event: 'ALGO_NOVO', paymentId: 'pay_1' });
    const other = await minimize(JSON.stringify({ event: 'ALGO_NOVO', payment: { id: 'pay_2' } }));
    expect(other.eventId).not.toBe(a.eventId);
  });

  it('JSON inválido, array e valores soltos viram evidência vazia marcada como malformada', async () => {
    for (const body of ['', 'não é json', '[1,2]', '"texto"', '123', 'null']) {
      const result = await minimize(body);
      expect(result.payload, JSON.stringify(body)).toMatchObject({
        event: null,
        paymentId: null,
        malformed: true,
      });
      expect(result.eventId).toMatch(/^noid:/);
    }
  });

  it('ids e tipos fora do formato viram nulo (nada de texto livre na inbox)', async () => {
    const result = await minimize(
      JSON.stringify({
        id: 'evt com espaço',
        event: 'payment received; drop table',
        payment: {
          id: 'x'.repeat(101),
          checkoutSession: '<script>',
          installment: 42,
          status: 'em minúsculas',
        },
      }),
    );
    expect(result.eventId).toMatch(/^noid:/);
    expect(result.payload).toEqual({
      event: null,
      paymentId: null,
      checkoutSessionId: null,
      installmentId: null,
      statusHint: null,
      malformed: false,
    });
  });
});
