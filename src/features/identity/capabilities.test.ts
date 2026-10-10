import { describe, expect, it } from 'vitest';

import {
  ADMIN_ONLY_CAPABILITIES,
  ALL_CAPABILITIES,
  DELEGABLE_CAPABILITIES,
  STAFF_READ,
  effectiveCapabilities,
  hasCapability,
  isDelegable,
  type AccessContext,
  type DelegableCapability,
  type Role,
} from './capabilities';

const person = (
  roles: Role[],
  grants: DelegableCapability[] = [],
  suspended = false,
): AccessContext => ({
  userId: 'u1',
  suspended,
  roles: new Set(roles),
  grants: new Set(grants),
});

describe('catálogo', () => {
  it('não há capability repetida nem uma que seja ao mesmo tempo só-Admin e delegável', () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
    for (const capability of ADMIN_ONLY_CAPABILITIES) expect(isDelegable(capability)).toBe(false);
    for (const capability of DELEGABLE_CAPABILITIES) expect(isDelegable(capability)).toBe(true);
  });
});

describe('hasCapability (matriz: student, suporte sem grant, suporte com grant, admin)', () => {
  it('student (sem papel) não tem nenhuma capability de Staff, nem a leitura básica', () => {
    const student = person([]);
    for (const capability of ALL_CAPABILITIES)
      expect(hasCapability(student, capability)).toBe(false);
  });

  it('suporte sem grant: só a leitura básica', () => {
    const support = person(['support']);
    expect(effectiveCapabilities(support)).toEqual([STAFF_READ]);
  });

  it('suporte com grant: leitura básica mais exatamente os grants recebidos', () => {
    const support = person(['support'], ['course.edit', 'audit.view']);
    expect(new Set(effectiveCapabilities(support))).toEqual(
      new Set([STAFF_READ, 'course.edit', 'audit.view']),
    );
    expect(hasCapability(support, 'refund.execute')).toBe(false);
  });

  it('suporte nunca tem capability só-Admin, nem por um grant que tente ser incluído', () => {
    const support = person(['support'], ['course.edit']);
    for (const capability of ADMIN_ONLY_CAPABILITIES)
      expect(hasCapability(support, capability)).toBe(false);
    // grant "forjado" na memória: o tipo impede, e a regra também (só delegáveis contam)
    const forged = { ...support, grants: new Set(['course.create']) } as unknown as AccessContext;
    expect(hasCapability(forged, 'course.create')).toBe(false);
  });

  it('admin tem todas as capabilities', () => {
    const admin = person(['admin']);
    for (const capability of ALL_CAPABILITIES) expect(hasCapability(admin, capability)).toBe(true);
  });

  it('papéis não exclusivos: admin e suporte juntos = admin', () => {
    expect(effectiveCapabilities(person(['support', 'admin'])).length).toBe(
      ALL_CAPABILITIES.length,
    );
  });

  it('conta suspensa não tem nada, nem como admin', () => {
    expect(effectiveCapabilities(person(['admin'], [], true))).toEqual([]);
    expect(effectiveCapabilities(person(['support'], ['course.edit'], true))).toEqual([]);
  });

  it('grant sem o papel de suporte não vale (papel é pré-requisito)', () => {
    expect(hasCapability(person([], ['course.edit']), 'course.edit')).toBe(false);
  });
});
