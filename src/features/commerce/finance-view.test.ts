import { describe, expect, it } from 'vitest';

import {
  dayEnd,
  dayStart,
  financeOrdersQuerySchema,
  formatDocument,
  maskDocument,
  normalizeDocument,
} from './finance-view';

describe('CPF e CNPJ', () => {
  it('normaliza só 11 (CPF) ou 14 (CNPJ) dígitos; o resto é "não informado"', () => {
    expect(normalizeDocument('123.456.789-09')).toBe('12345678909');
    expect(normalizeDocument('12.345.678/0001-95')).toBe('12345678000195');
    expect(normalizeDocument('12345678909')).toBe('12345678909');
    for (const bad of ['', '123', '123456789012', null, undefined, 12_345_678_909, {}]) {
      expect(normalizeDocument(bad), String(bad)).toBeNull();
    }
  });

  it('a máscara mostra só os 2 últimos dígitos', () => {
    expect(maskDocument('12345678909')).toBe('•••.•••.•••-09');
    expect(maskDocument('12345678000195')).toBe('••.•••.•••/••••-95');
    expect(maskDocument('12345678909')).not.toMatch(/\d{3}/);
  });

  it('formata o documento completo (só depois de revelar com auditoria)', () => {
    expect(formatDocument('12345678909')).toBe('123.456.789-09');
    expect(formatDocument('12345678000195')).toBe('12.345.678/0001-95');
  });
});

describe('filtros da lista financeira', () => {
  it('aceita período, curso e estado; recusa lixo e campo desconhecido', () => {
    const course = crypto.randomUUID();
    expect(
      financeOrdersQuerySchema.parse({
        from: '2026-10-01',
        to: '2026-10-31',
        courseId: course,
        status: 'paid',
      }),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31', courseId: course, status: 'paid' });
    expect(financeOrdersQuerySchema.parse({})).toEqual({});
    for (const bad of [
      { from: '01/10/2026' },
      { from: '2026-10-1' },
      { to: 'amanhã' },
      { courseId: 'x' },
      { status: 'inventado' },
      { limit: 10 },
      { sql: "1' or '1'='1" },
    ]) {
      expect(financeOrdersQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('o dia vai de 00:00 a 23:59:59.999 em São Paulo (UTC-3)', () => {
    expect(dayStart('2026-10-14').toISOString()).toBe('2026-10-14T03:00:00.000Z');
    expect(dayEnd('2026-10-14').toISOString()).toBe('2026-10-15T02:59:59.999Z');
  });
});
