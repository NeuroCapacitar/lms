import { describe, expect, it } from 'vitest';

import { RENOTIFY_AFTER_MS, planNotifications } from './alert-notify';
import type { OpsAlert } from './operations';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const H = 3_600_000;

const alert = (code: string, severity: OpsAlert['severity'] = 'P1'): OpsAlert => ({
  code,
  severity,
  message: `mensagem de ${code}`,
});

describe('quem merece uma notificação nova', () => {
  it('alerta novo (sem estado) notifica; sem alertas, nada a enviar nem a apagar', () => {
    expect(planNotifications([alert('backup_stale')], [], NOW)).toEqual({
      notify: [alert('backup_stale')],
      clear: [],
    });
    expect(planNotifications([], [], NOW)).toEqual({ notify: [], clear: [] });
  });

  it('alerta que persiste NÃO notifica a cada ciclo: só depois de 24 h (P0 a P2)', () => {
    for (const severity of ['P0', 'P1', 'P2'] as const) {
      const states = [{ code: 'x', lastNotifiedAt: NOW - (24 * H - 1) }];
      expect(planNotifications([alert('x', severity)], states, NOW).notify).toEqual([]);
      const old = [{ code: 'x', lastNotifiedAt: NOW - 24 * H }];
      expect(planNotifications([alert('x', severity)], old, NOW).notify).toHaveLength(1);
    }
  });

  it('P3 é semanal', () => {
    expect(RENOTIFY_AFTER_MS.P3).toBe(7 * 24 * H);
    const states = [{ code: 'x', lastNotifiedAt: NOW - 6 * 24 * H }];
    expect(planNotifications([alert('x', 'P3')], states, NOW).notify).toEqual([]);
    const old = [{ code: 'x', lastNotifiedAt: NOW - 7 * 24 * H }];
    expect(planNotifications([alert('x', 'P3')], old, NOW).notify).toHaveLength(1);
  });

  it('estado que nunca foi notificado (envio anterior falhou) notifica de novo já', () => {
    const states = [{ code: 'x', lastNotifiedAt: null }];
    expect(planNotifications([alert('x')], states, NOW).notify).toHaveLength(1);
  });

  it('alerta que sumiu tem o estado apagado, então se voltar notifica na hora', () => {
    const states = [
      { code: 'sumiu', lastNotifiedAt: NOW - H },
      { code: 'fica', lastNotifiedAt: NOW - H },
    ];
    const plan = planNotifications([alert('fica')], states, NOW);
    expect(plan.clear).toEqual(['sumiu']);
    expect(plan.notify).toEqual([]);
    expect(planNotifications([alert('sumiu')], [], NOW).notify).toHaveLength(1);
  });

  it('só notifica o que mudou, mesmo com vários alertas', () => {
    const states = [
      { code: 'velho', lastNotifiedAt: NOW - 30 * H },
      { code: 'recente', lastNotifiedAt: NOW - H },
    ];
    const plan = planNotifications([alert('velho'), alert('recente'), alert('novo')], states, NOW);
    expect(plan.notify.map((a) => a.code)).toEqual(['velho', 'novo']);
  });
});
