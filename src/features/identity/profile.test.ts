import { describe, expect, it } from 'vitest';

import { profilePatchSchema } from './profile';

describe('profilePatchSchema', () => {
  it('aceita um campo só e normaliza espaços', () => {
    expect(profilePatchSchema.parse({ displayName: '  Maria  ' })).toEqual({
      displayName: 'Maria',
    });
    expect(profilePatchSchema.parse({ autoAdvance: true })).toEqual({ autoAdvance: true });
    expect(profilePatchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
  });

  it('campo fora da lista falha (e-mail, papel, userId, id), mesmo junto de campos válidos', () => {
    for (const extra of [
      'email',
      'role',
      'userId',
      'id',
      'emailVerified',
      'certificateNameConfirmedAt',
    ]) {
      expect(
        profilePatchSchema.safeParse({ displayName: 'Ana', [extra]: 'x' }).success,
        extra,
      ).toBe(false);
    }
  });

  it('corpo vazio e tipos errados falham', () => {
    expect(profilePatchSchema.safeParse({}).success).toBe(false);
    expect(profilePatchSchema.safeParse({ autoAdvance: 'sim' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ displayName: '' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ displayName: 'a'.repeat(81) }).success).toBe(false);
  });

  it('recusa caracteres de controle (quebra de linha, tabulação, nulo)', () => {
    for (const bad of ['Ana\nSilva', 'Ana\tSilva', 'Ana\u0000', 'Ana\u0007']) {
      expect(profilePatchSchema.safeParse({ displayName: bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    expect(profilePatchSchema.safeParse({ displayName: 'João da Conceição Ávila' }).success).toBe(
      true,
    );
  });

  it('nome do certificado: 3 a 120 caracteres, e null ou texto vazio limpam', () => {
    expect(profilePatchSchema.parse({ certificateName: 'Ana Maria Silva' })).toEqual({
      certificateName: 'Ana Maria Silva',
    });
    expect(profilePatchSchema.parse({ certificateName: null })).toEqual({ certificateName: null });
    expect(profilePatchSchema.parse({ certificateName: '' })).toEqual({ certificateName: null });
    expect(profilePatchSchema.safeParse({ certificateName: 'ab' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ certificateName: 'a'.repeat(121) }).success).toBe(false);
  });
});
