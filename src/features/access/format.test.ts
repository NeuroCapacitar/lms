import { describe, expect, it } from 'vitest';

import { formatAccessDate } from './format';

describe('formatAccessDate', () => {
  it('formata dd/mm/aaaa no fuso de São Paulo (a virada do dia usa o horário local)', () => {
    expect(formatAccessDate('2027-01-10T12:00:00.000Z')).toBe('10/01/2027');
    // 02:30 UTC ainda é o dia anterior em São Paulo (UTC-3)
    expect(formatAccessDate('2027-01-10T02:30:00.000Z')).toBe('09/01/2027');
    expect(formatAccessDate('2027-01-10T03:00:00.000Z')).toBe('10/01/2027');
  });

  it('entrada inválida vira texto vazio', () => {
    expect(formatAccessDate('não é data')).toBe('');
    expect(formatAccessDate('')).toBe('');
  });
});
