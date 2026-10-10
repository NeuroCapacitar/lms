import { describe, expect, it } from 'vitest';

import { linkConfirmSchema, linkRequestSchema, normalizeEmail } from './email';
import { decideDelivery } from './link-policy';

describe('decideDelivery', () => {
  it('aluno novo e aluno existente recebem o link', () => {
    expect(decideDelivery({ userExists: false, isStaffEmail: false, isSuspended: false })).toBe(
      'send',
    );
    expect(decideDelivery({ userExists: true, isStaffEmail: false, isSuspended: false })).toBe(
      'send',
    );
  });

  it('conta suspensa não recebe link (o login seria recusado), com ou sem Staff', () => {
    expect(decideDelivery({ userExists: true, isStaffEmail: false, isSuspended: true })).toBe(
      'skip',
    );
    expect(decideDelivery({ userExists: true, isStaffEmail: true, isSuspended: true })).toBe(
      'skip',
    );
  });

  it('e-mail de Staff só recebe link se o usuário já existe (convite aceito)', () => {
    expect(decideDelivery({ userExists: false, isStaffEmail: true, isSuspended: false })).toBe(
      'skip',
    );
    expect(decideDelivery({ userExists: true, isStaffEmail: true, isSuspended: false })).toBe(
      'send',
    );
  });
});

describe('schemas de entrada', () => {
  it('normaliza o e-mail (espaços e maiúsculas)', () => {
    expect(normalizeEmail('  Pessoa@Example.COM ')).toBe('pessoa@example.com');
    const parsed = linkRequestSchema.parse({ email: ' Pessoa@Example.COM ', captchaToken: 'x' });
    expect(parsed.email).toBe('pessoa@example.com');
  });

  it('recusa e-mail inválido, captcha ausente e campos fora do tamanho', () => {
    expect(linkRequestSchema.safeParse({ email: 'sem-arroba', captchaToken: 'x' }).success).toBe(
      false,
    );
    expect(linkRequestSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
    expect(
      linkRequestSchema.safeParse({ email: `${'a'.repeat(250)}@b.co`, captchaToken: 'x' }).success,
    ).toBe(false);
    expect(linkConfirmSchema.safeParse({ token: 'curto' }).success).toBe(false);
    expect(linkConfirmSchema.safeParse({ token: 'a'.repeat(32) }).success).toBe(true);
  });

  it('ignora campos extras sem quebrar (nada além do esperado passa adiante)', () => {
    const parsed = linkRequestSchema.parse({ email: 'a@b.co', captchaToken: 'x', role: 'admin' });
    expect(Object.keys(parsed).sort()).toEqual(['captchaToken', 'email']);
  });
});
