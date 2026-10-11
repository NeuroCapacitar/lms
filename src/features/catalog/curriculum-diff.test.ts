import { describe, expect, it } from 'vitest';

import { richTextFromParagraph } from '../content/rich-text';
import type { CurriculumTree, LessonNode, ModuleNode } from './curriculum';
import { diffCurriculum } from './curriculum-diff';

const lesson = (id: string, title: string, extra: Partial<LessonNode> = {}): LessonNode => ({
  id,
  title,
  isOptional: false,
  body: null,
  ...extra,
});
const module = (id: string, title: string, lessons: LessonNode[], dripDays = 0): ModuleNode => ({
  id,
  title,
  dripDays,
  lessons,
});
const tree = (modules: ModuleNode[], title = 'Curso'): CurriculumTree => ({
  details: { displayTitle: title, description: null, workloadHours: null },
  modules,
});

const base = () =>
  tree([
    module('m1', 'Módulo 1', [lesson('a', 'Aula A'), lesson('b', 'Aula B')]),
    module('m2', 'Módulo 2', [lesson('c', 'Aula C')], 7),
  ]);

describe('diffCurriculum', () => {
  it('nunca publicado: tudo é novo e os detalhes contam como mudados', () => {
    const diff = diffCurriculum(base(), null);
    expect(diff.added.map((item) => item.id)).toEqual(['m1', 'a', 'b', 'm2', 'c']);
    expect(diff).toMatchObject({ changed: [], retired: [], details: true });
  });

  it('idêntico ao publicado: nada muda', () => {
    expect(diffCurriculum(base(), base())).toEqual({
      details: false,
      added: [],
      changed: [],
      retired: [],
    });
  });

  it('renomear, mudar D+N, opcional ou corpo é "alterado" (mesmo id), nunca retirado e adicionado', () => {
    const draft = tree([
      module('m1', 'Módulo 1 renomeado', [
        lesson('a', 'Aula A', { isOptional: true }),
        lesson('b', 'Aula B', { body: richTextFromParagraph('novo') }),
      ]),
      module('m2', 'Módulo 2', [lesson('c', 'Aula C')], 14),
    ]);
    const diff = diffCurriculum(draft, base());
    expect(diff.changed.map((item) => item.id).sort()).toEqual(['a', 'b', 'm1', 'm2']);
    expect(diff.added).toEqual([]);
    expect(diff.retired).toEqual([]);
  });

  it('mover aula de módulo e reordenar contam como alterado; o que some é aposentado; o que entra é novo', () => {
    const draft = tree([
      module('m2', 'Módulo 2', [lesson('c', 'Aula C'), lesson('a', 'Aula A')], 7),
      module('m3', 'Módulo novo', [lesson('n', 'Aula nova')]),
    ]);
    const diff = diffCurriculum(draft, base());
    expect(diff.added.map((item) => item.id)).toEqual(['m3', 'n']);
    expect(diff.retired.map((item) => `${item.kind}:${item.id}`).sort()).toEqual([
      'lesson:b',
      'module:m1',
    ]);
    // m2 mudou de posição (0), c mudou de posição? continua em 0; a mudou de módulo e posição
    expect(diff.changed.map((item) => item.id).sort()).toEqual(['a', 'm2']);
  });

  it('mudança só nos detalhes públicos aparece como details', () => {
    const diff = diffCurriculum(tree(base().modules, 'Outro título'), base());
    expect(diff).toEqual({ details: true, added: [], changed: [], retired: [] });
  });
});
