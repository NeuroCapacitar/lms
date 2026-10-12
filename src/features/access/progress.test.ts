import { describe, expect, it } from 'vitest';

import { computeProgress, isCourseDone } from './progress';

const lesson = (id: string, isOptional = false) => ({ id, isOptional });
const mods = (...groups: { id: string; isOptional: boolean }[][]) =>
  groups.map((lessons) => ({ lessons }));

describe('computeProgress', () => {
  it('conta só as obrigatórias: concluídas sobre publicadas', () => {
    const modules = mods([lesson('a'), lesson('b')], [lesson('c'), lesson('d')]);
    expect(computeProgress(modules, new Set())).toEqual({ completed: 0, total: 4, percent: 0 });
    expect(computeProgress(modules, new Set(['a']))).toEqual({
      completed: 1,
      total: 4,
      percent: 25,
    });
    expect(computeProgress(modules, new Set(['a', 'b', 'c']))).toEqual({
      completed: 3,
      total: 4,
      percent: 75,
    });
    expect(computeProgress(modules, new Set(['a', 'b', 'c', 'd']))).toEqual({
      completed: 4,
      total: 4,
      percent: 100,
    });
  });

  it('aula opcional fica FORA do cálculo, concluída ou não', () => {
    const modules = mods([lesson('a'), lesson('opt', true), lesson('b')]);
    expect(computeProgress(modules, new Set(['a']))).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
    expect(computeProgress(modules, new Set(['a', 'opt']))).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
    expect(computeProgress(modules, new Set(['opt']))).toEqual({
      completed: 0,
      total: 2,
      percent: 0,
    });
  });

  it('arredonda para baixo: 2 de 3 é 66%, nunca 67% nem 100% antes da hora', () => {
    const modules = mods([lesson('a'), lesson('b'), lesson('c')]);
    expect(computeProgress(modules, new Set(['a', 'b'])).percent).toBe(66);
    const many = mods(Array.from({ length: 1000 }, (_, index) => lesson(`l${index}`)));
    const almost = new Set(Array.from({ length: 999 }, (_, index) => `l${index}`));
    expect(computeProgress(many, almost).percent).toBe(99);
  });

  it('conclusões de aulas que saíram do currículo não contam (nem passam de 100%)', () => {
    const modules = mods([lesson('a'), lesson('b')]);
    expect(computeProgress(modules, new Set(['a', 'removida-1', 'removida-2']))).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
  });

  it('currículo sem obrigatórias: total 0 e percentual 0', () => {
    expect(computeProgress(mods([lesson('o', true)]), new Set())).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
    });
    expect(computeProgress([], new Set())).toEqual({ completed: 0, total: 0, percent: 0 });
  });

  it('o percentual pode CAIR quando uma obrigatória nova é publicada', () => {
    const before = computeProgress(mods([lesson('a'), lesson('b')]), new Set(['a', 'b']));
    const after = computeProgress(
      mods([lesson('a'), lesson('b'), lesson('nova')]),
      new Set(['a', 'b']),
    );
    expect(before.percent).toBe(100);
    expect(after.percent).toBe(66);
  });
});

describe('isCourseDone', () => {
  it('só com todas as obrigatórias concluídas e pelo menos uma', () => {
    expect(isCourseDone({ completed: 2, total: 2, percent: 100 })).toBe(true);
    expect(isCourseDone({ completed: 1, total: 2, percent: 50 })).toBe(false);
    expect(isCourseDone({ completed: 0, total: 0, percent: 0 })).toBe(false);
  });
});
