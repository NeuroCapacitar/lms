import { describe, expect, it } from 'vitest';

import {
  backupFreshness,
  backupObjectKey,
  buildManifest,
  manifestKey,
  planRetention,
  sha256Hex,
  verifyManifest,
  type BackupManifest,
} from '../../scripts/backup/backup-core.ts';

const bytes = new TextEncoder().encode('conteudo cifrado de teste');
const at = new Date('2026-10-17T03:05:09.000Z');

function manifest(createdAt: string, kind: 'daily' | 'release' = 'daily'): BackupManifest {
  return buildManifest({
    kind,
    createdAt: new Date(createdAt),
    encrypted: bytes,
    migrations: 41,
    pgVersion: '18.1',
  });
}

describe('manifesto do backup', () => {
  it('guarda SHA-256, tamanho, versão de migration e um nome previsível', () => {
    const m = buildManifest({
      kind: 'daily',
      createdAt: at,
      encrypted: bytes,
      migrations: 41,
      pgVersion: '18.1',
    });
    expect(m.sha256).toBe(sha256Hex(bytes));
    expect(m.size).toBe(bytes.byteLength);
    expect(m.migrations).toBe(41);
    expect(m.object).toBe('daily/2026-10-17/hub-20261017T030509Z.dump.age');
    expect(manifestKey(m.object)).toBe('daily/2026-10-17/hub-20261017T030509Z.manifest.json');
  });

  it('o de release vai para release/ e recusa backup vazio e migration inválida', () => {
    expect(backupObjectKey('release', at)).toBe('release/2026-10-17/hub-20261017T030509Z.dump.age');
    expect(() =>
      buildManifest({
        kind: 'daily',
        createdAt: at,
        encrypted: new Uint8Array(),
        migrations: 1,
        pgVersion: '18',
      }),
    ).toThrow('vazio');
    expect(() =>
      buildManifest({
        kind: 'daily',
        createdAt: at,
        encrypted: bytes,
        migrations: -1,
        pgVersion: '18',
      }),
    ).toThrow('migration');
    expect(() => manifestKey('daily/x.txt')).toThrow();
  });

  it('dump íntegro passa; corrompido, truncado e trocado são detectados ANTES de decifrar', () => {
    const m = manifest('2026-10-17T03:00:00Z');
    expect(verifyManifest(m, bytes)).toEqual({ ok: true });

    const corrupted = new Uint8Array(bytes);
    corrupted[3] = (corrupted[3] ?? 0) ^ 1;
    expect(verifyManifest(m, corrupted)).toEqual({ ok: false, reason: 'sha256' });
    expect(verifyManifest(m, bytes.slice(0, bytes.byteLength - 1))).toEqual({
      ok: false,
      reason: 'size',
    });
    expect(verifyManifest({ ...m, sha256: 'x' }, bytes)).toEqual({ ok: false, reason: 'shape' });
    expect(verifyManifest(null, bytes)).toEqual({ ok: false, reason: 'shape' });
    expect(verifyManifest({ ...m, object: 'daily/x.txt' }, bytes)).toEqual({
      ok: false,
      reason: 'shape',
    });
  });
});

describe('frescor do último backup (alerta de backup velho)', () => {
  const now = new Date('2026-10-17T12:00:00Z');

  it('sem nenhum backup: missing', () => {
    expect(backupFreshness([], now)).toEqual({ state: 'missing' });
  });

  it('usa o mais recente e o limite é 26 h, não 24 (o agendador do GitHub atrasa)', () => {
    const list = [manifest('2026-10-15T03:00:00Z'), manifest('2026-10-16T10:00:00Z')];
    expect(backupFreshness(list, now)).toMatchObject({ state: 'fresh', ageHours: 26 });
    expect(backupFreshness(list, new Date('2026-10-17T12:00:01Z'))).toMatchObject({
      state: 'stale',
    });
    expect(backupFreshness(list, new Date('2026-10-17T12:00:01Z'), 48)).toMatchObject({
      state: 'fresh',
    });
  });
});

describe('retenção (14 diários + 4 semanais; release nunca)', () => {
  /** Um diário por dia, de `start` por `days` dias. */
  function dailies(start: string, days: number): BackupManifest[] {
    const out: BackupManifest[] = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.parse(start) + i * 86_400_000);
      out.push(manifest(d.toISOString()));
    }
    return out;
  }

  it('até 14 diários: nada é apagado', () => {
    const list = dailies('2026-10-04T03:00:00Z', 14);
    expect(planRetention(list).remove).toHaveLength(0);
  });

  it('60 dias: mantém os 14 últimos mais o último diário de cada uma das 4 semanas anteriores', () => {
    const list = dailies('2026-08-19T03:00:00Z', 60);
    const { keep, remove } = planRetention(list);
    expect(keep.length + remove.length).toBe(60);
    const last = list[59];
    const newest14 = list.slice(46);
    for (const m of newest14) expect(keep).toContain(m);
    expect(keep).toContain(last);
    // 14 diários + o diário mais novo de cada uma das 4 semanas ISO seguintes, todas fora da janela
    expect(keep).toHaveLength(14 + 4);
    expect(remove.every((m) => Date.parse(m.createdAt) < Date.parse(newest14[0]!.createdAt))).toBe(
      true,
    );
  });

  it('release nunca entra na lista para apagar, por mais antigo que seja', () => {
    const release = manifest('2025-01-01T00:00:00Z', 'release');
    const list = [release, ...dailies('2026-08-19T03:00:00Z', 60)];
    const plan = planRetention(list);
    expect(plan.keep).toContain(release);
    expect(plan.remove).not.toContain(release);
  });

  it('a política é parâmetro e não altera a lista de entrada', () => {
    const list = dailies('2026-10-01T03:00:00Z', 10);
    const copy = [...list];
    const plan = planRetention(list, { daily: 3, weekly: 0 });
    expect(plan.keep.filter((m) => m.kind === 'daily').length).toBeGreaterThanOrEqual(3);
    expect(list).toEqual(copy);
  });
});
