import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  course,
  courseCompletion,
  curriculumState,
  enrollment,
  lesson,
  lessonCompletion,
} from '../../db/schema';
import type { LessonLockReason } from '../../features/access/lesson-access';
import { computeLessonAccess } from '../../features/access/lesson-access';
import { computeProgress, isCourseDone, type CourseProgress } from '../../features/access/progress';
import type { SequenceMode } from '../../features/catalog/catalog';
import { resolveAccessIn } from '../access/entitlement-store';
import { auditEvent } from '../auth/access-store';
import { readPublishedTree } from '../catalog/curriculum-store';

/** Aula inexistente, retirada, de curso sem currículo publicado ou fora do currículo publicado. */
export class LessonNotFoundError extends Error {
  constructor() {
    super('lesson_not_found');
  }
}

/** Sem acesso ao curso: não inscrita (inclusive Staff sem matrícula), expirada ou suspensa. */
export class CompletionAccessDeniedError extends Error {
  constructor(readonly reason: 'no_access' | 'expired' | 'suspended') {
    super(`access_denied:${reason}`);
  }
}

/** A aula existe, mas ainda não abre para esta pessoa (drip ou sequência). */
export class LessonLockedError extends Error {
  constructor(
    readonly reason: LessonLockReason,
    readonly releasesAt: Date | null,
  ) {
    super(`lesson_locked:${reason}`);
  }
}

export interface CompleteResult {
  /** `already_completed`: a aula já estava concluída; nada foi gravado. */
  status: 'completed' | 'already_completed';
  progress: CourseProgress;
  /** O curso está concluído (existe `course_completion`). */
  courseCompleted: boolean;
  /** `true` só na chamada que CRIOU a conclusão do curso (para a mensagem de parabéns). */
  courseJustCompleted: boolean;
  courseCompletedAt: Date | null;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** O que toda conclusão precisa saber, lido DENTRO da transação e depois de travar a matrícula. */
export interface LessonContext {
  courseId: string;
  now: Date;
  tree: Awaited<ReturnType<typeof readPublishedTree>>;
  completed: Set<string>;
}

/**
 * Carrega o contexto de uma aula para concluí-la (M3-04, reaproveitado pelo vídeo no M5-02), tudo na
 * transação do chamador: confere o tipo da aula, TRAVA a matrícula (`FOR UPDATE`; conclusões simultâneas
 * entram na fila), confere o acesso e se a aula ABRE (a mesma `computeLessonAccess` do mapa: acesso, drip e
 * sequência). Lança `LessonNotFoundError`, `CompletionAccessDeniedError` ou `LessonLockedError`.
 */
export async function loadLessonContext(
  tx: Tx,
  input: { userId: string; lessonId: string; kind?: 'text' | 'video' | 'quiz'; clock?: () => Date },
): Promise<LessonContext> {
  const clock = input.clock ?? (() => new Date());
  const [row] = await tx
    .select({ courseId: lesson.courseId, retiredAt: lesson.retiredAt, kind: lesson.kind })
    .from(lesson)
    .where(eq(lesson.id, input.lessonId));
  if (!row || row.retiredAt !== null || (input.kind !== undefined && row.kind !== input.kind))
    throw new LessonNotFoundError();
  const { courseId } = row;

  // A fila: a matrícula trava ANTES de ler as conclusões e o relógio (quem espera vê o que o outro gravou).
  const [locked] = await tx
    .select({ userId: enrollment.userId })
    .from(enrollment)
    .where(and(eq(enrollment.userId, input.userId), eq(enrollment.courseId, courseId)))
    .for('update');
  const now = clock();
  const access = await resolveAccessIn(tx, input.userId, courseId, now);
  if (!locked || !access.hasAccess) {
    throw new CompletionAccessDeniedError(
      access.reason === 'expired' || access.reason === 'suspended' ? access.reason : 'no_access',
    );
  }

  const [state] = await tx
    .select({ version: curriculumState.publishedVersion })
    .from(curriculumState)
    .where(eq(curriculumState.courseId, courseId));
  const [courseRow] = await tx
    .select({ sequenceMode: course.sequenceMode })
    .from(course)
    .where(eq(course.id, courseId));
  if (!courseRow || (state?.version ?? 0) === 0) throw new LessonNotFoundError();
  const tree = await readPublishedTree(tx, courseId);

  const done = await tx
    .select({ lessonId: lessonCompletion.lessonId })
    .from(lessonCompletion)
    .where(and(eq(lessonCompletion.userId, input.userId), eq(lessonCompletion.courseId, courseId)));
  const completed = new Set(done.map((item) => item.lessonId));

  const decisions = computeLessonAccess({
    access,
    now,
    sequenceMode: courseRow.sequenceMode as SequenceMode,
    modules: tree.modules.map((module) => ({
      id: module.id,
      dripDays: module.dripDays,
      lessons: module.lessons.map((item) => ({ id: item.id, isOptional: item.isOptional })),
    })),
    completed,
  });
  const decision = decisions.find((item) => item.lessonId === input.lessonId);
  if (!decision) throw new LessonNotFoundError();
  if (!decision.allowed) throw new LessonLockedError(decision.reason!, decision.releasesAt);
  return { courseId, now, tree, completed };
}

/**
 * Grava a conclusão da aula (única por pessoa e aula; repetir é no-op) e, se com ela todas as obrigatórias
 * estão concluídas, cria a conclusão do curso UMA vez (única por pessoa e curso). O progresso conta só as
 * obrigatórias publicadas e não retiradas. `method`: `manual` (aula de texto), `video` (limiar do player) ou `quiz` (aprovação, M5-04).
 */
export async function recordCompletion(
  tx: Tx,
  context: LessonContext,
  input: { userId: string; lessonId: string; method: 'manual' | 'video' | 'quiz' },
): Promise<CompleteResult> {
  const { courseId, now, tree, completed } = context;
  const inserted = await tx
    .insert(lessonCompletion)
    .values({
      userId: input.userId,
      courseId,
      lessonId: input.lessonId,
      completedAt: now,
      method: input.method,
    })
    .onConflictDoNothing()
    .returning({ lessonId: lessonCompletion.lessonId });
  const created = inserted.length > 0;
  if (created) completed.add(input.lessonId);

  const progress = computeProgress(tree.modules, completed);
  let courseJustCompleted = false;
  if (isCourseDone(progress)) {
    const made = await tx
      .insert(courseCompletion)
      .values({
        userId: input.userId,
        courseId,
        completedAt: now,
        requiredTotal: progress.total,
      })
      .onConflictDoNothing()
      .returning({ userId: courseCompletion.userId });
    courseJustCompleted = made.length > 0;
    if (courseJustCompleted) {
      await auditEvent(tx, {
        actorId: input.userId,
        action: 'course.completed',
        targetType: 'course',
        targetId: courseId,
        details: { userId: input.userId, requiredTotal: progress.total },
      });
    }
  }
  const [existing] = await tx
    .select({ completedAt: courseCompletion.completedAt })
    .from(courseCompletion)
    .where(and(eq(courseCompletion.userId, input.userId), eq(courseCompletion.courseId, courseId)));
  return {
    status: created ? 'completed' : 'already_completed',
    progress,
    courseCompleted: existing !== undefined,
    courseJustCompleted,
    courseCompletedAt: existing?.completedAt ?? null,
  };
}

/** Conclui uma aula de TEXTO (M3-04): a conclusão manual, numa transação. */
export async function completeLesson(
  db: Database,
  input: { userId: string; lessonId: string; clock?: () => Date },
): Promise<CompleteResult> {
  return db.transaction(async (tx) => {
    const context = await loadLessonContext(tx, { ...input, kind: 'text' });
    return recordCompletion(tx, context, {
      userId: input.userId,
      lessonId: input.lessonId,
      method: 'manual',
    });
  });
}
