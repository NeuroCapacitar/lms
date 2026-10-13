import { canonicalJson, type CurriculumProblem, type CurriculumTree } from './curriculum';

/**
 * Resumo do que a publicação muda (M2-03): o que foi ADICIONADO, ALTERADO ou será APOSENTADO em
 * relação ao publicado vigente. Puro. A identidade é o id (estável): renomear ou mover é "alterado",
 * nunca "retirado e adicionado".
 */
export interface DiffItem {
  id: string;
  kind: 'module' | 'lesson';
  title: string;
}

export interface CurriculumDiff {
  /** Título, descrição ou carga horária públicos mudaram. */
  details: boolean;
  added: DiffItem[];
  changed: DiffItem[];
  retired: DiffItem[];
}

interface Flat {
  item: DiffItem;
  /** O que, se mudar, torna o item "alterado" (posição e módulo incluídos). */
  signature: string;
}

function flatten(tree: CurriculumTree): Flat[] {
  const flat: Flat[] = [];
  tree.modules.forEach((module, moduleIndex) => {
    flat.push({
      item: { id: module.id, kind: 'module', title: module.title },
      signature: canonicalJson({
        title: module.title,
        dripDays: module.dripDays,
        position: moduleIndex,
      }),
    });
    module.lessons.forEach((lesson, lessonIndex) => {
      flat.push({
        item: { id: lesson.id, kind: 'lesson', title: lesson.title },
        signature: canonicalJson({
          title: lesson.title,
          isOptional: lesson.isOptional,
          body: lesson.body,
          kind: lesson.kind ?? 'text',
          videoAssetId: lesson.videoAssetId ?? null,
          quiz: lesson.quiz ?? null,
          moduleId: module.id,
          position: lessonIndex,
        }),
      });
    });
  });
  return flat;
}

/** Compara o rascunho com o publicado ativo (`null` = nunca publicado: tudo é novo). */
export function diffCurriculum(
  draft: CurriculumTree,
  published: CurriculumTree | null,
): CurriculumDiff {
  const before = new Map(
    (published ? flatten(published) : []).map((entry) => [entry.item.id, entry]),
  );
  const after = flatten(draft);
  const added: DiffItem[] = [];
  const changed: DiffItem[] = [];
  for (const entry of after) {
    const previous = before.get(entry.item.id);
    if (!previous) added.push(entry.item);
    else if (previous.signature !== entry.signature) changed.push(entry.item);
  }
  const kept = new Set(after.map((entry) => entry.item.id));
  const retired = [...before.values()]
    .filter((entry) => !kept.has(entry.item.id))
    .map((entry) => entry.item);
  return {
    details:
      published === null || canonicalJson(draft.details) !== canonicalJson(published.details),
    added,
    changed,
    retired,
  };
}

/** Resposta de `GET /api/staff/courses/:id/publish-preview`. */
export interface PublishPreview {
  rev: number;
  publishedVersion: number;
  /** Há algo a publicar (nunca publicado, ou rascunho diferente do publicado)? */
  hasChanges: boolean;
  /** O que impediria a publicação agora (vazio = pode publicar). */
  problems: CurriculumProblem[];
  diff: CurriculumDiff;
}
