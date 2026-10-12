import { describe, expect, it } from 'vitest';

import { readStoredReturnTo, safeReturnTo, serializeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it.each([
    ['/cursos/demo', '/cursos/demo'],
    ['/cursos', '/cursos'],
    ['/cursos?busca=neuro&filtro=abertos', '/cursos?busca=neuro&filtro=abertos'],
    ['/', '/'],
    ['/conta', '/conta'],
  ])('aceita o caminho interno %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    'https://evil.example/',
    'http://evil.example',
    '//evil.example/x',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'data:text/html,x',
    'cursos/demo',
    '',
    ' /cursos',
    '/cursos demo',
    '/cursos\n/x',
    '/cursos\r\nx',
    '/\t/evil.example',
    '/api/me',
    '/api',
    '/entrar',
    '/entrar/confirmar',
    '/convite',
    `/${'a'.repeat(250)}`,
  ])('recusa %j', (input) => {
    expect(safeReturnTo(input)).toBeNull();
  });

  it('recusa o que não é texto', () => {
    for (const bad of [undefined, null, 42, {}, ['/cursos']]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });

  it('normaliza segmentos de ponto sem escapar da origem', () => {
    expect(safeReturnTo('/cursos/../conta')).toBe('/conta');
    expect(safeReturnTo('/cursos/%2e%2e/%2e%2e/entrar')).toBeNull();
    expect(safeReturnTo('/a/../../entrar')).toBeNull();
  });
});

describe('destino guardado no navegador', () => {
  const NOW = 1_800_000_000_000;

  it('ida e volta dentro do prazo', () => {
    expect(readStoredReturnTo(serializeReturnTo('/cursos/demo', NOW), NOW + 60_000)).toBe(
      '/cursos/demo',
    );
  });

  it('vencido (mais de 30 minutos) ou do futuro: nulo', () => {
    expect(
      readStoredReturnTo(serializeReturnTo('/cursos/demo', NOW), NOW + 31 * 60_000),
    ).toBeNull();
    expect(readStoredReturnTo(serializeReturnTo('/cursos/demo', NOW), NOW - 1)).toBeNull();
  });

  it('valor adulterado no armazenamento (externo, malformado, tipos errados) é recusado', () => {
    expect(readStoredReturnTo(null, NOW)).toBeNull();
    expect(readStoredReturnTo('não é json', NOW)).toBeNull();
    expect(readStoredReturnTo('"/cursos"', NOW)).toBeNull();
    expect(
      readStoredReturnTo(JSON.stringify({ path: 'https://evil.example', at: NOW }), NOW),
    ).toBeNull();
    expect(readStoredReturnTo(JSON.stringify({ path: '//evil.example', at: NOW }), NOW)).toBeNull();
    expect(readStoredReturnTo(JSON.stringify({ path: '/cursos', at: 'ontem' }), NOW)).toBeNull();
    expect(readStoredReturnTo(JSON.stringify({ path: 42, at: NOW }), NOW)).toBeNull();
  });
});
