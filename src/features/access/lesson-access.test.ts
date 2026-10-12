import { describe, expect, it } from 'vitest';

import {
  computeLessonAccess,
  moduleReleaseAt,
  type LessonAccessInput,
  type LessonAccessModule,
} from './lesson-access';

const d = (value: string) => new Date(value);
const iso = (value: Date | null) => value?.toISOString() ?? null;

describe('moduleReleaseAt (dia civil de São Paulo)', () => {
  it.each([
    // âncora (UTC) | D+N | liberação (UTC, 00:00 de São Paulo)
    ['2026-10-11T23:30:00Z', 0, '2026-10-11T03:00:00.000Z'],
    ['2026-10-11T23:30:00Z', 1, '2026-10-12T03:00:00.000Z'],
    // 02:00Z ainda é 23:00 do dia 11 em São Paulo: o D+1 é o dia 12
    ['2026-10-12T02:00:00Z', 1, '2026-10-12T03:00:00.000Z'],
    // 03:00Z é 00:00 do dia 12 em São Paulo: o D+1 é o dia 13
    ['2026-10-12T03:00:00Z', 1, '2026-10-13T03:00:00.000Z'],
    ['2026-10-12T02:59:59.999Z', 0, '2026-10-11T03:00:00.000Z'],
    ['2026-01-30T15:00:00Z', 3, '2026-02-02T03:00:00.000Z'],
    ['2028-02-27T15:00:00Z', 2, '2028-02-29T03:00:00.000Z'],
    ['2026-12-31T15:00:00Z', 7, '2027-01-07T03:00:00.000Z'],
    ['2026-10-11T12:00:00Z', 14, '2026-10-25T03:00:00.000Z'],
    ['2026-10-11T12:00:00Z', 3650, '2036-10-08T03:00:00.000Z'],
  ])('âncora %s + D+%i libera em %s', (anchor, days, expected) => {
    expect(iso(moduleReleaseAt(d(anchor), days))).toBe(expected);
  });

  it('a hora da âncora não muda a liberação dentro do mesmo dia civil', () => {
    const early = moduleReleaseAt(d('2026-10-11T03:00:00Z'), 5);
    const late = moduleReleaseAt(d('2026-10-12T02:59:59Z'), 5);
    expect(iso(early)).toBe(iso(late));
  });
});

const lesson = (id: string, isOptional = false, retired = false) => ({ id, isOptional, retired });
const mod = (
  id: string,
  dripDays: number,
  ...lessons: LessonAccessModule['lessons']
): LessonAccessModule => ({
  id,
  dripDays,
  lessons,
});

const ACCESS_OK = { hasAccess: true, reason: 'ok' as const, anchorAt: d('2026-10-11T15:00:00Z') };

function decide(over: Partial<LessonAccessInput> & Pick<LessonAccessInput, 'modules'>) {
  return computeLessonAccess({
    access: ACCESS_OK,
    now: d('2026-10-11T16:00:00Z'),
    sequenceMode: 'free',
    completed: new Set(),
    ...over,
  });
}
const view = (decisions: ReturnType<typeof decide>) =>
  decisions.map((item) => `${item.lessonId}:${item.reason ?? 'ok'}`);

describe('computeLessonAccess: drip D+N', () => {
  const modules = [
    mod('m1', 0, lesson('a1')),
    mod('m2', 7, lesson('b1')),
    mod('m3', 14, lesson('c1')),
  ];

  it('D+0 abre no dia da âncora; os demais esperam, com a data de liberação', () => {
    const result = decide({ modules });
    expect(view(result)).toEqual(['a1:ok', 'b1:drip_locked', 'c1:drip_locked']);
    expect(iso(result[1]!.releasesAt)).toBe('2026-10-18T03:00:00.000Z');
    expect(iso(result[2]!.releasesAt)).toBe('2026-10-25T03:00:00.000Z');
    expect(result[0]!.releasesAt).toBeNull();
  });

  it('fronteira de meia-noite: 1 ms antes bloqueia, no instante abre', () => {
    const before = decide({ modules, now: d('2026-10-18T02:59:59.999Z') });
    const at = decide({ modules, now: d('2026-10-18T03:00:00.000Z') });
    expect(view(before)[1]).toBe('b1:drip_locked');
    expect(view(at)[1]).toBe('b1:ok');
    expect(view(at)[2]).toBe('c1:drip_locked');
  });

  it('módulo sem dias (D+0) em qualquer posição abre junto', () => {
    const result = decide({ modules: [mod('m1', 0, lesson('a1')), mod('m2', 0, lesson('b1'))] });
    expect(view(result)).toEqual(['a1:ok', 'b1:ok']);
  });

  it('o drip parte da âncora, não do `agora`: depois do prazo todos os módulos abrem', () => {
    expect(view(decide({ modules, now: d('2027-01-01T00:00:00Z') }))).toEqual([
      'a1:ok',
      'b1:ok',
      'c1:ok',
    ]);
  });
});

describe('computeLessonAccess: acesso ao curso', () => {
  const modules = [mod('m1', 0, lesson('a1'), lesson('a2'))];

  it.each([
    ['no_access', 'no_access'],
    ['expired', 'expired'],
    ['suspended', 'suspended'],
  ] as const)(
    'sem acesso (%s): tudo bloqueado, mesmo com o módulo liberado',
    (reason, expected) => {
      const result = decide({
        modules,
        access: { hasAccess: false, reason, anchorAt: d('2020-01-01T00:00:00Z') },
      });
      expect(view(result)).toEqual([`a1:${expected}`, `a2:${expected}`]);
      expect(result.every((item) => !item.allowed && item.releasesAt === null)).toBe(true);
    },
  );

  it('sem âncora (sem matrícula) não calcula data e bloqueia', () => {
    const result = decide({
      modules,
      access: { hasAccess: false, reason: 'no_access', anchorAt: null },
    });
    expect(view(result)).toEqual(['a1:no_access', 'a2:no_access']);
  });
});

describe('computeLessonAccess: sequência guiada x livre', () => {
  const modules = [mod('m1', 0, lesson('a1'), lesson('a2', true), lesson('a3'), lesson('a4'))];

  it('livre: qualquer aula liberada abre, sem concluir nada', () => {
    expect(view(decide({ modules, sequenceMode: 'free' }))).toEqual([
      'a1:ok',
      'a2:ok',
      'a3:ok',
      'a4:ok',
    ]);
  });

  it('guiada sem nada concluído: só a primeira obrigatória abre', () => {
    expect(view(decide({ modules, sequenceMode: 'guided' }))).toEqual([
      'a1:ok',
      'a2:sequence_locked',
      'a3:sequence_locked',
      'a4:sequence_locked',
    ]);
  });

  it('guiada: concluir a obrigatória libera até a próxima obrigatória', () => {
    const result = decide({ modules, sequenceMode: 'guided', completed: new Set(['a1']) });
    expect(view(result)).toEqual(['a1:ok', 'a2:ok', 'a3:ok', 'a4:sequence_locked']);
  });

  it('a aula OPCIONAL não bloqueia a próxima, nem concluída nem não', () => {
    const result = decide({ modules, sequenceMode: 'guided', completed: new Set(['a1', 'a3']) });
    expect(view(result)).toEqual(['a1:ok', 'a2:ok', 'a3:ok', 'a4:ok']);
    // a2 (opcional) segue sem concluir e mesmo assim a3 e a4 abriram
  });

  it('guiada atravessa módulos: a obrigatória do módulo anterior bloqueia o seguinte', () => {
    const two = [mod('m1', 0, lesson('a1')), mod('m2', 0, lesson('b1'))];
    expect(view(decide({ modules: two, sequenceMode: 'guided' }))).toEqual([
      'a1:ok',
      'b1:sequence_locked',
    ]);
    expect(
      view(decide({ modules: two, sequenceMode: 'guided', completed: new Set(['a1']) })),
    ).toEqual(['a1:ok', 'b1:ok']);
  });

  it('drip vence a sequência no motivo: módulo futuro mostra drip_locked com a data', () => {
    const two = [mod('m1', 0, lesson('a1')), mod('m2', 7, lesson('b1'))];
    const result = decide({ modules: two, sequenceMode: 'guided' });
    expect(view(result)).toEqual(['a1:ok', 'b1:drip_locked']);
    expect(result[1]!.releasesAt).not.toBeNull();
  });

  it('módulo liberado pelo drip mas com obrigatória pendente antes: sequence_locked', () => {
    const two = [mod('m1', 0, lesson('a1')), mod('m2', 7, lesson('b1'))];
    const result = decide({ modules: two, sequenceMode: 'guided', now: d('2026-11-01T00:00:00Z') });
    expect(view(result)).toEqual(['a1:ok', 'b1:sequence_locked']);
  });
});

describe('computeLessonAccess: aula retirada', () => {
  it('fica retired, não conta como pendente e não bloqueia as seguintes', () => {
    const modules = [mod('m1', 0, lesson('a1', false, true), lesson('a2'), lesson('a3'))];
    const result = decide({ modules, sequenceMode: 'guided' });
    expect(view(result)).toEqual(['a1:retired', 'a2:ok', 'a3:sequence_locked']);
    expect(result[0]!.allowed).toBe(false);
  });

  it('retirada continua retired mesmo sem acesso ao curso', () => {
    const modules = [mod('m1', 0, lesson('a1', false, true))];
    const result = decide({
      modules,
      access: { hasAccess: false, reason: 'expired', anchorAt: null },
    });
    expect(view(result)).toEqual(['a1:retired']);
  });
});

describe('computeLessonAccess: formato', () => {
  it('uma decisão por aula, na ordem do curso, com o módulo de cada uma', () => {
    const modules = [mod('m1', 0, lesson('a1')), mod('m2', 0, lesson('b1'), lesson('b2'))];
    const result = decide({ modules });
    expect(result.map((item) => [item.moduleId, item.lessonId])).toEqual([
      ['m1', 'a1'],
      ['m2', 'b1'],
      ['m2', 'b2'],
    ]);
  });

  it('currículo vazio não decide nada', () => {
    expect(decide({ modules: [] })).toEqual([]);
  });
});
