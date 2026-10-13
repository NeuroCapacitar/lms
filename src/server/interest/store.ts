import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  course,
  courseAvailabilityCycle,
  courseContent,
  courseInterest,
  courseInterestNotification,
  curriculumState,
  offer,
} from '../../db/schema';
import {
  isOfferAcquirable,
  type CourseStatus,
  type OfferStatus,
} from '../../features/catalog/catalog';
import {
  cycleAction,
  type InterestStatsDto,
  type InterestStatus,
  type MyInterestDto,
} from '../../features/interest/interest';
import { resolveAccessIn } from '../access/entitlement-store';
import { enqueueIntent, type DomainTx } from '../async/outbox-store';

/** O curso não existe ou ainda não aparece no catálogo (só `published` recebe interesse). */
export class InterestCourseNotFoundError extends Error {
  constructor() {
    super('course_not_found');
  }
}

/** O curso já pode ser adquirido: não há o que esperar, a pessoa deve se inscrever. */
export class CourseAlreadyOpenError extends Error {
  constructor() {
    super('course_already_open');
  }
}

/** A pessoa já tem direito efetivo ao curso. */
export class AlreadyEnrolledError extends Error {
  constructor() {
    super('already_enrolled');
  }
}

/** Não há interesse registrado deste curso por esta pessoa. */
export class InterestNotFoundError extends Error {
  constructor() {
    super('interest_not_found');
  }
}

/** O curso é adquirível AGORA? A mesma regra do catálogo e da inscrição gratuita (curso publicado, oferta ativa, currículo publicado). */
async function isCourseAcquirableIn(tx: DomainTx, courseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ status: course.status })
    .from(course)
    .where(eq(course.id, courseId));
  if (!row) return false;
  const [state] = await tx
    .select({ version: curriculumState.publishedVersion })
    .from(curriculumState)
    .where(eq(curriculumState.courseId, courseId));
  const hasPublishedCurriculum = (state?.version ?? 0) > 0;
  const offers = await tx
    .select({ status: offer.status })
    .from(offer)
    .where(eq(offer.courseId, courseId));
  return offers.some((item) =>
    isOfferAcquirable({
      courseStatus: row.status as CourseStatus,
      offerStatus: item.status as OfferStatus,
      hasPublishedCurriculum,
    }),
  );
}

/**
 * Chamada DENTRO da transação de todo comando que pode mudar a disponibilidade (publicar o curso, mudar o
 * estado de uma oferta, publicar o currículo). Trava o curso (comandos no mesmo curso entram em fila), compara
 * a disponibilidade de agora com o ciclo aberto e: ABRE um ciclo na transição "não adquirível → adquirível"
 * (e enfileira o aviso aos interessados, em lotes, fora desta transação); FECHA o ciclo na volta; e não faz nada
 * se nada mudou (oferta nova em curso já aberto não cria ciclo). Devolve o que fez.
 */
export async function openAvailabilityCycleIfNeeded(
  tx: DomainTx,
  courseId: string,
): Promise<'opened' | 'closed' | 'none'> {
  await tx.select({ id: course.id }).from(course).where(eq(course.id, courseId)).for('update');
  const acquirable = await isCourseAcquirableIn(tx, courseId);
  const [open] = await tx
    .select({ id: courseAvailabilityCycle.id })
    .from(courseAvailabilityCycle)
    .where(
      and(
        eq(courseAvailabilityCycle.courseId, courseId),
        sql`${courseAvailabilityCycle.closedAt} is null`,
      ),
    );
  const action = cycleAction(acquirable, open !== undefined);
  if (action === 'close') {
    await tx
      .update(courseAvailabilityCycle)
      .set({ closedAt: sql`now()` })
      .where(eq(courseAvailabilityCycle.id, open!.id));
    return 'closed';
  }
  if (action === 'none') return 'none';

  const [last] = await tx
    .select({ number: courseAvailabilityCycle.number })
    .from(courseAvailabilityCycle)
    .where(eq(courseAvailabilityCycle.courseId, courseId))
    .orderBy(desc(courseAvailabilityCycle.number))
    .limit(1);
  const [created] = await tx
    .insert(courseAvailabilityCycle)
    .values({ courseId, number: (last?.number ?? 0) + 1 })
    .returning({ id: courseAvailabilityCycle.id });
  // Só há o que avisar se alguém pediu: sem interessados ativos não se grava intenção à toa. Quem registra
  // depois não entra neste ciclo (o curso já está aberto e o registro é recusado).
  const [anyone] = await tx
    .select({ id: courseInterest.id })
    .from(courseInterest)
    .where(and(eq(courseInterest.courseId, courseId), eq(courseInterest.status, 'active')))
    .limit(1);
  if (anyone) {
    await enqueueIntent(tx, {
      kind: 'interest.fanout',
      dedupeKey: `interest-fanout:${created!.id}`,
      payload: { cycleId: created!.id },
      correlationId: crypto.randomUUID(),
    });
  }
  return 'opened';
}

/**
 * Registra (ou reativa) o interesse da pessoa. Só se o curso aparece no catálogo, AINDA não é adquirível e a
 * pessoa não tem direito efetivo. O curso é travado: o registro e a abertura de vendas entram em fila, então
 * quem registra antes é incluída no aviso e quem tenta depois recebe `CourseAlreadyOpenError`. Repetir é
 * idempotente (já ativo não muda nada); retirado volta a ativo.
 */
export async function registerInterest(
  db: Database,
  input: { userId: string; courseId: string; clock?: () => Date },
): Promise<{ status: InterestStatus }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: course.status })
      .from(course)
      .where(eq(course.id, input.courseId))
      .for('update');
    if (!row || row.status !== 'published') throw new InterestCourseNotFoundError();
    if (await isCourseAcquirableIn(tx, input.courseId)) throw new CourseAlreadyOpenError();
    const now = input.clock ? input.clock() : new Date();
    const access = await resolveAccessIn(tx, input.userId, input.courseId, now);
    if (access.hasAccess) throw new AlreadyEnrolledError();

    await tx
      .insert(courseInterest)
      .values({ userId: input.userId, courseId: input.courseId })
      .onConflictDoUpdate({
        target: [courseInterest.courseId, courseInterest.userId],
        set: { status: 'active', updatedAt: sql`now()` },
        setWhere: sql`${courseInterest.status} <> 'active'`,
      });
    return { status: 'active' };
  });
}

/** A pessoa retira o interesse (some dos próximos avisos). Idempotente: já retirado continua retirado. */
export async function withdrawInterest(
  db: Database,
  input: { userId: string; courseId: string },
): Promise<void> {
  const [row] = await db
    .update(courseInterest)
    .set({ status: 'withdrawn', updatedAt: sql`now()` })
    .where(
      and(
        eq(courseInterest.userId, input.userId),
        eq(courseInterest.courseId, input.courseId),
        sql`${courseInterest.status} = 'active'`,
      ),
    )
    .returning({ id: courseInterest.id });
  if (row) return;
  const [existing] = await db
    .select({ id: courseInterest.id })
    .from(courseInterest)
    .where(
      and(eq(courseInterest.userId, input.userId), eq(courseInterest.courseId, input.courseId)),
    );
  if (!existing) throw new InterestNotFoundError();
}

/** Os interesses da pessoa (todos os estados), com o título público do curso. */
export async function listMyInterests(db: Database, userId: string): Promise<MyInterestDto[]> {
  const rows = await db
    .select({
      courseId: course.id,
      slug: course.slug,
      title: course.title,
      displayTitle: courseContent.displayTitle,
      status: courseInterest.status,
    })
    .from(courseInterest)
    .innerJoin(course, eq(course.id, courseInterest.courseId))
    .leftJoin(courseContent, eq(courseContent.courseId, course.id))
    .where(eq(courseInterest.userId, userId))
    .orderBy(asc(course.slug));
  return rows.map((row) => ({
    courseId: row.courseId,
    slug: row.slug,
    title: row.displayTitle ?? row.title,
    status: row.status as InterestStatus,
  }));
}

/** Contagens por curso e por ciclo para a Staff (nunca a lista de pessoas). */
export async function interestStats(db: Database, courseId: string): Promise<InterestStatsDto> {
  const counts = await db
    .select({ status: courseInterest.status, total: sql<number>`count(*)::int` })
    .from(courseInterest)
    .where(eq(courseInterest.courseId, courseId))
    .groupBy(courseInterest.status);
  const of = (status: InterestStatus) => counts.find((row) => row.status === status)?.total ?? 0;
  const cycles = await db
    .select({
      number: courseAvailabilityCycle.number,
      openedAt: courseAvailabilityCycle.openedAt,
      closedAt: courseAvailabilityCycle.closedAt,
      notified: sql<number>`count(${courseInterestNotification.interestId})::int`,
    })
    .from(courseAvailabilityCycle)
    .leftJoin(
      courseInterestNotification,
      eq(courseInterestNotification.cycleId, courseAvailabilityCycle.id),
    )
    .where(eq(courseAvailabilityCycle.courseId, courseId))
    .groupBy(courseAvailabilityCycle.id)
    .orderBy(asc(courseAvailabilityCycle.number));
  return {
    active: of('active'),
    withdrawn: of('withdrawn'),
    converted: of('converted'),
    cycles: cycles.map((row) => ({
      number: row.number,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      notified: row.notified,
    })),
  };
}
