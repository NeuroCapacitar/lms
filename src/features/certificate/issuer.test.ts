import { describe, expect, it } from 'vitest';

import {
  formatCnpj,
  hasUnsafeCharacters,
  isValidCnpj,
  issuerInputSchema,
  normalizeCnpj,
  signatoryInputSchema,
} from './issuer';

describe('CNPJ', () => {
  it('aceita CNPJ válido com ou sem máscara', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('45.723.174/0001-10')).toBe(true);
  });

  it('recusa dígito verificador errado, tamanho errado, repetidos e não texto', () => {
    for (const bad of [
      '11.222.333/0001-82',
      '11.222.333/0001-8',
      '11222333000181 9',
      '00000000000000',
      '11111111111111',
      '',
      null,
      undefined,
      11_222_333_000_181,
    ]) {
      expect(isValidCnpj(bad), String(bad)).toBe(false);
    }
  });

  it('normaliza e formata', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeCnpj('123')).toBeNull();
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('texto seguro', () => {
  it('detecta controle, zero-width, bidi e separador de linha', () => {
    const chars = [0x0000, 0x200b, 0x202e, 0x2028, 0xfeff, 0x0085].map(
      (code) => `a${String.fromCodePoint(code)}b`,
    );
    for (const bad of chars) {
      expect(hasUnsafeCharacters(bad), JSON.stringify(bad)).toBe(true);
    }
    expect(hasUnsafeCharacters('José d’Ávila Çaña')).toBe(false);
  });
});

describe('emitente', () => {
  it('normaliza NFC, espaços e o CNPJ (só dígitos)', () => {
    expect(
      issuerInputSchema.parse({
        legalName: `  Neuro${String.fromCodePoint(0x301)}  Capacitar   LTDA `,
        cnpj: '11.222.333/0001-81',
      }),
    ).toEqual({ legalName: 'Neuró Capacitar LTDA', cnpj: '11222333000181' });
  });

  it('recusa CNPJ inválido, nome curto ou inseguro e campo extra', () => {
    const ok = { legalName: 'Neuro Capacitar LTDA', cnpj: '11222333000181' };
    for (const bad of [
      { ...ok, cnpj: '11222333000182' },
      { ...ok, legalName: 'ab' },
      { ...ok, legalName: `Neuro${String.fromCodePoint(0x202e)}LTDA` },
      { ...ok, legalName: 'x'.repeat(201) },
      { ...ok, extra: 1 },
      { legalName: ok.legalName },
    ]) {
      expect(issuerInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('signatário', () => {
  it('aceita nome, cargo e assinatura opcional', () => {
    const media = crypto.randomUUID();
    expect(
      signatoryInputSchema.parse({
        name: 'Dra. Ana Lima',
        title: 'Diretora Acadêmica',
        signatureMediaId: media,
      }),
    ).toEqual({ name: 'Dra. Ana Lima', title: 'Diretora Acadêmica', signatureMediaId: media });
    expect(
      signatoryInputSchema.parse({ name: 'Ana Lima', title: 'Diretora', signatureMediaId: null })
        .signatureMediaId,
    ).toBeNull();
  });

  it('recusa caractere inseguro, id que não é UUID e campo desconhecido', () => {
    const ok = { name: 'Ana Lima', title: 'Diretora', signatureMediaId: null };
    for (const bad of [
      { ...ok, name: `Ana${String.fromCodePoint(0x200b)}Lima` },
      { ...ok, title: '' },
      { ...ok, signatureMediaId: 'abc' },
      { ...ok, url: 'https://x' },
    ]) {
      expect(signatoryInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
