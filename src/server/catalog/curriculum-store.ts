import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  course,
  courseContent,
  courseDraft,
  courseModule,
  curriculumState,
  lesson,
  lessonDraft,
  moduleDraft,
} from '../../db/schema';
import {
  curriculumEquals,
  validateCurriculum,
  type CurriculumProblem,
  type CurriculumTree,
  type DraftDto,
  type LessonNode,
  type ModuleNode,
  type PublishedCurriculumDto,
} from '../../features/catalog/curriculum';
import { auditEvent } from '../auth/access-store';

export class CurriculumCourseNotFoundError extends Error {
  constructor() {
    super('course_not_found');
  }
}
/** Outra pessoa salvou o rascunho depois que esta tela o leu (concorrência otimista). */
export class DraftConflictError extends Error {
  constructor(readonly currentRev: number) {
    super('draft_conflict');
  }
}
/** O corpo cita um id que não é deste rascunho, ou repete um id. */
export class UnknownDraftIdError extends Error {
  constructor() {
    super('unknown_id');
  }
}
/** O rascunho não passa nas validações de publicação; `problems` lista todas. */
export class CurriculumInvalidError extends Error {
  constructor(readonly problems: CurriculumProblem[]) {
    super('curriculum_invalid');
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function ensureState(tx: Tx, courseId: string) {
  await tx.insert(curriculumState).values({ courseId }).onConflictDoNothing();
}

/** Lê a árvore do RASCUNHO (módulos e aulas em ordem) e os detalhes; sem rascunho, parte do título. */
async function readDraftTree(tx: Tx | Database, courseId: string): Promise<CurriculumTree> {
  const [courseRow] = await tx
    .select({ title: course.title })
    .from(course)
    .where(eq(course.id, courseId));
  const [details] = await tx.select().from(courseDraft).where(eq(courseDraft.courseId, courseId));
  const modules = await tx
    .select()
    .from(moduleDraft)
    .where(eq(moduleDraft.courseId, courseId))
    .orderBy(asc(moduleDraft.position));
  const lessons = await tx
    .select()
    .from(lessonDraft)
    .where(eq(lessonDraft.courseId, courseId))
    .orderBy(asc(lessonDraft.position));
  return {
    details: details
      ? {
          displayTitle: details.displayTitle,
          description: details.description,
          workloadHours: details.workloadHours,
        }
      : { displayTitle: courseRow?.title ?? '', description: '', workloadHours: null },
    modules: modules.map<ModuleNode>((module) => ({
      id: module.id,
      title: module.title,
      dripDays: module.dripDays,
      lessons: lessons
        .filter((item) => item.moduleId === module.id)
        .map<LessonNode>((item) => ({
          id: item.id,
          title: item.title,
          isOptional: item.isOptional,
          body: (item.body as Record<string, unknown> | null) ?? null,
        })),
    })),
  };
}

/** Lê a árvore PUBLICADA ativa (sem o que foi aposentado). */
async function readPublishedTree(tx: Tx | Database, courseId: string): Promise<CurriculumTree> {
  const [details] = await tx
    .select()
    .from(courseContent)
    .where(eq(courseContent.courseId, courseId));
  const modules = await tx
    .select()
    .from(courseModule)
    .where(and(eq(courseModule.courseId, courseId), isNull(courseModule.retiredAt)))
    .orderBy(asc(courseModule.position));
  const lessons = await tx
    .select()
    .from(lesson)
    .where(and(eq(lesson.courseId, courseId), isNull(lesson.retiredAt)))
    .orderBy(asc(lesson.position));
  return {
    details: details
      ? {
          displayTitle: details.displayTitle,
          description: details.description,
          workloadHours: details.workloadHours,
        }
      : { displayTitle: '', description: '', workloadHours: null },
    modules: modules.map<ModuleNode>((module) => ({
      id: module.id,
      title: module.title,
      dripDays: module.dripDays,
      lessons: lessons
        .filter((item) => item.moduleId === module.id)
        .map<LessonNode>((item) => ({
          id: item.id,
          title: item.title,
          isOptional: item.isOptional,
          body: (item.body as Record<string, unknown> | null) ?? null,
        })),
    })),
  };
}

/** O rascunho do curso com o contador e a versão publicada; `null` se o curso não existe. */
export async function getDraft(db: Database, courseId: string): Promise<DraftDto | null> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx.select({ id: course.id }).from(course).where(eq(course.id, courseId));
      if (!row) return null;
      const [state] = await tx
        .select()
        .from(curriculumState)
        .where(eq(curriculumState.courseId, courseId));
      return {
        rev: state?.draftRev ?? 0,
        publishedVersion: state?.publishedVersion ?? 0,
        ...(await readDraftTree(tx, courseId)),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export interface DraftInput {
  details: CurriculumTree['details'];
  modules: {
    id?: string | undefined;
    title: string;
    dripDays: number;
    lessons: {
      id?: string | undefined;
      title: string;
      isOptional: boolean;
      body: Record<string, unknown> | null;
    }[];
  }[];
}

/**
 * Salva o rascunho INTEIRO. O contador sobe numa instrução condicional (`draft_rev = esperado`), que
 * também trava a linha e serializa edições concorrentes: quem leu um rascunho já superado recebe
 * `DraftConflictError`. Item com id mantém o id (editar, reordenar e mover aula de módulo não os
 * trocam); id que não é deste rascunho, ou repetido, é recusado. Não audita (salvar é frequente).
 */
export async function saveDraft(
  db: Database,
  input: { courseId: string; expectedRev: number } & DraftInput,
): Promise<DraftDto> {
  return db.transaction(async (tx) => {
    const [courseRow] = await tx
      .select({ id: course.id })
      .from(course)
      .where(eq(course.id, input.courseId));
    if (!courseRow) throw new CurriculumCourseNotFoundError();
    await ensureState(tx, input.courseId);
    const bumped = await tx
      .update(curriculumState)
      .set({ draftRev: sql`${curriculumState.draftRev} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(curriculumState.courseId, input.courseId),
          eq(curriculumState.draftRev, input.expectedRev),
        ),
      )
      .returning({ rev: curriculumState.draftRev });
    if (bumped.length === 0) {
      const [state] = await tx
        .select({ rev: curriculumState.draftRev })
        .from(curriculumState)
        .where(eq(curriculumState.courseId, input.courseId));
      throw new DraftConflictError(state?.rev ?? 0);
    }

    const knownModules = new Set(
      (
        await tx
          .select({ id: moduleDraft.id })
          .from(moduleDraft)
          .where(eq(moduleDraft.courseId, input.courseId))
      ).map((r) => r.id),
    );
    const knownLessons = new Set(
      (
        await tx
          .select({ id: lessonDraft.id })
          .from(lessonDraft)
          .where(eq(lessonDraft.courseId, input.courseId))
      ).map((r) => r.id),
    );
    const seenModules = new Set<string>();
    const seenLessons = new Set<string>();
    for (const module of input.modules) {
      if (module.id !== undefined) {
        if (!knownModules.has(module.id) || seenModules.has(module.id))
          throw new UnknownDraftIdError();
        seenModules.add(module.id);
      }
      for (const item of module.lessons) {
        if (item.id !== undefined) {
          if (!knownLessons.has(item.id) || seenLessons.has(item.id))
            throw new UnknownDraftIdError();
          seenLessons.add(item.id);
        }
      }
    }

    await tx
      .insert(courseDraft)
      .values({ courseId: input.courseId, ...input.details })
      .onConflictDoUpdate({
        target: courseDraft.courseId,
        set: { ...input.details, updatedAt: new Date() },
      });

    // 1) módulos (novos e existentes), 2) aulas (podem trocar de módulo), 3) remove o que sumiu.
    const moduleIds: string[] = [];
    for (const [position, module] of input.modules.entries()) {
      if (module.id !== undefined) {
        await tx
          .update(moduleDraft)
          .set({ title: module.title, dripDays: module.dripDays, position, updatedAt: new Date() })
          .where(and(eq(moduleDraft.id, module.id), eq(moduleDraft.courseId, input.courseId)));
        moduleIds.push(module.id);
      } else {
        const [created] = await tx
          .insert(moduleDraft)
          .values({
            courseId: input.courseId,
            title: module.title,
            dripDays: module.dripDays,
            position,
          })
          .returning({ id: moduleDraft.id });
        moduleIds.push(created!.id);
      }
    }
    const lessonIds: string[] = [];
    for (const [moduleIndex, module] of input.modules.entries()) {
      for (const [position, item] of module.lessons.entries()) {
        const values = {
          title: item.title,
          isOptional: item.isOptional,
          body: item.body,
          position,
          moduleId: moduleIds[moduleIndex]!,
        };
        if (item.id !== undefined) {
          await tx
            .update(lessonDraft)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(lessonDraft.id, item.id), eq(lessonDraft.courseId, input.courseId)));
          lessonIds.push(item.id);
        } else {
          const [created] = await tx
            .insert(lessonDraft)
            .values({ courseId: input.courseId, ...values })
            .returning({ id: lessonDraft.id });
          lessonIds.push(created!.id);
        }
      }
    }
    await tx
      .delete(lessonDraft)
      .where(
        and(
          eq(lessonDraft.courseId, input.courseId),
          lessonIds.length > 0 ? notInArray(lessonDraft.id, lessonIds) : undefined,
        ),
      );
    await tx
      .delete(moduleDraft)
      .where(
        and(
          eq(moduleDraft.courseId, input.courseId),
          moduleIds.length > 0 ? notInArray(moduleDraft.id, moduleIds) : undefined,
        ),
      );

    return {
      rev: bumped[0]!.rev,
      publishedVersion: (
        await tx.select().from(curriculumState).where(eq(curriculumState.courseId, input.courseId))
      )[0]!.publishedVersion,
      ...(await readDraftTree(tx, input.courseId)),
    };
  });
}

export type PublishResult = { status: 'published' | 'unchanged'; version: number };

/**
 * Publica o rascunho numa ÚNICA transação: trava o curso e o estado (`FOR UPDATE`; duas publicações
 * simultâneas se serializam), valida, e então aplica por id sobre as tabelas publicadas. O que saiu do
 * rascunho é APOSENTADO (`retired_at`), nunca apagado, e os ids se mantêm. Sem mudança em relação ao
 * publicado é um no-op explícito (`unchanged`). Falha em qualquer ponto desfaz tudo: o publicado
 * fica idêntico ao anterior e ninguém lê um estado misto.
 */
export async function publishCurriculum(
  db: Database,
  input: { actorId: string; courseId: string },
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: course.id })
      .from(course)
      .where(eq(course.id, input.courseId))
      .for('update');
    if (!locked) throw new CurriculumCourseNotFoundError();
    await ensureState(tx, input.courseId);
    const [state] = await tx
      .select()
      .from(curriculumState)
      .where(eq(curriculumState.courseId, input.courseId))
      .for('update');

    const draft = await readDraftTree(tx, input.courseId);
    const problems = validateCurriculum(draft);
    if (problems.length > 0) throw new CurriculumInvalidError(problems);
    if (
      state!.publishedVersion > 0 &&
      curriculumEquals(draft, await readPublishedTree(tx, input.courseId))
    ) {
      return { status: 'unchanged', version: state!.publishedVersion };
    }

    const knownModules = new Set(
      (
        await tx
          .select({ id: courseModule.id })
          .from(courseModule)
          .where(eq(courseModule.courseId, input.courseId))
      ).map((r) => r.id),
    );
    const knownLessons = new Set(
      (
        await tx.select({ id: lesson.id }).from(lesson).where(eq(lesson.courseId, input.courseId))
      ).map((r) => r.id),
    );

    await tx
      .insert(courseContent)
      .values({ courseId: input.courseId, ...draft.details })
      .onConflictDoUpdate({
        target: courseContent.courseId,
        set: { ...draft.details, updatedAt: new Date() },
      });

    let added = 0;
    for (const [position, module] of draft.modules.entries()) {
      const values = { title: module.title, dripDays: module.dripDays, position };
      if (knownModules.has(module.id)) {
        await tx
          .update(courseModule)
          .set(values)
          .where(and(eq(courseModule.id, module.id), eq(courseModule.courseId, input.courseId)));
      } else {
        added += 1;
        await tx
          .insert(courseModule)
          .values({ id: module.id, courseId: input.courseId, ...values });
      }
    }
    for (const module of draft.modules) {
      for (const [position, item] of module.lessons.entries()) {
        const values = {
          moduleId: module.id,
          title: item.title,
          isOptional: item.isOptional,
          body: item.body,
          position,
        };
        if (knownLessons.has(item.id)) {
          await tx
            .update(lesson)
            .set(values)
            .where(and(eq(lesson.id, item.id), eq(lesson.courseId, input.courseId)));
        } else {
          added += 1;
          await tx.insert(lesson).values({ id: item.id, courseId: input.courseId, ...values });
        }
      }
    }

    // Aposenta o que saiu do rascunho (a aula primeiro, depois o módulo); nada é apagado.
    const draftLessonIds = draft.modules.flatMap((module) => module.lessons.map((item) => item.id));
    const draftModuleIds = draft.modules.map((module) => module.id);
    const retiredLessons = await tx
      .update(lesson)
      .set({ retiredAt: new Date() })
      .where(
        and(
          eq(lesson.courseId, input.courseId),
          isNull(lesson.retiredAt),
          draftLessonIds.length > 0 ? notInArray(lesson.id, draftLessonIds) : undefined,
        ),
      )
      .returning({ id: lesson.id });
    const retiredModules = await tx
      .update(courseModule)
      .set({ retiredAt: new Date() })
      .where(
        and(
          eq(courseModule.courseId, input.courseId),
          isNull(courseModule.retiredAt),
          draftModuleIds.length > 0 ? notInArray(courseModule.id, draftModuleIds) : undefined,
        ),
      )
      .returning({ id: courseModule.id });

    const version = state!.publishedVersion + 1;
    await tx
      .update(curriculumState)
      .set({ publishedVersion: version, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(curriculumState.courseId, input.courseId));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'curriculum.publish',
      targetType: 'course',
      targetId: input.courseId,
      details: {
        version,
        modules: draft.modules.length,
        lessons: draftLessonIds.length,
        added,
        retiredModules: retiredModules.length,
        retiredLessons: retiredLessons.length,
      },
    });
    return { status: 'published', version };
  });
}

/**
 * O currículo PUBLICADO para quem estuda: só módulos e aulas ativos, nunca o rascunho. Lê tudo num
 * único instantâneo (REPEATABLE READ): uma publicação que confirme no meio da leitura nunca produz
 * um estado misto. `null` se o curso nunca foi publicado.
 */
export async function getPublishedCurriculum(
  db: Database,
  courseId: string,
): Promise<PublishedCurriculumDto | null> {
  return db.transaction(
    async (tx) => {
      const [state] = await tx
        .select()
        .from(curriculumState)
        .where(eq(curriculumState.courseId, courseId));
      if (!state || state.publishedVersion === 0) return null;
      return { version: state.publishedVersion, ...(await readPublishedTree(tx, courseId)) };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** Quais cursos têm currículo publicado (versão ≥ 1)? Alimenta a regra de "adquirível". */
export async function coursesWithPublishedCurriculum(
  db: Database,
  courseIds: string[],
): Promise<Set<string>> {
  if (courseIds.length === 0) return new Set();
  const rows = await db
    .select({ id: curriculumState.courseId, version: curriculumState.publishedVersion })
    .from(curriculumState)
    .where(inArray(curriculumState.courseId, courseIds));
  return new Set(rows.filter((row) => row.version > 0).map((row) => row.id));
}
