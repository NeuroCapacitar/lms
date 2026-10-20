import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  REVOCATION_ACTIONS,
  parseRevocationEntry,
  planReplay,
  revocationLogKey,
  type RevocationLogEntry,
} from '../../src/features/ops/revocation-log.ts';
import { readRevocationLogs } from '../../scripts/restore/restore-core.ts';

const COURSE = '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const entry = (overrides: Partial<RevocationLogEntry>): RevocationLogEntry => ({
  version: 1,
  auditId: 1,
  action: 'certificate.revoke',
  targetId: 'alvo-1',
  userId: null,
  courseId: null,
  category: 'erro_de_emissao',
  occurredAt: '2026-10-19T12:00:00.000Z',
  ...overrides,
});

describe('registro das revogações fora do banco', () => {
  it('a chave é ordenável pelo id da auditoria e leva a ação', () => {
    expect(revocationLogKey({ auditId: 42, action: 'certificate.revoke' })).toBe(
      'revocation-log/000000000042-certificate.revoke.json',
    );
    expect(
      revocationLogKey({ auditId: 7, action: 'account.suspend' }) <
        revocationLogKey({ auditId: 42, action: 'account.suspend' }),
    ).toBe(true);
  });

  it('aceita um registro válido e recusa ação desconhecida, versão, ids e datas inválidos', () => {
    expect(parseRevocationEntry(entry({}))).toEqual(entry({}));
    expect(REVOCATION_ACTIONS).toHaveLength(6);
    for (const bad of [
      null,
      'texto',
      { ...entry({}), version: 2 },
      { ...entry({}), action: 'role.grant' },
      { ...entry({}), auditId: 0 },
      { ...entry({}), auditId: 1.5 },
      { ...entry({}), targetId: '' },
      { ...entry({}), courseId: 'não-é-uuid' },
      { ...entry({}), occurredAt: 'ontem' },
      { ...entry({}), userId: 5 },
    ])
      expect(parseRevocationEntry(bad), JSON.stringify(bad)).toBeNull();
  });

  it('não existe campo para motivo, nota, nome ou e-mail (o registro só carrega ids)', () => {
    const keys = Object.keys(entry({})).sort();
    expect(keys).toEqual([
      'action',
      'auditId',
      'category',
      'courseId',
      'occurredAt',
      'targetId',
      'userId',
      'version',
    ]);
    expect(
      JSON.stringify(
        parseRevocationEntry({ ...entry({}), reason: 'texto livre', note: 'segredo' }),
      ),
    ).not.toMatch(/texto livre|segredo/);
  });
});

describe('o que reaplicar depois de restaurar', () => {
  it('revogação de certificado e de direito vale uma vez, mesmo repetida no registro', () => {
    const steps = planReplay([
      entry({ auditId: 1, targetId: 'cert-1' }),
      entry({ auditId: 5, targetId: 'cert-1' }),
      entry({ auditId: 2, action: 'entitlement.revoke', targetId: 'dir-1', category: null }),
    ]);
    expect(steps).toEqual([
      {
        kind: 'certificate.revoke',
        certificateId: 'cert-1',
        category: 'erro_de_emissao',
        occurredAt: '2026-10-19T12:00:00.000Z',
      },
      { kind: 'entitlement.revoke', entitlementId: 'dir-1' },
    ]);
  });

  it('vale o ÚLTIMO evento de cada conta e matrícula (suspensão levantada não volta a bloquear)', () => {
    const steps = planReplay([
      entry({ auditId: 3, action: 'account.reactivate', targetId: 'u-1', category: null }),
      entry({ auditId: 1, action: 'account.suspend', targetId: 'u-1', category: null }),
      entry({ auditId: 2, action: 'account.suspend', targetId: 'u-2', category: null }),
      entry({
        auditId: 4,
        action: 'enrollment.suspend',
        targetId: `${COURSE}:u-3`,
        userId: 'u-3',
        courseId: COURSE,
        category: null,
      }),
      entry({
        auditId: 6,
        action: 'enrollment.reinstate',
        targetId: `${COURSE}:u-3`,
        userId: 'u-3',
        courseId: COURSE,
        category: null,
      }),
      entry({
        auditId: 7,
        action: 'enrollment.suspend',
        targetId: `${COURSE}:u-3`,
        userId: 'u-3',
        courseId: COURSE,
        category: null,
      }),
    ]);
    expect(steps).toContainEqual({ kind: 'account', userId: 'u-1', suspended: false });
    expect(steps).toContainEqual({ kind: 'account', userId: 'u-2', suspended: true });
    expect(steps).toContainEqual({
      kind: 'enrollment',
      userId: 'u-3',
      courseId: COURSE,
      suspended: true,
    });
    expect(steps).toHaveLength(3);
  });

  it('matrícula sem usuário ou curso no registro é ignorada (não dá para reaplicar às cegas)', () => {
    expect(
      planReplay([
        entry({ action: 'enrollment.suspend', targetId: 'x', userId: null, courseId: null }),
      ]),
    ).toEqual([]);
  });
});

describe('pasta do registro baixada do R2', () => {
  it('lê tudo em ordem e interrompe diante de um arquivo inválido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-revlog-'));
    try {
      writeFileSync(
        join(dir, revocationLogKey(entry({ auditId: 2 })).split('/')[1]!),
        JSON.stringify(entry({ auditId: 2 })),
      );
      writeFileSync(
        join(dir, revocationLogKey(entry({ auditId: 1 })).split('/')[1]!),
        JSON.stringify(entry({ auditId: 1 })),
      );
      expect(readRevocationLogs(dir).map((item) => item.auditId)).toEqual([1, 2]);
      writeFileSync(join(dir, 'revocation-log-ruim.json'), JSON.stringify({ version: 9 }));
      expect(() => readRevocationLogs(dir)).toThrow('inválido');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
