import { describe, expect, it } from 'vitest';

import {
  CLOCK_TOLERANCE_MS,
  OFFLINE_LEASE_MS,
  advanceClock,
  computeLeaseUntil,
  evaluateOfflineLease,
  leaseUntilOnDeviceClock,
  offlineLeaseSchema,
} from './offline-lease';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('lease do acesso offline', () => {
  it('vale 72 h quando o direito dura mais que isso', () => {
    const expires = new Date(NOW.getTime() + 30 * 24 * HOUR);
    expect(computeLeaseUntil(expires, NOW).getTime()).toBe(NOW.getTime() + OFFLINE_LEASE_MS);
  });

  it('nunca passa da expiração do direito', () => {
    const expires = new Date(NOW.getTime() + 5 * HOUR);
    expect(computeLeaseUntil(expires, NOW)).toEqual(expires);
  });

  it('direito que expira exatamente agora gera lease já vencido (nunca no futuro)', () => {
    expect(computeLeaseUntil(NOW, NOW)).toEqual(NOW);
  });

  describe('evaluateOfflineLease', () => {
    const lease = NOW.getTime() + 10 * HOUR;

    it('sem lease: none', () => {
      expect(
        evaluateOfflineLease({ leaseUntil: null, now: NOW.getTime(), maxSeenClock: null }),
      ).toEqual({
        status: 'none',
      });
    });

    it('dentro do lease: valid, com o tempo que falta', () => {
      expect(
        evaluateOfflineLease({
          leaseUntil: lease,
          now: NOW.getTime(),
          maxSeenClock: NOW.getTime(),
        }),
      ).toEqual({ status: 'valid', remainingMs: 10 * HOUR });
    });

    it('no instante do vencimento já é expired (fim exclusivo)', () => {
      expect(
        evaluateOfflineLease({ leaseUntil: lease, now: lease, maxSeenClock: null }).status,
      ).toBe('expired');
    });

    it('relógio adiantado só ANTECIPA o fim do lease', () => {
      expect(
        evaluateOfflineLease({ leaseUntil: lease, now: lease + HOUR, maxSeenClock: NOW.getTime() })
          .status,
      ).toBe('expired');
    });

    it('relógio atrasado além da tolerância bloqueia, mesmo com lease aparentemente em dia', () => {
      const seen = NOW.getTime() + 2 * HOUR;
      expect(
        evaluateOfflineLease({ leaseUntil: lease, now: NOW.getTime(), maxSeenClock: seen }).status,
      ).toBe('clock_suspect');
    });

    it('recuo dentro da tolerância não bloqueia', () => {
      const seen = NOW.getTime() + CLOCK_TOLERANCE_MS - 1;
      expect(
        evaluateOfflineLease({ leaseUntil: lease, now: NOW.getTime(), maxSeenClock: seen }).status,
      ).toBe('valid');
    });

    it('o relógio suspeito vale mesmo com lease vencido (mensagem do relógio vem primeiro)', () => {
      expect(
        evaluateOfflineLease({
          leaseUntil: NOW.getTime() - HOUR,
          now: NOW.getTime() - 10 * HOUR,
          maxSeenClock: NOW.getTime(),
        }).status,
      ).toBe('clock_suspect');
    });
  });

  it('o maior instante visto só sobe', () => {
    expect(advanceClock(null, 100)).toBe(100);
    expect(advanceClock(100, 90)).toBe(100);
    expect(advanceClock(100, 120)).toBe(120);
  });

  it('o esquema da resposta recusa data inválida e id que não é UUID', () => {
    const ok = {
      serverNow: NOW.toISOString(),
      courses: [
        { courseId: '11111111-1111-4111-8111-111111111111', leaseUntil: NOW.toISOString() },
      ],
    };
    expect(offlineLeaseSchema.safeParse(ok).success).toBe(true);
    expect(offlineLeaseSchema.safeParse({ ...ok, serverNow: 'ontem' }).success).toBe(false);
    expect(
      offlineLeaseSchema.safeParse({
        ...ok,
        courses: [{ courseId: 'x', leaseUntil: NOW.toISOString() }],
      }).success,
    ).toBe(false);
  });
});

describe('fim do lease no relógio do aparelho', () => {
  const lease = '2026-10-18T12:00:00.000Z';
  const server = '2026-10-15T12:00:00.000Z';

  it('relógio em dia: o mesmo instante', () => {
    expect(
      leaseUntilOnDeviceClock({
        leaseUntil: lease,
        serverNow: server,
        deviceNow: Date.parse(server),
      }),
    ).toBe(Date.parse(lease));
  });

  it('aparelho atrasado 3 dias na verificação: o lease continua valendo 72 h do relógio dele', () => {
    const deviceNow = Date.parse(server) - 3 * DAY;
    expect(leaseUntilOnDeviceClock({ leaseUntil: lease, serverNow: server, deviceNow })).toBe(
      deviceNow + 3 * DAY,
    );
  });

  it('aparelho adiantado: o lease encurta junto (sem estender o direito)', () => {
    const deviceNow = Date.parse(server) + 2 * DAY;
    expect(leaseUntilOnDeviceClock({ leaseUntil: lease, serverNow: server, deviceNow })).toBe(
      deviceNow + 3 * DAY,
    );
  });
});
