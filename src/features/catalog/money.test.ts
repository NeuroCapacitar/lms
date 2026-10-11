import { describe, expect, it } from 'vitest';

import { centsToInput, formatBrl, parseBrlToCents } from './money';

describe('parseBrlToCents', () => {
  it('aceita inteiro, 1 ou 2 casas, milhar e símbolo; o resultado é inteiro de centavos', () => {
    const cases: [string, number][] = [
      ['197', 19_700],
      ['197,5', 19_750],
      ['197,50', 19_750],
      ['0,99', 99],
      ['0', 0],
      ['1.234,56', 123_456],
      ['1.000', 100_000],
      ['R$ 197,00', 19_700],
      ['  49,90  ', 4_990],
    ];
    for (const [input, cents] of cases) expect(parseBrlToCents(input), input).toBe(cents);
  });

  it('recusa negativo, mais de duas casas, letras e separadores fora de lugar', () => {
    for (const bad of [
      '',
      ' ',
      '-10',
      '10,555',
      '10,',
      ',50',
      '1.23',
      '1.2345,00',
      'abc',
      '10.5',
      '1,2,3',
      '10 reais',
      'R$',
      '1e3',
    ]) {
      expect(parseBrlToCents(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('não usa ponto flutuante: 0,07 e 1,15 dão centavos exatos', () => {
    expect(parseBrlToCents('0,07')).toBe(7);
    expect(parseBrlToCents('1,15')).toBe(115);
    expect(parseBrlToCents('19,99')).toBe(1_999);
    expect(parseBrlToCents('99999999999999999999,99')).toBeNull();
  });
});

describe('exibição', () => {
  it('formatBrl mostra reais e centavos em pt-BR; centsToInput devolve texto editável', () => {
    expect(formatBrl(19_700).replace(/\s/g, ' ')).toBe('R$ 197,00');
    expect(formatBrl(99).replace(/\s/g, ' ')).toBe('R$ 0,99');
    expect(centsToInput(19_700)).toBe('197,00');
    expect(centsToInput(5)).toBe('0,05');
    expect(parseBrlToCents(centsToInput(123_456))).toBe(123_456);
  });
});
