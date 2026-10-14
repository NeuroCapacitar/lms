import { describe, expect, it } from 'vitest';

import { REFUND_WINDOW_DAYS, refundWindow, requestRefundSchema } from './refund';

describe('janela de 7 dias do reembolso (dias do calendário de São Paulo)', () => {
  // 14/10/2026 09:00 em São Paulo = 12:00 UTC: o dia 0 é 14/10.
  const confirmed = new Date('2026-10-14T12:00:00.000Z');

  it('o dia 7 ainda vale até a ÚLTIMA hora em São Paulo; o dia 8 já não', () => {
    expect(REFUND_WINDOW_DAYS).toBe(7);
    // dia 7 = 21/10: vale até 21/10 23:59:59 em SP = 22/10 02:59:59 UTC
    expect(refundWindow(confirmed, new Date('2026-10-22T02:59:59.999Z'))).toBe('within');
    // meia-noite de SP do dia 8 (22/10 00:00 SP = 03:00 UTC)
    expect(refundWindow(confirmed, new Date('2026-10-22T03:00:00.000Z'))).toBe('after');
    expect(refundWindow(confirmed, new Date('2026-10-28T12:00:00.000Z'))).toBe('after');
  });

  it('o mesmo dia e os primeiros dias valem', () => {
    expect(refundWindow(confirmed, confirmed)).toBe('within');
    expect(refundWindow(confirmed, new Date('2026-10-15T12:00:00.000Z'))).toBe('within');
    expect(refundWindow(confirmed, new Date('2026-10-20T12:00:00.000Z'))).toBe('within');
  });

  it('a virada do dia é a de SÃO PAULO, não a UTC', () => {
    // 15/10 02:30 UTC = 14/10 23:30 em SP: o dia 0 é 14/10 (não 15/10)
    const lateNight = new Date('2026-10-15T02:30:00.000Z');
    expect(refundWindow(lateNight, new Date('2026-10-22T02:59:59.000Z'))).toBe('within');
    expect(refundWindow(lateNight, new Date('2026-10-22T03:00:00.000Z'))).toBe('after');
    // 15/10 03:30 UTC = 15/10 00:30 em SP: o dia 0 é 15/10
    const earlyMorning = new Date('2026-10-15T03:30:00.000Z');
    expect(refundWindow(earlyMorning, new Date('2026-10-23T02:59:59.000Z'))).toBe('within');
    expect(refundWindow(earlyMorning, new Date('2026-10-23T03:00:00.000Z'))).toBe('after');
  });
});

describe('corpo do pedido de reembolso', () => {
  it('só o motivo (5 a 500 caracteres, aparado); valor, pagamento e pessoa são recusados', () => {
    expect(requestRefundSchema.parse({ reason: '  Desistência dentro do prazo  ' }).reason).toBe(
      'Desistência dentro do prazo',
    );
    for (const bad of [
      {},
      { reason: 'cur' },
      { reason: 'x'.repeat(501) },
      { reason: 'motivo válido', amount: 100 },
      { reason: 'motivo válido', amountCents: 100 },
      { reason: 'motivo válido', value: 1 },
      { reason: 'motivo válido', paymentId: 'pay_1' },
      { reason: 'motivo válido', userId: 'x' },
    ]) {
      expect(requestRefundSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
