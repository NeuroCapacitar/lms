import { describe, expect, it } from 'vitest';

import {
  ORDER_STATUSES,
  RECONCILE_MAX_ORDERS_PER_RUN,
  RECONCILE_MAX_PAYMENTS_PER_RUN,
  buildOrderSnapshot,
  canTransitionOrder,
  createOrderInputSchema,
  maxInstallmentsForPrice,
  orderExpiresAt,
  reconcileBackoffMs,
  validatePaidPublication,
  type OrderStatus,
} from './commerce';

describe('parcelamento pelo preço', () => {
  it('no máximo 12 e nunca parcela abaixo de R$ 10,00', () => {
    expect(maxInstallmentsForPrice(999)).toBe(0);
    expect(maxInstallmentsForPrice(1000)).toBe(1);
    expect(maxInstallmentsForPrice(1999)).toBe(1);
    expect(maxInstallmentsForPrice(11_999)).toBe(11);
    expect(maxInstallmentsForPrice(12_000)).toBe(12);
    expect(maxInstallmentsForPrice(100_000)).toBe(12);
    expect(maxInstallmentsForPrice(Number.NaN)).toBe(0);
    expect(maxInstallmentsForPrice(1000.5)).toBe(0);
  });

  it('a publicação da Offer paga confere preço, parcelas e prazo', () => {
    expect(
      validatePaidPublication({ priceCents: 19_700, maxInstallments: 12, accessMonths: 12 }),
    ).toEqual([]);
    expect(
      validatePaidPublication({ priceCents: 999, maxInstallments: 1, accessMonths: 12 }),
    ).toEqual(['priceCents', 'maxInstallments']);
    expect(
      validatePaidPublication({ priceCents: 5000, maxInstallments: 6, accessMonths: 12 }),
    ).toEqual(['maxInstallments']);
    expect(
      validatePaidPublication({ priceCents: 5000, maxInstallments: 0, accessMonths: 12 }),
    ).toEqual(['maxInstallments']);
    expect(
      validatePaidPublication({ priceCents: 5000, maxInstallments: 5, accessMonths: 0 }),
    ).toEqual(['accessMonths']);
  });
});

describe('máquina de estados do pedido', () => {
  const allowed: [OrderStatus, OrderStatus][] = [
    ['pending', 'paid'],
    ['pending', 'expired'],
    ['pending', 'canceled'],
    ['pending', 'review'],
    ['paid', 'refund_requested'],
    ['paid', 'disputed'],
    ['refund_requested', 'refunded'],
    ['disputed', 'refunded'],
    ['review', 'paid'],
  ];

  it('permite só as transições explícitas', () => {
    for (const [from, to] of allowed)
      expect(canTransitionOrder(from, to), `${from}->${to}`).toBe(true);
    let permitted = 0;
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) if (canTransitionOrder(from, to)) permitted += 1;
    }
    expect(permitted).toBe(23);
  });

  it('refunded é terminal; vencido e cancelado só saem por revisão; ninguém vai para si mesmo', () => {
    for (const to of ORDER_STATUSES) expect(canTransitionOrder('refunded', to)).toBe(false);
    for (const from of ['expired', 'canceled'] as const) {
      expect(canTransitionOrder(from, 'paid')).toBe(false);
      expect(canTransitionOrder(from, 'review')).toBe(true);
    }
    for (const status of ORDER_STATUSES) expect(canTransitionOrder(status, status)).toBe(false);
    expect(canTransitionOrder('paid', 'pending')).toBe(false);
    expect(canTransitionOrder('pending', 'refunded')).toBe(false);
  });
});

describe('snapshot e pedido de compra', () => {
  it('o snapshot é BRL, Pix e cartão, com o que a Offer tinha', () => {
    expect(
      buildOrderSnapshot({
        courseTitle: 'Curso',
        offerName: 'Oferta',
        priceCents: 19_700,
        accessMonths: 12,
        maxInstallments: 10,
      }),
    ).toEqual({
      courseTitle: 'Curso',
      offerName: 'Oferta',
      priceCents: 19_700,
      currency: 'BRL',
      accessMonths: 12,
      maxInstallments: 10,
      methods: ['pix', 'card'],
    });
  });

  it('vence 60 minutos depois', () => {
    expect(orderExpiresAt(new Date('2026-10-14T12:00:00.000Z')).toISOString()).toBe(
      '2026-10-14T13:00:00.000Z',
    );
  });

  it('o corpo do pedido só traz offerId e attemptId: preço, e-mail e callbacks são recusados', () => {
    const ids = { offerId: crypto.randomUUID(), attemptId: crypto.randomUUID() };
    expect(createOrderInputSchema.safeParse(ids).success).toBe(true);
    for (const extra of [
      { priceCents: 1 },
      { price: 1 },
      { email: 'x@example.test' },
      { successUrl: 'https://evil.example' },
      { userId: 'outra' },
    ]) {
      expect(createOrderInputSchema.safeParse({ ...ids, ...extra }).success).toBe(false);
    }
    expect(
      createOrderInputSchema.safeParse({ offerId: 'x', attemptId: ids.attemptId }).success,
    ).toBe(false);
    expect(createOrderInputSchema.safeParse({ offerId: ids.offerId }).success).toBe(false);
  });
});

describe('reconciliação: backoff e teto', () => {
  it('o intervalo dobra a cada tentativa (10 min, 20, 40...) e para em 6 horas', () => {
    expect(reconcileBackoffMs(0)).toBe(10 * 60_000);
    expect(reconcileBackoffMs(1)).toBe(20 * 60_000);
    expect(reconcileBackoffMs(2)).toBe(40 * 60_000);
    expect(reconcileBackoffMs(5)).toBe(320 * 60_000);
    expect(reconcileBackoffMs(6)).toBe(6 * 3_600_000);
    expect(reconcileBackoffMs(50)).toBe(6 * 3_600_000);
    expect(reconcileBackoffMs(-3)).toBe(10 * 60_000);
  });

  it('o teto por execução cabe na quota do Asaas (25.000 por 12 h) com folga enorme', () => {
    const runsIn12Hours = 24;
    const worstCase =
      runsIn12Hours * (RECONCILE_MAX_ORDERS_PER_RUN + RECONCILE_MAX_PAYMENTS_PER_RUN) * 3;
    expect(worstCase).toBeLessThan(25_000 / 5);
  });
});
