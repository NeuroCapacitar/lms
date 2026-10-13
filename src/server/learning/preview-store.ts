import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, courseContent } from '../../db/schema';
import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import { computeProgress } from '../../features/access/progress';
import type { SequenceMode } from '../../features/catalog/catalog';
import { getPublishedCurriculum } from '../catalog/curriculum-store';
import { loadVideoView } from './video-progress';

/**
 * Prévia de aluno da Staff (M3-07): o curso PUBLICADO no mesmo formato do aluno, com `preview: true`.
 * É SÓ LEITURA: não lê nem grava matrícula, direito, conclusão nem progresso, e ignora direito, drip
 * e sequência (tudo aparece liberado) para a equipe revisar o conteúdo. Quem chama já conferiu o
 * papel de Staff. Nada aqui recebe o id da pessoa: não há como atribuir nada a alguém.
 */
async function loadPublished(db: Database, courseId: string) {
  const [row] = await db
    .select({ sequenceMode: course.sequenceMode })
    .from(course)
    .where(eq(course.id, courseId));
  const curriculum = await getPublishedCurriculum(db, courseId);
  if (!row || !curriculum) return null;
  const [content] = await db
    .select({ title: courseContent.displayTitle })
    .from(courseContent)
    .where(eq(courseContent.courseId, courseId));
  return {
    sequenceMode: row.sequenceMode as SequenceMode,
    title: content?.title ?? curriculum.details.displayTitle,
    curriculum,
  };
}

/** O mapa do curso como o aluno o vê, tudo liberado, sem conclusão e sem data de expiração. */
export async function getPreviewOutline(
  db: Database,
  courseId: string,
  now: Date,
): Promise<CourseOutlineDto | null> {
  const loaded = await loadPublished(db, courseId);
  if (!loaded) return null;
  return {
    preview: true,
    course: { id: courseId, title: loaded.title, sequenceMode: loaded.sequenceMode },
    access: { hasAccess: true, reason: 'ok', expiresAt: null },
    progress: computeProgress(loaded.curriculum.modules, new Set()),
    completedAt: null,
    modules: loaded.curriculum.modules.map((module) => ({
      id: module.id,
      title: module.title,
      releasesAt: now.toISOString(),
      lessons: module.lessons.map((item) => ({
        id: item.id,
        title: item.title,
        isOptional: item.isOptional,
        completed: false,
        locked: null,
        releasesAt: null,
      })),
    })),
  };
}

/** Uma aula como o aluno a vê (corpo, vizinhas), sempre liberada. `null`: não existe neste curso. */
export async function getPreviewLesson(
  db: Database,
  courseId: string,
  lessonId: string,
): Promise<LessonViewDto | null> {
  const loaded = await loadPublished(db, courseId);
  if (!loaded) return null;
  const flat = loaded.curriculum.modules.flatMap((module) => module.lessons);
  const index = flat.findIndex((item) => item.id === lessonId);
  if (index === -1) return null;
  const current = flat[index]!;
  const neighbor = (item: (typeof flat)[number] | undefined) =>
    item ? { id: item.id, title: item.title } : null;
  return {
    preview: true,
    course: { id: courseId, title: loaded.title },
    lesson: {
      id: current.id,
      title: current.title,
      isOptional: current.isOptional,
      body: current.body,
      kind: current.kind ?? 'text',
      // Prévia: o mesmo vídeo, mas SEM progresso (nada é lido nem gravado da pessoa).
      ...(current.kind === 'video' && current.videoAssetId
        ? { video: await loadVideoView(db, { assetId: current.videoAssetId, courseId }) }
        : {}),
    },
    completed: false,
    previous: neighbor(flat[index - 1]),
    next: neighbor(flat[index + 1]),
  };
}
