import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, courseCompletion, courseContent, lesson, lessonCompletion } from '../../db/schema';
import { toAccessDto, type AccessResult } from '../../features/access/access';
import {
  computeLessonAccess,
  moduleReleaseAt,
  type LessonDecision,
} from '../../features/access/lesson-access';
import type {
  CourseOutlineDto,
  LessonViewDto,
  OutlineLessonDto,
} from '../../features/access/outline';
import type { SequenceMode } from '../../features/catalog/catalog';
import type { PublishedCurriculumDto } from '../../features/catalog/curriculum';
import { computeProgress, type CourseProgress } from '../../features/access/progress';
import { resolveAccess } from '../access/entitlement-store';
import { getPublishedCurriculum } from '../catalog/curriculum-store';
import { quizPart } from './quiz-attempts';
import { loadVideoView } from './video-progress';

/**
 * O curso como UMA pessoa o vê agora (M3-03): acesso, currículo publicado, conclusões e a decisão de
 * cada aula. Reúne os dados e entrega à função pura `computeLessonAccess`; não decide nada sozinho.
 */
interface StudentCourse {
  access: AccessResult;
  sequenceMode: SequenceMode;
  title: string;
  curriculum: PublishedCurriculumDto;
  completed: Set<string>;
  decisions: LessonDecision[];
  progress: CourseProgress;
  completedAt: Date | null;
}

async function loadStudentCourse(
  db: Database,
  userId: string,
  courseId: string,
  now: Date,
): Promise<
  | { kind: 'denied'; access: AccessResult }
  | { kind: 'not_found' }
  | { kind: 'ok'; data: StudentCourse }
> {
  const access = await resolveAccess(db, userId, courseId, now);
  if (!access.hasAccess) return { kind: 'denied', access };
  const [row] = await db
    .select({ sequenceMode: course.sequenceMode })
    .from(course)
    .where(eq(course.id, courseId));
  const curriculum = await getPublishedCurriculum(db, courseId);
  if (!row || !curriculum) return { kind: 'not_found' };
  const [content] = await db
    .select({ title: courseContent.displayTitle })
    .from(courseContent)
    .where(eq(courseContent.courseId, courseId));
  const done = await db
    .select({ lessonId: lessonCompletion.lessonId })
    .from(lessonCompletion)
    .where(and(eq(lessonCompletion.userId, userId), eq(lessonCompletion.courseId, courseId)));
  const completed = new Set(done.map((item) => item.lessonId));
  const [finished] = await db
    .select({ completedAt: courseCompletion.completedAt })
    .from(courseCompletion)
    .where(and(eq(courseCompletion.userId, userId), eq(courseCompletion.courseId, courseId)));
  const sequenceMode = row.sequenceMode as SequenceMode;
  const decisions = computeLessonAccess({
    access,
    now,
    sequenceMode,
    modules: curriculum.modules.map((module) => ({
      id: module.id,
      dripDays: module.dripDays,
      lessons: module.lessons.map((item) => ({ id: item.id, isOptional: item.isOptional })),
    })),
    completed,
  });
  return {
    kind: 'ok',
    data: {
      access,
      sequenceMode,
      title: content?.title ?? curriculum.details.displayTitle,
      curriculum,
      completed,
      decisions,
      progress: computeProgress(curriculum.modules, completed),
      completedAt: finished?.completedAt ?? null,
    },
  };
}

export type OutlineResult =
  | { kind: 'ok'; outline: CourseOutlineDto }
  | { kind: 'denied'; reason: 'no_access' | 'expired' | 'suspended' }
  | { kind: 'not_found' };

function deniedReason(access: AccessResult): 'no_access' | 'expired' | 'suspended' {
  return access.reason === 'expired' || access.reason === 'suspended' ? access.reason : 'no_access';
}

/** O mapa do curso: módulos e aulas com TÍTULO, estado e data de liberação; nunca o conteúdo. */
export async function getCourseOutline(
  db: Database,
  userId: string,
  courseId: string,
  now: Date,
): Promise<OutlineResult> {
  const loaded = await loadStudentCourse(db, userId, courseId, now);
  if (loaded.kind === 'denied') return { kind: 'denied', reason: deniedReason(loaded.access) };
  if (loaded.kind === 'not_found') return { kind: 'not_found' };
  const { data } = loaded;
  const byLesson = new Map(data.decisions.map((decision) => [decision.lessonId, decision]));
  return {
    kind: 'ok',
    outline: {
      course: { id: courseId, title: data.title, sequenceMode: data.sequenceMode },
      access: toAccessDto(data.access),
      progress: data.progress,
      completedAt: data.completedAt ? data.completedAt.toISOString() : null,
      modules: data.curriculum.modules.map((module) => ({
        id: module.id,
        title: module.title,
        releasesAt: moduleReleaseAt(data.access.anchorAt!, module.dripDays).toISOString(),
        lessons: module.lessons.map<OutlineLessonDto>((item) => {
          const decision = byLesson.get(item.id)!;
          return {
            id: item.id,
            title: item.title,
            isOptional: item.isOptional,
            completed: data.completed.has(item.id),
            locked: decision.reason,
            releasesAt: decision.releasesAt ? decision.releasesAt.toISOString() : null,
          };
        }),
      })),
    },
  };
}

export type LessonResult =
  | { kind: 'ok'; view: LessonViewDto }
  | { kind: 'denied'; reason: 'no_access' | 'expired' | 'suspended' }
  | { kind: 'locked'; reason: NonNullable<LessonDecision['reason']>; releasesAt: string | null }
  | { kind: 'not_found' };

/**
 * Uma aula. O CONTEÚDO só sai se `computeLessonAccess` liberou: aula bloqueada devolve só o motivo
 * (e a data do drip), sem título nem corpo. Aula inexistente ou retirada é `not_found`.
 */
export async function getLesson(
  db: Database,
  userId: string,
  lessonId: string,
  now: Date,
): Promise<LessonResult> {
  const [row] = await db
    .select({ courseId: lesson.courseId, retiredAt: lesson.retiredAt })
    .from(lesson)
    .where(eq(lesson.id, lessonId));
  if (!row || row.retiredAt !== null) return { kind: 'not_found' };
  const loaded = await loadStudentCourse(db, userId, row.courseId, now);
  if (loaded.kind === 'denied') return { kind: 'denied', reason: deniedReason(loaded.access) };
  if (loaded.kind === 'not_found') return { kind: 'not_found' };
  const { data } = loaded;
  const decision = data.decisions.find((item) => item.lessonId === lessonId);
  if (!decision) return { kind: 'not_found' };
  if (!decision.allowed) {
    return {
      kind: 'locked',
      reason: decision.reason!,
      releasesAt: decision.releasesAt ? decision.releasesAt.toISOString() : null,
    };
  }
  const flat = data.curriculum.modules.flatMap((module) => module.lessons);
  const index = flat.findIndex((item) => item.id === lessonId);
  const current = flat[index]!;
  const neighbor = (item: (typeof flat)[number] | undefined) =>
    item ? { id: item.id, title: item.title } : null;
  return {
    kind: 'ok',
    view: {
      course: { id: row.courseId, title: data.title },
      lesson: {
        id: current.id,
        title: current.title,
        isOptional: current.isOptional,
        body: current.body,
        kind: current.kind ?? 'text',
        ...(current.kind === 'quiz'
          ? await quizPart(db, { rawQuiz: current.quiz, lessonId, userId })
          : {}),
        ...(current.kind === 'video' && current.videoAssetId
          ? {
              video: await loadVideoView(db, {
                assetId: current.videoAssetId,
                courseId: row.courseId,
                lessonId,
                userId,
              }),
            }
          : {}),
      },
      completed: data.completed.has(lessonId),
      previous: neighbor(flat[index - 1]),
      next: neighbor(flat[index + 1]),
    },
  };
}
