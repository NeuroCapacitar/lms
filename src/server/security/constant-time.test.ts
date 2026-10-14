import { describe, expect, it } from 'vitest';

import { constantTimeEqual, sha256Hex } from './constant-time';

describe('comparação de segredo em tempo constante', () => {
  it('iguais passam; diferentes, prefixos, vazio e tamanhos distintos não', async () => {
    const token = 'token-de-teste-com-mais-de-32-caracteres-ok';
    expect(await constantTimeEqual(token, token)).toBe(true);
    expect(await constantTimeEqual(token, `${token}x`)).toBe(false);
    expect(await constantTimeEqual(token, token.slice(0, -1))).toBe(false);
    expect(await constantTimeEqual(token, '')).toBe(false);
    expect(await constantTimeEqual('', '')).toBe(true);
    expect(await constantTimeEqual(token, token.toUpperCase())).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('é o SHA-256 em hexadecimal minúsculo', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
