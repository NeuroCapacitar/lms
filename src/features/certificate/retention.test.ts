import { describe, expect, it } from 'vitest';

import {
  MAX_RETENTION_DAYS,
  isRetentionMisconfigured,
  parseRetentionDays,
  purgeLogKey,
} from './retention';

describe('parseRetentionDays: o prazo é decisão jurídica, então só liga com um valor claro', () => {
  it.each([
    ['90', 90],
    [' 90 ', 90],
    ['1', 1],
    ['3650', 3650],
  ])('"%s" → %d dias', (raw, days) => {
    expect(parseRetentionDays(raw)).toBe(days);
    expect(isRetentionMisconfigured(raw)).toBe(false);
  });

  it.each([undefined, '', '   '])(
    '%j → purga desligada, e isso NÃO é erro de configuração',
    (raw) => {
      expect(parseRetentionDays(raw)).toBeNull();
      expect(isRetentionMisconfigured(raw)).toBe(false);
    },
  );

  it.each(['0', '-5', 'abc', '90 dias', '9.5', '3651', '99999', '1e3', '٩٠'])(
    '%j → desligada e conta como configuração inválida (vira alerta, nunca um prazo assumido)',
    (raw) => {
      expect(parseRetentionDays(raw)).toBeNull();
      expect(isRetentionMisconfigured(raw)).toBe(true);
    },
  );

  it('o teto é de dez anos', () => {
    expect(MAX_RETENTION_DAYS).toBe(3650);
  });
});

describe('purgeLogKey', () => {
  it('um objeto por certificado, sempre a mesma chave (refazer sobrescreve)', () => {
    const id = '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(purgeLogKey(id)).toBe(`purge-log/revoked-pdf/${id}.json`);
    expect(purgeLogKey(id)).toBe(purgeLogKey(id));
  });
});
