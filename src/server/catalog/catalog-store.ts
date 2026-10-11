import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { isCheckViolation, isRestrictViolation, isUniqueViolation } from '../../db/pg-errors';
import { course, courseContent, curriculumState, offer } from '../../db/schema';
import {
  canTransitionCourse,
  canTransitionOffer,
  isOfferAcquirable,
  validateOfferTerms,
  type CourseStatus,
  type OfferKind,
  type OfferStatus,
  type PublicCourseDto,
  type PublicOfferDto,
  type SequenceMode,
  type StaffCourseDto,
  type StaffOfferDto,
} from '../../features/catalog/catalog';
import type { RichText } from '../../features/content/rich-text';
import { auditEvent } from '../auth/access-store';
import { coursesWithPublishedCurriculum } from './curriculum-store';

/** Outro curso já usa este slug. */
export class SlugTakenError extends Error {
  constructor() {
    super('slug_taken');
  }
}
/** O curso já foi publicado alguma vez: o slug (base das URLs) não muda mais. */
export class SlugLockedError extends Error {
  constructor() {
    super('slug_locked');
  }
}
export class CourseNotFoundError extends Error {
  constructor() {
    super('course_not_found');
  }
}
export class OfferNotFoundError extends Error {
  constructor() {
    super('offer_not_found');
  }
}
/** Curso arquivado não ganha oferta nova. */
export class CourseArchivedError extends Error {
  constructor() {
    super('course_archived');
  }
}
/** Oferta arquivada é terminal: nada nela muda. */
export class OfferArchivedError extends Error {
  constructor() {
    super('offer_archived');
  }
}
export class InvalidTransitionError extends Error {
  constructor() {
    super('invalid_transition');
  }
}
/** Termos comerciais incompatíveis (preço, prazo ou parcelas); `fields` diz quais. */
export class InvalidOfferTermsError extends Error {
  constructor(readonly fields: string[]) {
    super('invalid_offer_terms');
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const iso = (value: Date) => value.toISOString();

function toStaffOffer(row: typeof offer.$inferSelect): StaffOfferDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as OfferKind,
    priceCents: row.priceCents,
    accessMonths: row.accessMonths,
    maxInstallments: row.maxInstallments,
    status: row.status as OfferStatus,
    currency: 'BRL',
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toStaffCourse(
  row: typeof course.$inferSelect,
  offers: StaffOfferDto[],
  publishedVersion: number,
): StaffCourseDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    sequenceMode: row.sequenceMode as SequenceMode,
    status: row.status as CourseStatus,
    firstPublishedAt: row.firstPublishedAt ? iso(row.firstPublishedAt) : null,
    publishedVersion,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    offers,
  };
}

async function lockCourse(tx: Tx, id: string) {
  const [row] = await tx.select().from(course).where(eq(course.id, id)).for('update');
  if (!row) throw new CourseNotFoundError();
  return row;
}

async function lockOffer(tx: Tx, courseId: string, offerId: string) {
  const [row] = await tx
    .select()
    .from(offer)
    .where(and(eq(offer.id, offerId), eq(offer.courseId, courseId)))
    .for('update');
  if (!row) throw new OfferNotFoundError();
  return row;
}

/** Cria o curso em rascunho. A sequência pedagógica é obrigatória (sem padrão). Audita. */
export async function createCourse(
  db: Database,
  input: { actorId: string | null; slug: string; title: string; sequenceMode: SequenceMode },
): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(course)
        .values({
          slug: input.slug,
          title: input.title,
          sequenceMode: input.sequenceMode,
          createdBy: input.actorId,
        })
        .returning({ id: course.id });
      await auditEvent(tx, {
        actorId: input.actorId,
        action: 'course.create',
        targetType: 'course',
        targetId: created!.id,
        details: { sequenceMode: input.sequenceMode },
      });
      return created!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError();
    throw error;
  }
}

/** Edita título e slug. O slug só muda enquanto o curso nunca foi publicado (o banco garante). */
export async function updateCourse(
  db: Database,
  input: { actorId: string; id: string; slug?: string; title?: string },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const current = await lockCourse(tx, input.id);
      const changes: { slug?: string; title?: string } = {};
      if (input.slug !== undefined && input.slug !== current.slug) changes.slug = input.slug;
      if (input.title !== undefined && input.title !== current.title) changes.title = input.title;
      if (Object.keys(changes).length === 0) return;
      await tx.update(course).set(changes).where(eq(course.id, input.id));
      await auditEvent(tx, {
        actorId: input.actorId,
        action: 'course.update',
        targetType: 'course',
        targetId: input.id,
        details: { fields: Object.keys(changes) },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError();
    if (isRestrictViolation(error, 'slug_locked')) throw new SlugLockedError();
    throw error;
  }
}

/**
 * Muda a visibilidade do curso (`published` aparece no catálogo; `archived` sai dele sem apagar
 * direitos). Publicado nunca volta a rascunho. A exigência de currículo publicado entra no M2-02.
 */
export async function setCourseStatus(
  db: Database,
  input: { actorId: string | null; id: string; status: CourseStatus },
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await lockCourse(tx, input.id);
    if (!canTransitionCourse(current.status as CourseStatus, input.status)) {
      throw new InvalidTransitionError();
    }
    await tx.update(course).set({ status: input.status }).where(eq(course.id, input.id));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'course.status',
      targetType: 'course',
      targetId: input.id,
      details: { from: current.status, to: input.status },
    });
  });
}

/** Cria uma oferta em rascunho para o curso. Curso arquivado não ganha oferta. Audita os termos. */
export async function createOffer(
  db: Database,
  input: {
    actorId: string | null;
    courseId: string;
    name: string;
    kind: OfferKind;
    priceCents: number;
    accessMonths: number;
    maxInstallments: number;
  },
): Promise<string> {
  const problems = validateOfferTerms(input);
  if (problems.length > 0) throw new InvalidOfferTermsError(problems);
  return db.transaction(async (tx) => {
    const parent = await lockCourse(tx, input.courseId);
    if (parent.status === 'archived') throw new CourseArchivedError();
    const [created] = await tx
      .insert(offer)
      .values({
        courseId: input.courseId,
        name: input.name,
        kind: input.kind,
        priceCents: input.priceCents,
        accessMonths: input.accessMonths,
        maxInstallments: input.maxInstallments,
        createdBy: input.actorId,
      })
      .returning({ id: offer.id });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'offer.create',
      targetType: 'offer',
      targetId: created!.id,
      details: {
        courseId: input.courseId,
        kind: input.kind,
        priceCents: input.priceCents,
        accessMonths: input.accessMonths,
        maxInstallments: input.maxInstallments,
      },
    });
    return created!.id;
  });
}

/**
 * Edita nome e termos comerciais (a modalidade não muda por aqui). Confere a combinação com a
 * modalidade guardada e audita o antes e o depois dos números (preço é dado sensível ao negócio).
 */
export async function updateOffer(
  db: Database,
  input: {
    actorId: string;
    courseId: string;
    offerId: string;
    name?: string;
    priceCents?: number;
    accessMonths?: number;
    maxInstallments?: number;
  },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const current = await lockOffer(tx, input.courseId, input.offerId);
      if (current.status === 'archived') throw new OfferArchivedError();
      const next = {
        name: input.name ?? current.name,
        priceCents: input.priceCents ?? current.priceCents,
        accessMonths: input.accessMonths ?? current.accessMonths,
        maxInstallments: input.maxInstallments ?? current.maxInstallments,
      };
      const problems = validateOfferTerms({ kind: current.kind as OfferKind, ...next });
      if (problems.length > 0) throw new InvalidOfferTermsError(problems);
      await tx.update(offer).set(next).where(eq(offer.id, current.id));
      await auditEvent(tx, {
        actorId: input.actorId,
        action: 'offer.update',
        targetType: 'offer',
        targetId: current.id,
        details: {
          before: {
            priceCents: current.priceCents,
            accessMonths: current.accessMonths,
            maxInstallments: current.maxInstallments,
          },
          after: {
            priceCents: next.priceCents,
            accessMonths: next.accessMonths,
            maxInstallments: next.maxInstallments,
          },
        },
      });
    });
  } catch (error) {
    if (isCheckViolation(error)) throw new InvalidOfferTermsError([]);
    if (isRestrictViolation(error, 'offer_archived')) throw new OfferArchivedError();
    throw error;
  }
}

/** Ativa, pausa ou arquiva a oferta. Arquivada é terminal. Audita a transição. */
export async function setOfferStatus(
  db: Database,
  input: { actorId: string | null; courseId: string; offerId: string; status: OfferStatus },
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await lockOffer(tx, input.courseId, input.offerId);
    if (!canTransitionOffer(current.status as OfferStatus, input.status)) {
      throw new InvalidTransitionError();
    }
    await tx.update(offer).set({ status: input.status }).where(eq(offer.id, current.id));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'offer.status',
      targetType: 'offer',
      targetId: current.id,
      details: { from: current.status, to: input.status },
    });
  });
}

async function offersOf(db: Database | Tx, courseIds: string[]) {
  if (courseIds.length === 0) return [];
  return db
    .select()
    .from(offer)
    .where(inArray(offer.courseId, courseIds))
    .orderBy(asc(offer.createdAt));
}

/** Todos os cursos para a Staff, os mais novos primeiro, cada um com as suas ofertas. */
export async function listStaffCourses(db: Database): Promise<StaffCourseDto[]> {
  const courses = await db.select().from(course).orderBy(desc(course.createdAt));
  const ids = courses.map((row) => row.id);
  const offers = await offersOf(db, ids);
  const versions = await publishedVersions(db, ids);
  return courses.map((row) =>
    toStaffCourse(
      row,
      offers.filter((item) => item.courseId === row.id).map(toStaffOffer),
      versions.get(row.id) ?? 0,
    ),
  );
}

async function publishedVersions(db: Database, courseIds: string[]): Promise<Map<string, number>> {
  if (courseIds.length === 0) return new Map();
  const rows = await db
    .select({ id: curriculumState.courseId, version: curriculumState.publishedVersion })
    .from(curriculumState)
    .where(inArray(curriculumState.courseId, courseIds));
  return new Map(rows.map((row) => [row.id, row.version]));
}

export async function getStaffCourse(db: Database, id: string): Promise<StaffCourseDto | null> {
  const [row] = await db.select().from(course).where(eq(course.id, id));
  if (!row) return null;
  const offers = await offersOf(db, [row.id]);
  const versions = await publishedVersions(db, [row.id]);
  return toStaffCourse(row, offers.map(toStaffOffer), versions.get(row.id) ?? 0);
}

function toPublicCourse(
  row: typeof course.$inferSelect,
  offers: (typeof offer.$inferSelect)[],
  hasPublishedCurriculum: boolean,
  content: PublicCourseDto['content'],
): PublicCourseDto {
  const acquirable = offers.filter((item) =>
    isOfferAcquirable({
      courseStatus: row.status as CourseStatus,
      offerStatus: item.status as OfferStatus,
      hasPublishedCurriculum,
    }),
  );
  const publicOffers: PublicOfferDto[] = acquirable.map((item) => ({
    id: item.id,
    name: item.name,
    kind: item.kind as OfferKind,
    priceCents: item.priceCents,
    accessMonths: item.accessMonths,
    maxInstallments: item.maxInstallments,
  }));
  return {
    slug: row.slug,
    sequenceMode: row.sequenceMode as SequenceMode,
    acquirable: publicOffers.length > 0,
    content,
    offers: publicOffers,
  };
}

/**
 * Cursos visíveis ao público/aluno: só os `published`, SEM título interno, criador nem estado de
 * autoria; o curso aparece mesmo sem oferta ativa (`acquirable: false`). Só ofertas ativas saem.
 */
export async function listPublicCourses(db: Database): Promise<PublicCourseDto[]> {
  const courses = await db
    .select()
    .from(course)
    .where(eq(course.status, 'published'))
    .orderBy(asc(course.slug));
  const ids = courses.map((row) => row.id);
  const offers = await offersOf(db, ids);
  const published = await coursesWithPublishedCurriculum(db, ids);
  const contents = await publicContents(db, [...published]);
  return courses.map((row) =>
    toPublicCourse(
      row,
      offers.filter((item) => item.courseId === row.id),
      published.has(row.id),
      contents.get(row.id) ?? null,
    ),
  );
}

async function publicContents(
  db: Database,
  courseIds: string[],
): Promise<Map<string, NonNullable<PublicCourseDto['content']>>> {
  if (courseIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(courseContent)
    .where(inArray(courseContent.courseId, courseIds));
  return new Map(
    rows.map((row) => [
      row.courseId,
      {
        title: row.displayTitle,
        description: (row.description as RichText | null) ?? null,
        workloadHours: row.workloadHours,
      },
    ]),
  );
}

export async function getPublicCourse(db: Database, slug: string): Promise<PublicCourseDto | null> {
  const [row] = await db
    .select()
    .from(course)
    .where(and(eq(course.slug, slug), eq(course.status, 'published')));
  if (!row) return null;
  const published = await coursesWithPublishedCurriculum(db, [row.id]);
  const contents = await publicContents(db, [...published]);
  return toPublicCourse(
    row,
    await offersOf(db, [row.id]),
    published.has(row.id),
    contents.get(row.id) ?? null,
  );
}
