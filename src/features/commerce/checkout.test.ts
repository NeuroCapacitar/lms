import { describe, expect, it } from 'vitest';

import {
  buildCheckoutRequest,
  centsToDecimal,
  checkoutHostsFor,
  checkoutReturnUrls,
  isAllowedCheckoutUrl,
  truncateText,
} from './checkout';
import { buildOrderSnapshot } from './commerce';

describe('valor decimal do Asaas a partir de centavos', () => {
  it('exato, sem ponto flutuante', () => {
    expect(centsToDecimal(19_700)).toBe(197);
    expect(centsToDecimal(19_705)).toBe(197.05);
    expect(centsToDecimal(1000)).toBe(10);
    expect(centsToDecimal(1)).toBe(0.01);
    expect(centsToDecimal(10_005)).toBe(100.05);
    expect(centsToDecimal(99_999_999)).toBe(999_999.99);
  });

  it('recusa negativo, fracionário e infinito', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => centsToDecimal(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe('texto do item (limites de 30 e 150 caracteres)', () => {
  it('texto que cabe volta aparado e com espaços normalizados', () => {
    expect(truncateText('  Curso   de   Neuro  ', 30)).toBe('Curso de Neuro');
    expect(truncateText('x'.repeat(30), 30)).toBe('x'.repeat(30));
  });

  it('corta em caracteres visíveis e conta a reticência no limite', () => {
    const cut = truncateText('a'.repeat(40), 30);
    expect([...cut]).toHaveLength(30);
    expect(cut.endsWith('…')).toBe(true);
    expect(truncateText('Neurociência aplicada à prática clínica e à educação', 30)).toBe(
      'Neurociência aplicada à práti…',
    );
  });

  it('nunca parte um emoji, um acento combinado nem uma sequência com ZWJ', () => {
    const family = '👨‍👩‍👧‍👦';
    const text = `${family.repeat(10)}`;
    const cut = truncateText(text, 5);
    expect(cut).toBe(`${family.repeat(4)}…`);
    // "é" decomposto (e + acento combinante) fica inteiro
    const combining = 'é'.repeat(40);
    const cutCombining = truncateText(combining, 30);
    expect(cutCombining).toBe(`${'é'.repeat(29)}…`);
    expect(cutCombining.normalize('NFC').length).toBe(30);
    // texto não latino
    expect([
      ...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(
        truncateText('神経科学'.repeat(20), 30),
      ),
    ]).toHaveLength(30);
  });
});

describe('corpo do checkout', () => {
  const snapshot = buildOrderSnapshot({
    courseTitle: 'Neurociência aplicada à prática clínica e à educação',
    offerName: 'Acesso anual',
    priceCents: 19_705,
    accessMonths: 12,
    maxInstallments: 10,
  });
  const urls = checkoutReturnUrls('https://hub.example.test/', 'o-1');

  it('Pix e cartão, à vista e parcelado, valor decimal exato, sem customerData e sem boleto', () => {
    const body = buildCheckoutRequest({
      orderId: 'o-1',
      snapshot,
      minutesToExpire: 60,
      urls,
      imageBase64: 'AAAA',
    });
    expect(body).toEqual({
      billingTypes: ['PIX', 'CREDIT_CARD'],
      chargeTypes: ['DETACHED', 'INSTALLMENT'],
      minutesToExpire: 60,
      externalReference: 'o-1',
      callback: urls,
      items: [
        {
          name: 'Neurociência aplicada à práti…',
          description: 'Acesso anual',
          quantity: 1,
          value: 197.05,
          imageBase64: 'AAAA',
        },
      ],
      installment: { maxInstallmentCount: 10 },
    });
    expect(JSON.stringify(body)).not.toContain('customerData');
    expect(JSON.stringify(body)).not.toContain('BOLETO');
  });

  it('parcela única: só à vista e sem bloco de parcelamento', () => {
    const body = buildCheckoutRequest({
      orderId: 'o-2',
      snapshot: { ...snapshot, maxInstallments: 1 },
      minutesToExpire: 60,
      urls,
      imageBase64: 'AAAA',
    });
    expect(body.chargeTypes).toEqual(['DETACHED']);
    expect(body).not.toHaveProperty('installment');
  });

  it('as páginas de retorno são do Hub, com o pedido e o resultado', () => {
    expect(urls).toEqual({
      successUrl: 'https://hub.example.test/compra/retorno?pedido=o-1&resultado=sucesso',
      cancelUrl: 'https://hub.example.test/compra/retorno?pedido=o-1&resultado=cancelado',
      expiredUrl: 'https://hub.example.test/compra/retorno?pedido=o-1&resultado=expirado',
    });
  });
});

describe('endereço do Checkout devolvido pelo provider', () => {
  const hosts = checkoutHostsFor('staging');

  it('Production só aceita o domínio real; os demais ambientes, só o sandbox', () => {
    expect(checkoutHostsFor('production')).toEqual(['www.asaas.com', 'asaas.com']);
    expect(checkoutHostsFor('staging')).toEqual(['sandbox.asaas.com']);
    expect(checkoutHostsFor('dev')).toEqual(['sandbox.asaas.com']);
  });

  it('aceita https do host exato', () => {
    expect(isAllowedCheckoutUrl('https://sandbox.asaas.com/checkoutSession/show/abc', hosts)).toBe(
      true,
    );
    expect(isAllowedCheckoutUrl('https://SANDBOX.asaas.com/x', hosts)).toBe(true);
    expect(isAllowedCheckoutUrl('https://www.asaas.com/x', checkoutHostsFor('production'))).toBe(
      true,
    );
  });

  it('recusa http, host parecido, subdomínio, credencial, porta, javascript:, data:, espaço e lixo', () => {
    for (const bad of [
      'http://sandbox.asaas.com/x',
      'https://sandbox.asaas.com.evil.example/x',
      'https://evilsandbox.asaas.com/x',
      'https://x.sandbox.asaas.com/x',
      'https://sandbox.asaas.com@evil.example/x',
      'https://user:pw@sandbox.asaas.com/x',
      'https://sandbox.asaas.com:8443/x',
      'javascript:alert(1)',
      'data:text/html,x',
      '//sandbox.asaas.com/x',
      'https://sandbox.asaas.com/a b',
      'https://sandbox.asaas.com/x\n',
      'https://sandbox.asaas.com\\@evil.example',
      'sandbox.asaas.com/x',
      '',
    ]) {
      expect(isAllowedCheckoutUrl(bad, hosts), JSON.stringify(bad)).toBe(false);
    }
    // o sandbox NÃO vale em Production e o domínio real NÃO vale no Staging
    expect(
      isAllowedCheckoutUrl('https://sandbox.asaas.com/x', checkoutHostsFor('production')),
    ).toBe(false);
    expect(isAllowedCheckoutUrl('https://www.asaas.com/x', hosts)).toBe(false);
  });
});
