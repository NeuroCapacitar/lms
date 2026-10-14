import { describe, expect, it } from 'vitest';

import type { OrderStatus } from './commerce';
import {
  decideEvidence,
  decimalToCents,
  statusClassOf,
  type EvidenceDecision,
  type ProviderPayment,
} from './payment-evidence';

const PRICE = 19_700;

const payment = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  id: 'pay_1',
  status: 'RECEIVED',
  billingType: 'PIX',
  valueCents: PRICE,
  totalCents: PRICE,
  checkoutSessionId: 'chk-1',
  installmentId: null,
  externalReference: null,
  paidAt: null,
  ...overrides,
});

function decide(
  overrides: Partial<ProviderPayment> = {},
  options: {
    previous?: string | null;
    order?: OrderStatus;
    hint?: string | null;
    price?: number;
  } = {},
): EvidenceDecision {
  return decideEvidence({
    payment: payment(overrides),
    previousStatus: options.previous ?? null,
    orderStatus: options.order ?? 'pending',
    orderPriceCents: options.price ?? PRICE,
    eventHint: options.hint ?? null,
  });
}

describe('valor do Asaas em centavos', () => {
  it('converte exato e recusa o que não é dinheiro', () => {
    expect(decimalToCents(197)).toBe(19_700);
    expect(decimalToCents(197.05)).toBe(19_705);
    expect(decimalToCents(0.01)).toBe(1);
    expect(decimalToCents(10.1)).toBe(1010);
    expect(decimalToCents(1234.56)).toBe(123_456);
    for (const bad of [
      -1,
      1.005,
      0.001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '197',
      null,
      undefined,
    ]) {
      expect(decimalToCents(bad), String(bad)).toBeNull();
    }
  });
});

describe('matriz de liberação', () => {
  it('Pix libera SÓ em RECEIVED; CONFIRMED ou PENDING de Pix não libera', () => {
    expect(decide({ status: 'RECEIVED' })).toEqual({ kind: 'grant' });
    expect(decide({ status: 'CONFIRMED' })).toEqual({ kind: 'wait' });
    expect(decide({ status: 'PENDING' })).toEqual({ kind: 'wait' });
  });

  it('cartão libera em CONFIRMED (e em RECEIVED depois), nunca em PENDING nem em análise de risco', () => {
    const card = { billingType: 'CREDIT_CARD' };
    expect(decide({ ...card, status: 'CONFIRMED' })).toEqual({ kind: 'grant' });
    expect(decide({ ...card, status: 'RECEIVED' }, { previous: 'CONFIRMED' })).toEqual({
      kind: 'grant',
    });
    expect(decide({ ...card, status: 'PENDING' })).toEqual({ kind: 'wait' });
    expect(decide({ ...card, status: 'AWAITING_RISK_ANALYSIS' })).toEqual({ kind: 'wait' });
    // aprovado depois da análise: destrava
    expect(
      decide({ ...card, status: 'CONFIRMED' }, { previous: 'AWAITING_RISK_ANALYSIS' }),
    ).toEqual({
      kind: 'grant',
    });
  });

  it('boleto e outras formas não são permitidas: revisão, nunca acesso', () => {
    for (const billingType of ['BOLETO', 'UNDEFINED', 'DEBIT_CARD', 'TRANSFER']) {
      expect(decide({ billingType, status: 'RECEIVED' })).toMatchObject({
        kind: 'review',
        type: 'event_anomaly',
      });
    }
  });

  it('valor com tolerância ZERO: um centavo a mais ou a menos vira revisão', () => {
    for (const total of [PRICE - 1, PRICE + 1, 1, 0]) {
      expect(decide({ totalCents: total })).toMatchObject({
        kind: 'review',
        type: 'amount_mismatch',
      });
    }
    // cartão parcelado: cada parcela tem valor menor, o que conta é o TOTAL do parcelamento
    expect(
      decide({
        billingType: 'CREDIT_CARD',
        status: 'CONFIRMED',
        valueCents: 1642,
        totalCents: PRICE,
      }),
    ).toEqual({ kind: 'grant' });
    expect(
      decide({
        billingType: 'CREDIT_CARD',
        status: 'CONFIRMED',
        valueCents: 1642,
        totalCents: PRICE - 5,
      }),
    ).toMatchObject({ type: 'amount_mismatch' });
  });

  it('só pedido pendente ou já pago libera; vencido e cancelado vão para revisão; os demais esperam o humano', () => {
    expect(decide({}, { order: 'paid' })).toEqual({ kind: 'grant' });
    for (const order of ['expired', 'canceled'] as const) {
      expect(decide({}, { order })).toMatchObject({ kind: 'review', type: 'terminal_conflict' });
    }
    for (const order of ['review', 'refund_requested', 'disputed', 'refunded'] as const) {
      expect(decide({}, { order }), order).toEqual({ kind: 'wait' });
    }
  });

  it('status que não libera: pendente, vencida e em análise esperam', () => {
    for (const status of ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS']) {
      expect(decide({ status })).toEqual({ kind: 'wait' });
    }
  });
});

describe('reembolso, disputa e chargeback prevalecem', () => {
  it('REFUNDED, REFUND_REQUESTED, REFUND_IN_PROGRESS e chargeback são decididos mesmo com valor diferente', () => {
    expect(decide({ status: 'REFUNDED', totalCents: 1 })).toEqual({ kind: 'refunded' });
    expect(decide({ status: 'REFUND_REQUESTED' })).toEqual({ kind: 'refund_started' });
    expect(decide({ status: 'REFUND_IN_PROGRESS' })).toEqual({ kind: 'refund_started' });
    for (const status of [
      'CHARGEBACK_REQUESTED',
      'CHARGEBACK_DISPUTE',
      'AWAITING_CHARGEBACK_REVERSAL',
    ]) {
      expect(decide({ status }, { order: 'paid' }), status).toEqual({ kind: 'chargeback' });
    }
  });

  it('reembolso parcial (dica do evento) é revisão, sem efeito de acesso', () => {
    expect(
      decide({ status: 'RECEIVED' }, { hint: 'PAYMENT_PARTIALLY_REFUNDED', order: 'paid' }),
    ).toMatchObject({
      kind: 'review',
      type: 'partial_refund',
    });
  });
});

describe('o estado do provider só avança', () => {
  it('regressão na linha principal é ignorada (RECEIVED depois voltando a PENDING)', () => {
    expect(decide({ status: 'PENDING' }, { previous: 'RECEIVED', order: 'paid' })).toEqual({
      kind: 'regression_ignored',
    });
    expect(decide({ status: 'CONFIRMED' }, { previous: 'RECEIVED', order: 'paid' })).toEqual({
      kind: 'regression_ignored',
    });
    expect(
      decide(
        { billingType: 'CREDIT_CARD', status: 'AWAITING_RISK_ANALYSIS' },
        { previous: 'CONFIRMED' },
      ),
    ).toEqual({ kind: 'regression_ignored' });
  });

  it('voltar de refund ou chargeback para a linha principal é conflito (revisão), não regressão simples', () => {
    for (const previous of ['REFUNDED', 'CHARGEBACK_REQUESTED', 'REFUND_REQUESTED']) {
      expect(decide({ status: 'RECEIVED' }, { previous, order: 'paid' }), previous).toMatchObject({
        kind: 'review',
        type: 'terminal_conflict',
      });
    }
  });

  it('repetir o mesmo estado não é regressão', () => {
    expect(decide({ status: 'RECEIVED' }, { previous: 'RECEIVED', order: 'paid' })).toEqual({
      kind: 'grant',
    });
  });
});

describe('status desconhecido', () => {
  it('vira revisão (fail-closed), qualquer que seja o resto', () => {
    for (const status of ['ALGO_NOVO', '', 'received', 'DELETED']) {
      expect(decide({ status })).toMatchObject({
        kind: 'review',
        type: 'event_anomaly',
        reason: 'unknown_status',
      });
    }
    expect(statusClassOf('RECEIVED_IN_CASH')).toBe('received');
    expect(statusClassOf('DUNNING_REQUESTED')).toBe('unknown');
  });
});
