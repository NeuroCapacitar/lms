import { describe, expect, it } from 'vitest';

import { isGateEmail } from './gate-account-core.ts';

describe('e-mail de teste do gate', () => {
  it('aceita só endereços com o sufixo +gate', () => {
    expect(isGateEmail('caixa+gate-a@example.test')).toBe(true);
    expect(isGateEmail('caixa+gate-b@example.test')).toBe(true);
    expect(isGateEmail('caixa+gate@example.test')).toBe(true);
    expect(isGateEmail('Caixa+GATE-A@Example.Test')).toBe(true);
  });

  it('recusa e-mail comum, sufixo diferente, vários arrobas, espaço e vazio', () => {
    for (const email of [
      'aluno@example.test',
      'caixa+outro@example.test',
      'caixa+gat@example.test',
      'gate@example.test',
      'caixa+gate-a@@example.test',
      'caixa +gate@example.test',
      'caixa+gate-a@example',
      '',
    ]) {
      expect(isGateEmail(email), email).toBe(false);
    }
  });
});
