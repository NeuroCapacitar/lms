import { describe, expect, it } from 'vitest';

import { addCalendarMonths, decideAccess, effectiveExpiry, type EntitlementWindow } from './access';

const d = (value: string) => new Date(value);
const iso = (value: Date) => value.toISOString();

describe('addCalendarMonths', () => {
  it.each([
    ['2026-01-31T10:00:00Z', 1, '2026-02-28T10:00:00.000Z'],
    ['2028-01-31T10:00:00Z', 1, '2028-02-29T10:00:00.000Z'],
    ['2026-03-31T00:00:00Z', 1, '2026-04-30T00:00:00.000Z'],
    ['2028-02-29T12:30:00Z', 12, '2029-02-28T12:30:00.000Z'],
    ['2026-10-11T08:00:00Z', 3, '2027-01-11T08:00:00.000Z'],
    ['2026-11-30T23:59:59Z', 3, '2027-02-28T23:59:59.000Z'],
    ['2026-01-15T00:00:00Z', 12, '2027-01-15T00:00:00.000Z'],
    ['2026-12-31T00:00:00Z', 2, '2027-02-28T00:00:00.000Z'],
    ['2026-05-31T00:00:00Z', 600, '2076-05-31T00:00:00.000Z'],
  ])('%s + %i mês(es) = %s', (from, months, expected) => {
    expect(iso(addCalendarMonths(d(from), months))).toBe(expected);
  });

  it('não altera a data original', () => {
    const from = d('2026-01-31T00:00:00Z');
    addCalendarMonths(from, 1);
    expect(iso(from)).toBe('2026-01-31T00:00:00.000Z');
  });

  it('recusa prazo fora de 1 a 600 meses ou não inteiro', () => {
    for (const bad of [0, -1, 601, 1.5, Number.NaN]) {
      expect(() => addCalendarMonths(d('2026-01-01T00:00:00Z'), bad), String(bad)).toThrow(
        RangeError,
      );
    }
  });
});

const window = (
  startsAt: string,
  expiresAt: string,
  revokedAt: string | null = null,
): EntitlementWindow => ({
  startsAt: d(startsAt),
  expiresAt: d(expiresAt),
  revokedAt: revokedAt ? d(revokedAt) : null,
});

describe('effectiveExpiry', () => {
  it('é a MAIOR expiração dos não revogados (não soma) e nula sem direito', () => {
    expect(effectiveExpiry([])).toBeNull();
    expect(
      iso(
        effectiveExpiry([
          window('2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
          window('2026-02-01T00:00:00Z', '2027-02-01T00:00:00Z'),
          window('2026-03-01T00:00:00Z', '2026-09-01T00:00:00Z'),
        ])!,
      ),
    ).toBe('2027-02-01T00:00:00.000Z');
  });

  it('ignora os revogados', () => {
    expect(
      iso(
        effectiveExpiry([
          window('2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
          window('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'),
        ])!,
      ),
    ).toBe('2026-06-01T00:00:00.000Z');
    expect(
      effectiveExpiry([
        window('2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
      ]),
    ).toBeNull();
  });
});

describe('decideAccess', () => {
  const enrollment = { anchorAt: d('2026-01-10T00:00:00Z'), suspendedAt: null };
  const live = window('2026-01-10T00:00:00Z', '2026-04-10T00:00:00Z');
  const base = { enrollment, accountSuspended: false, entitlements: [live] };

  it('sem matrícula: no_access, sem âncora', () => {
    expect(decideAccess({ ...base, enrollment: null, now: d('2026-02-01T00:00:00Z') })).toEqual({
      hasAccess: false,
      reason: 'no_access',
      anchorAt: null,
      expiresAt: null,
    });
  });

  it('antes, no instante e depois da expiração (fronteira: expirou NO instante)', () => {
    const at = (now: string) => decideAccess({ ...base, now: d(now) });
    expect(at('2026-04-09T23:59:59.999Z')).toMatchObject({ hasAccess: true, reason: 'ok' });
    expect(at('2026-04-10T00:00:00.000Z')).toMatchObject({ hasAccess: false, reason: 'expired' });
    expect(at('2026-06-01T00:00:00Z')).toMatchObject({ hasAccess: false, reason: 'expired' });
  });

  it('o direito só vale a partir de starts_at', () => {
    const future = window('2026-03-01T00:00:00Z', '2026-06-01T00:00:00Z');
    const result = decideAccess({
      ...base,
      entitlements: [future],
      now: d('2026-02-01T00:00:00Z'),
    });
    expect(result).toMatchObject({ hasAccess: false, reason: 'no_access' });
  });

  it('vários direitos: um expirado e outro válido dão acesso, com a maior expiração', () => {
    const expired = window('2025-01-01T00:00:00Z', '2025-04-01T00:00:00Z');
    const result = decideAccess({
      ...base,
      entitlements: [expired, live],
      now: d('2026-02-01T00:00:00Z'),
    });
    expect(result).toMatchObject({ hasAccess: true, reason: 'ok' });
    expect(iso(result.expiresAt!)).toBe('2026-04-10T00:00:00.000Z');
  });

  it('direito revogado não conta; só revogados = no_access (não expired)', () => {
    const revoked = window('2026-01-10T00:00:00Z', '2026-04-10T00:00:00Z', '2026-01-20T00:00:00Z');
    expect(
      decideAccess({ ...base, entitlements: [revoked], now: d('2026-02-01T00:00:00Z') }),
    ).toMatchObject({ hasAccess: false, reason: 'no_access', expiresAt: null });
    expect(
      decideAccess({ ...base, entitlements: [revoked, live], now: d('2026-02-01T00:00:00Z') })
        .hasAccess,
    ).toBe(true);
  });

  it('conta suspensa ou matrícula suspensa: suspended, mesmo com direito válido', () => {
    const now = d('2026-02-01T00:00:00Z');
    expect(decideAccess({ ...base, accountSuspended: true, now })).toMatchObject({
      hasAccess: false,
      reason: 'suspended',
    });
    expect(
      decideAccess({
        ...base,
        enrollment: { ...enrollment, suspendedAt: d('2026-01-15T00:00:00Z') },
        now,
      }),
    ).toMatchObject({ hasAccess: false, reason: 'suspended' });
  });

  it('a âncora é a da matrícula, também depois de expirar (nova concessão a mantém)', () => {
    const result = decideAccess({ ...base, now: d('2027-01-01T00:00:00Z') });
    expect(iso(result.anchorAt!)).toBe('2026-01-10T00:00:00.000Z');
  });

  it('a decisão depende só do `agora` recebido', () => {
    const early = decideAccess({ ...base, now: d('2026-01-11T00:00:00Z') });
    const late = decideAccess({ ...base, now: d('2026-05-11T00:00:00Z') });
    expect([early.hasAccess, late.hasAccess]).toEqual([true, false]);
  });
});
