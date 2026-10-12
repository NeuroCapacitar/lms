/**
 * Progresso do curso (M3-04), puro. Conta SÓ as aulas obrigatórias publicadas e não retiradas;
 * aula opcional fica fora do cálculo (pode ser concluída, mas não muda o percentual). Quem chama
 * entrega o currículo publicado (o que sai do rascunho já foi aposentado) e as conclusões da pessoa.
 */
export interface CourseProgress {
  /** Obrigatórias concluídas. */
  completed: number;
  /** Obrigatórias publicadas (não retiradas). */
  total: number;
  /** 0 a 100, inteiro. 100 só quando TODAS as obrigatórias estão concluídas. */
  percent: number;
}

export function computeProgress(
  modules: readonly { lessons: readonly { id: string; isOptional: boolean }[] }[],
  completed: ReadonlySet<string>,
): CourseProgress {
  let total = 0;
  let done = 0;
  for (const module of modules) {
    for (const lesson of module.lessons) {
      if (lesson.isOptional) continue;
      total += 1;
      if (completed.has(lesson.id)) done += 1;
    }
  }
  // Arredonda para BAIXO: 99,6% nunca aparece como 100% antes da conclusão de verdade.
  const percent = total === 0 ? 0 : done === total ? 100 : Math.floor((done * 100) / total);
  return { completed: done, total, percent };
}

/** O curso está todo concluído? Sem obrigatórias não há o que concluir. */
export function isCourseDone(progress: CourseProgress): boolean {
  return progress.total > 0 && progress.completed === progress.total;
}
