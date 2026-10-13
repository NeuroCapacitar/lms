import { describe, expect, it } from 'vitest';

import { FANOUT_BATCH_SIZE, cycleAction, registerInterestSchema } from './interest';

describe('ciclo de disponibilidade', () => {
  it('abre só na transição não-adquirível → adquirível, fecha na volta e não faz nada se nada mudou', () => {
    expect(cycleAction(true, false)).toBe('open');
    expect(cycleAction(false, true)).toBe('close');
    // oferta nova em curso já aberto: continua adquirível com o ciclo aberto
    expect(cycleAction(true, true)).toBe('none');
    expect(cycleAction(false, false)).toBe('none');
  });

  it('o corpo do registro só aceita o id do curso', () => {
    expect(registerInterestSchema.safeParse({ courseId: crypto.randomUUID() }).success).toBe(true);
    for (const bad of [{}, { courseId: 'x' }, { courseId: crypto.randomUUID(), email: 'a@b.co' }]) {
      expect(registerInterestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('o lote do fan-out é positivo e razoável', () => {
    expect(FANOUT_BATCH_SIZE).toBeGreaterThan(0);
    expect(FANOUT_BATCH_SIZE).toBeLessThanOrEqual(100);
  });
});
