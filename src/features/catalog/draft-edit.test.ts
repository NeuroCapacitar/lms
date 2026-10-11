import { describe, expect, it } from 'vitest';

import {
  addLesson,
  addModule,
  isDirty,
  moveLesson,
  moveLessonToModule,
  moveModule,
  removeLesson,
  removeModule,
  toEditable,
  toPayload,
  updateLesson,
  updateModule,
  type EditableDraft,
} from './draft-edit';

const server = (): EditableDraft =>
  toEditable({
    details: { displayTitle: 'Curso', description: null, workloadHours: null },
    modules: [
      {
        id: 'm1',
        title: 'Um',
        dripDays: 0,
        lessons: [
          { id: 'a', title: 'A', isOptional: false, body: null },
          { id: 'b', title: 'B', isOptional: true, body: null },
        ],
      },
      {
        id: 'm2',
        title: 'Dois',
        dripDays: 7,
        lessons: [{ id: 'c', title: 'C', isOptional: false, body: null }],
      },
    ],
  });

const titles = (draft: EditableDraft) =>
  draft.modules.map((m) => `${m.title}[${m.lessons.map((l) => l.title).join(',')}]`);

describe('conversão', () => {
  it('o existente leva id (e a key é o id); o payload omite a key e só leva id onde ele existe', () => {
    const draft = addLesson(addModule(server(), 'k-novo'), 2, 'k-aula');
    expect(draft.modules[0]!.key).toBe('m1');
    const payload = toPayload(draft, 3);
    expect(payload.expectedRev).toBe(3);
    expect(payload.modules[0]).toMatchObject({ id: 'm1', lessons: [{ id: 'a' }, { id: 'b' }] });
    expect(payload.modules[2]).not.toHaveProperty('id');
    expect(payload.modules[2]!.lessons[0]).not.toHaveProperty('id');
    expect(JSON.stringify(payload)).not.toContain('"key"');
  });

  it('isDirty compara o que seria enviado (ignora as keys)', () => {
    const saved = server();
    expect(isDirty(saved, server())).toBe(false);
    expect(isDirty(updateModule(saved, 0, { title: 'Novo' }), saved)).toBe(true);
    expect(isDirty(addModule(saved, 'x'), saved)).toBe(true);
    expect(isDirty(updateModule(saved, 0, { title: saved.modules[0]!.title }), saved)).toBe(false);
  });
});

describe('módulos', () => {
  it('subir e descer trocam de lugar e mantêm os ids; no limite não há o que fazer (mesma árvore)', () => {
    const draft = server();
    const moved = moveModule(draft, 1, 'up');
    expect(titles(moved)).toEqual(['Dois[C]', 'Um[A,B]']);
    expect(moved.modules.map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(moveModule(draft, 0, 'up')).toBe(draft);
    expect(moveModule(draft, 1, 'down')).toBe(draft);
    expect(moveModule(draft, 9, 'up')).toBe(draft);
  });

  it('adicionar vai ao fim e remover leva as aulas junto; índice inexistente é no-op', () => {
    const draft = server();
    expect(titles(addModule(draft, 'n'))).toEqual(['Um[A,B]', 'Dois[C]', '[]']);
    expect(titles(removeModule(draft, 0))).toEqual(['Dois[C]']);
    expect(removeModule(draft, 5)).toBe(draft);
    expect(updateModule(draft, 5, { title: 'x' })).toBe(draft);
  });

  it('editar título e D+N não troca o id', () => {
    const edited = updateModule(server(), 0, { title: 'Renomeado', dripDays: 14 });
    expect(edited.modules[0]).toMatchObject({ id: 'm1', title: 'Renomeado', dripDays: 14 });
  });
});

describe('aulas', () => {
  it('subir e descer dentro do módulo mantêm o id; limites são no-op', () => {
    const draft = server();
    const moved = moveLesson(draft, 0, 1, 'up');
    expect(titles(moved)).toEqual(['Um[B,A]', 'Dois[C]']);
    expect(moved.modules[0]!.lessons.map((l) => l.id)).toEqual(['b', 'a']);
    expect(moveLesson(draft, 0, 0, 'up')).toBe(draft);
    expect(moveLesson(draft, 0, 1, 'down')).toBe(draft);
    expect(moveLesson(draft, 7, 0, 'up')).toBe(draft);
  });

  it('mover para outro módulo leva a MESMA aula (mesmo id) ao fim do destino', () => {
    const draft = server();
    const moved = moveLessonToModule(draft, 0, 0, 1);
    expect(titles(moved)).toEqual(['Um[B]', 'Dois[C,A]']);
    expect(moved.modules[1]!.lessons[1]).toMatchObject({ id: 'a', title: 'A' });
    expect(moveLessonToModule(draft, 0, 0, 0)).toBe(draft);
    expect(moveLessonToModule(draft, 0, 9, 1)).toBe(draft);
    expect(moveLessonToModule(draft, 0, 0, 9)).toBe(draft);
  });

  it('adicionar, editar e remover', () => {
    const draft = addLesson(server(), 1, 'nova');
    expect(titles(draft)).toEqual(['Um[A,B]', 'Dois[C,]']);
    expect(draft.modules[1]!.lessons[1]).toMatchObject({
      key: 'nova',
      title: '',
      isOptional: false,
      body: null,
    });
    expect(
      updateLesson(draft, 0, 0, { title: 'A2', isOptional: true }).modules[0]!.lessons[0],
    ).toMatchObject({
      id: 'a',
      title: 'A2',
      isOptional: true,
    });
    expect(titles(removeLesson(draft, 0, 1))).toEqual(['Um[A]', 'Dois[C,]']);
    expect(removeLesson(draft, 0, 9)).toBe(draft);
    expect(addLesson(draft, 9, 'x')).toBe(draft);
    expect(updateLesson(draft, 9, 0, { title: 'x' })).toBe(draft);
  });

  it('as operações não alteram a árvore original (imutabilidade)', () => {
    const draft = server();
    const snapshot = JSON.stringify(draft);
    moveModule(draft, 1, 'up');
    moveLessonToModule(draft, 0, 0, 1);
    removeLesson(draft, 0, 0);
    updateLesson(draft, 0, 0, { title: 'zzz' });
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});
