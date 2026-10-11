import {
  canonicalJson,
  type CurriculumDetails,
  type CurriculumTree,
  type SaveDraftBody,
} from './curriculum';
import type { RichText } from '../content/rich-text';

/**
 * Edição do rascunho no navegador (M2-03). O editor mantém uma árvore EDITÁVEL: item que já existe no
 * servidor leva o `id` (que nunca muda: salvar com ele preserva a identidade ao editar, reordenar e
 * mover aula de módulo); item novo não tem `id` e ganha uma `key` só para a interface. Funções puras e
 * imutáveis: cada uma devolve uma árvore nova (ou a MESMA se não houver o que fazer, para a tela saber
 * que nada mudou, por exemplo ao tentar subir o primeiro item).
 */
export interface EditableLesson {
  key: string;
  id?: string;
  title: string;
  isOptional: boolean;
  body: RichText | null;
}

export interface EditableModule {
  key: string;
  id?: string;
  title: string;
  dripDays: number;
  lessons: EditableLesson[];
}

export interface EditableDraft {
  details: CurriculumDetails;
  modules: EditableModule[];
}

export type Direction = 'up' | 'down';

/** Do que o servidor devolveu para a árvore editável (a `key` dos existentes é o próprio id). */
export function toEditable(tree: CurriculumTree): EditableDraft {
  return {
    details: tree.details,
    modules: tree.modules.map((module) => ({
      key: module.id,
      id: module.id,
      title: module.title,
      dripDays: module.dripDays,
      lessons: module.lessons.map((lesson) => ({
        key: lesson.id,
        id: lesson.id,
        title: lesson.title,
        isOptional: lesson.isOptional,
        body: lesson.body,
      })),
    })),
  };
}

/** O corpo do `PUT` do rascunho: sem `key`, com `id` só onde ele existe, na ordem da tela. */
export function toPayload(draft: EditableDraft, expectedRev: number): SaveDraftBody {
  return {
    expectedRev,
    details: draft.details,
    modules: draft.modules.map((module) => ({
      ...(module.id ? { id: module.id } : {}),
      title: module.title,
      dripDays: module.dripDays,
      lessons: module.lessons.map((lesson) => ({
        ...(lesson.id ? { id: lesson.id } : {}),
        title: lesson.title,
        isOptional: lesson.isOptional,
        body: lesson.body,
      })),
    })),
  };
}

/** Há alterações em relação ao último estado salvo? (compara o que seria enviado) */
export function isDirty(current: EditableDraft, saved: EditableDraft): boolean {
  return canonicalJson(toPayload(current, 0)) !== canonicalJson(toPayload(saved, 0));
}

function swap<T>(items: T[], from: number, to: number): T[] | null {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return null;
  const next = [...items];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

const target = (index: number, direction: Direction) =>
  direction === 'up' ? index - 1 : index + 1;

export function addModule(draft: EditableDraft, key: string): EditableDraft {
  return {
    ...draft,
    modules: [...draft.modules, { key, title: '', dripDays: 0, lessons: [] }],
  };
}

export function removeModule(draft: EditableDraft, moduleIndex: number): EditableDraft {
  if (!draft.modules[moduleIndex]) return draft;
  return { ...draft, modules: draft.modules.filter((_, index) => index !== moduleIndex) };
}

export function moveModule(
  draft: EditableDraft,
  moduleIndex: number,
  direction: Direction,
): EditableDraft {
  const modules = swap(draft.modules, moduleIndex, target(moduleIndex, direction));
  return modules ? { ...draft, modules } : draft;
}

export function updateModule(
  draft: EditableDraft,
  moduleIndex: number,
  patch: Partial<Pick<EditableModule, 'title' | 'dripDays'>>,
): EditableDraft {
  if (!draft.modules[moduleIndex]) return draft;
  return {
    ...draft,
    modules: draft.modules.map((module, index) =>
      index === moduleIndex ? { ...module, ...patch } : module,
    ),
  };
}

export function addLesson(draft: EditableDraft, moduleIndex: number, key: string): EditableDraft {
  const module = draft.modules[moduleIndex];
  if (!module) return draft;
  const lesson: EditableLesson = { key, title: '', isOptional: false, body: null };
  return {
    ...draft,
    modules: draft.modules.map((item, index) =>
      index === moduleIndex ? { ...item, lessons: [...item.lessons, lesson] } : item,
    ),
  };
}

export function removeLesson(
  draft: EditableDraft,
  moduleIndex: number,
  lessonIndex: number,
): EditableDraft {
  const module = draft.modules[moduleIndex];
  if (!module?.lessons[lessonIndex]) return draft;
  return {
    ...draft,
    modules: draft.modules.map((item, index) =>
      index === moduleIndex
        ? { ...item, lessons: item.lessons.filter((_, position) => position !== lessonIndex) }
        : item,
    ),
  };
}

/** Sobe ou desce a aula DENTRO do módulo (a mesma aula, o mesmo id). */
export function moveLesson(
  draft: EditableDraft,
  moduleIndex: number,
  lessonIndex: number,
  direction: Direction,
): EditableDraft {
  const module = draft.modules[moduleIndex];
  if (!module) return draft;
  const lessons = swap(module.lessons, lessonIndex, target(lessonIndex, direction));
  if (!lessons) return draft;
  return {
    ...draft,
    modules: draft.modules.map((item, index) =>
      index === moduleIndex ? { ...item, lessons } : item,
    ),
  };
}

/** Move a aula para o FIM de outro módulo, mantendo a mesma aula (e o mesmo id). */
export function moveLessonToModule(
  draft: EditableDraft,
  fromModule: number,
  lessonIndex: number,
  toModule: number,
): EditableDraft {
  const lesson = draft.modules[fromModule]?.lessons[lessonIndex];
  if (!lesson || !draft.modules[toModule] || fromModule === toModule) return draft;
  return {
    ...draft,
    modules: draft.modules.map((item, index) => {
      if (index === fromModule) {
        return { ...item, lessons: item.lessons.filter((_, position) => position !== lessonIndex) };
      }
      if (index === toModule) return { ...item, lessons: [...item.lessons, lesson] };
      return item;
    }),
  };
}

export function updateLesson(
  draft: EditableDraft,
  moduleIndex: number,
  lessonIndex: number,
  patch: Partial<Pick<EditableLesson, 'title' | 'isOptional' | 'body'>>,
): EditableDraft {
  const module = draft.modules[moduleIndex];
  if (!module?.lessons[lessonIndex]) return draft;
  return {
    ...draft,
    modules: draft.modules.map((item, index) =>
      index === moduleIndex
        ? {
            ...item,
            lessons: item.lessons.map((lesson, position) =>
              position === lessonIndex ? { ...lesson, ...patch } : lesson,
            ),
          }
        : item,
    ),
  };
}

export function updateDetails(
  draft: EditableDraft,
  patch: Partial<CurriculumDetails>,
): EditableDraft {
  return { ...draft, details: { ...draft.details, ...patch } };
}
