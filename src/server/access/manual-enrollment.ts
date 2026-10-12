import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  course,
  courseCompletion,
  entitlement,
  enrollment,
  lessonCompletion,
  user,
  userSuspension,
} from '../../db/schema';
import { addCalendarMonths, decideAccess } from '../../features/access/access';
import type { EnrolleeDto, EnrolleePageDto } from '../../features/access/manual-enrollment';
import { computeProgress } from '../../features/access/progress';
import { auditEvent } from '../auth/access-store';
import { readPublishedTree } from '../catalog/curriculum-store';
import { grantEntitlementIn, recompute } from './entitlement-store';

/** Nenhuma conta com este e-mail: a matrícula manual NÃO cria usuário (a pessoa se cadastra antes). */
export class UserNotFoundError extends Error {
  constructor() {
    super('user_not_found');
  }
}

export class CourseMissingError extends Error {
  constructor() {
    super('course_not_found');
  }
}

export class NotEnrolledError extends Error {
  constructor() {
    super('not_enrolled');
  }
}

export class EntitlementMissingError extends Error {
  constructor() {
    super('entitlement_not_found');
  }
}

/** Só a matrícula manual (`admin_grant`, não revogada) se ajusta; compra e inscrição gratuita, nunca. */
export class NotAdjustableError extends Error {
  constructor() {
    super('not_adjustable');
  }
}

/**
 * Matricula uma pessoa JÁ cadastrada (achada pelo e-mail) por N meses (M3-06). Cria um direito
 * `admin_grant` e recompõe a matrícula na mesma transação; a chave de idempotência é o `requestId`
 * da tela, então um duplo envio não duplica o direito (a mesma chave para OUTRA pessoa ou curso é
 * recusada). Sem Order nem Payment. Audita autor, alvo e motivo.
 */
export async function grantManualEnrollment(
  db: Database,
  input: {
    actorId: string;
    email: string;
    courseId: string;
    months: number;
    reason: string;
    requestId: string;
    clock?: () => Date;
  },
) {
  const clock = input.clock ?? (() => new Date());
  return db.transaction(async (tx) => {
    const [person] = await tx.select({ id: user.id }).from(user).where(eq(user.email, input.email));
    if (!person) throw new UserNotFoundError();
    const [target] = await tx
      .select({ id: course.id })
      .from(course)
      .where(eq(course.id, input.courseId));
    if (!target) throw new CourseMissingError();
    const result = await grantEntitlementIn(tx, {
      userId: person.id,
      courseId: input.courseId,
      offerId: null,
      source: 'admin_grant',
      sourceRef: `manual:${input.requestId}`,
      accessMonths: input.months,
      startsAt: clock(),
      grantedBy: input.actorId,
      reason: input.reason,
    });
    return { ...result, userId: person.id };
  });
}

async function lockedEnrollment(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  userId: string,
  courseId: string,
) {
  const [row] = await tx
    .select({ suspendedAt: enrollment.suspendedAt })
    .from(enrollment)
    .where(and(eq(enrollment.userId, userId), eq(enrollment.courseId, courseId)))
    .for('update');
  if (!row) throw new NotEnrolledError();
  return row;
}

/**
 * Suspende o acesso à matrícula (M3-06): só preenche `suspended_at` e o motivo. Não toca nos
 * direitos, na âncora nem no progresso; vale na requisição seguinte (o acesso é decidido a cada
 * chamada). Já suspensa é um no-op.
 */
export async function suspendEnrollment(
  db: Database,
  input: { actorId: string; userId: string; courseId: string; reason: string; clock?: () => Date },
): Promise<{ changed: boolean }> {
  const clock = input.clock ?? (() => new Date());
  return db.transaction(async (tx) => {
    const current = await lockedEnrollment(tx, input.userId, input.courseId);
    if (current.suspendedAt !== null) return { changed: false };
    await tx
      .update(enrollment)
      .set({ suspendedAt: clock(), suspendedReason: input.reason, suspendedBy: input.actorId })
      .where(and(eq(enrollment.userId, input.userId), eq(enrollment.courseId, input.courseId)));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'enrollment.suspend',
      targetType: 'enrollment',
      targetId: `${input.courseId}:${input.userId}`,
      details: { userId: input.userId, courseId: input.courseId, reason: input.reason },
    });
    return { changed: true };
  });
}

/** Reativa a matrícula suspensa: limpa a suspensão e MANTÉM a âncora, os direitos e o progresso. */
export async function reinstateEnrollment(
  db: Database,
  input: { actorId: string; userId: string; courseId: string },
): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    const current = await lockedEnrollment(tx, input.userId, input.courseId);
    if (current.suspendedAt === null) return { changed: false };
    await tx
      .update(enrollment)
      .set({ suspendedAt: null, suspendedReason: null, suspendedBy: null })
      .where(and(eq(enrollment.userId, input.userId), eq(enrollment.courseId, input.courseId)));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'enrollment.reinstate',
      targetType: 'enrollment',
      targetId: `${input.courseId}:${input.userId}`,
      details: { userId: input.userId, courseId: input.courseId },
    });
    return { changed: true };
  });
}

/**
 * Ajusta o prazo de uma matrícula MANUAL (M3-06): o direito é imutável (gatilho), então o ajuste
 * REVOGA o antigo e cria um novo `admin_grant` com a mesma data de início e o novo total de meses,
 * tudo na mesma transação, com a matrícula recalculada. O histórico fica inteiro. Direito de compra
 * ou de inscrição gratuita, ou já revogado: `NotAdjustableError`. O `requestId` é a idempotência.
 */
export async function adjustManualGrant(
  db: Database,
  input: {
    actorId: string;
    entitlementId: string;
    months: number;
    reason: string;
    requestId: string;
    clock?: () => Date;
  },
): Promise<{ adjusted: boolean; entitlementId: string; expiresAt: Date }> {
  const clock = input.clock ?? (() => new Date());
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(entitlement)
      .where(eq(entitlement.id, input.entitlementId));
    if (!found) throw new EntitlementMissingError();
    await lockedEnrollment(tx, found.userId, found.courseId);
    // relê já com a matrícula travada: outro ajuste pode ter revogado este direito
    const [old] = await tx
      .select()
      .from(entitlement)
      .where(eq(entitlement.id, input.entitlementId));
    if (!old || old.source !== 'admin_grant' || old.revokedAt !== null)
      throw new NotAdjustableError();

    const expiresAt = addCalendarMonths(old.startsAt, input.months);
    const inserted = await tx
      .insert(entitlement)
      .values({
        userId: old.userId,
        courseId: old.courseId,
        offerId: null,
        source: 'admin_grant',
        sourceRef: `manual:${input.requestId}`,
        startsAt: old.startsAt,
        expiresAt,
        grantedBy: input.actorId,
      })
      .onConflictDoNothing({ target: [entitlement.source, entitlement.sourceRef] })
      .returning({ id: entitlement.id });
    const created = inserted[0];
    if (!created) {
      // a mesma chave já foi usada: repetição idempotente, nada muda
      const [again] = await tx
        .select({ id: entitlement.id, expiresAt: entitlement.expiresAt })
        .from(entitlement)
        .where(
          and(
            eq(entitlement.source, 'admin_grant'),
            eq(entitlement.sourceRef, `manual:${input.requestId}`),
          ),
        );
      return { adjusted: false, entitlementId: again!.id, expiresAt: again!.expiresAt };
    }
    await tx
      .update(entitlement)
      .set({
        revokedAt: clock(),
        revokedReason: `adjusted: ${input.reason}`,
        revokedBy: input.actorId,
      })
      .where(eq(entitlement.id, old.id));
    await recompute(tx, old.userId, old.courseId);
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'entitlement.adjust',
      targetType: 'entitlement',
      targetId: created.id,
      details: {
        userId: old.userId,
        courseId: old.courseId,
        replaced: old.id,
        from: old.expiresAt.toISOString(),
        to: expiresAt.toISOString(),
        months: input.months,
        reason: input.reason,
      },
    });
    return { adjusted: true, entitlementId: created.id, expiresAt };
  });
}

/**
 * Lista paginada de inscritos do curso (qualquer Staff, M3-06): nome, e-mail, situação, expiração e
 * progresso das obrigatórias. A situação vem da MESMA `decideAccess` do aluno, avaliada agora.
 */
export async function listEnrollees(
  db: Database,
  courseId: string,
  input: { page: number; pageSize: number; now: Date },
): Promise<EnrolleePageDto> {
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(enrollment)
    .where(eq(enrollment.courseId, courseId));
  const rows = await db
    .select({
      userId: enrollment.userId,
      anchorAt: enrollment.anchorAt,
      suspendedAt: enrollment.suspendedAt,
      suspendedReason: enrollment.suspendedReason,
      name: user.name,
      email: user.email,
    })
    .from(enrollment)
    .innerJoin(user, eq(user.id, enrollment.userId))
    .where(eq(enrollment.courseId, courseId))
    .orderBy(asc(user.email))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const userIds = rows.map((row) => row.userId);
  if (userIds.length === 0) {
    return { items: [], total, page: input.page, pageSize: input.pageSize };
  }

  const rights = await db
    .select()
    .from(entitlement)
    .where(and(eq(entitlement.courseId, courseId), inArray(entitlement.userId, userIds)));
  const suspendedAccounts = new Set(
    (
      await db
        .select({ userId: userSuspension.userId })
        .from(userSuspension)
        .where(and(inArray(userSuspension.userId, userIds), isNull(userSuspension.liftedAt)))
    ).map((row) => row.userId),
  );
  const done = await db
    .select({ userId: lessonCompletion.userId, lessonId: lessonCompletion.lessonId })
    .from(lessonCompletion)
    .where(and(eq(lessonCompletion.courseId, courseId), inArray(lessonCompletion.userId, userIds)));
  const finished = new Map(
    (
      await db
        .select({ userId: courseCompletion.userId, completedAt: courseCompletion.completedAt })
        .from(courseCompletion)
        .where(
          and(eq(courseCompletion.courseId, courseId), inArray(courseCompletion.userId, userIds)),
        )
    ).map((row) => [row.userId, row.completedAt]),
  );
  const tree = await readPublishedTree(db, courseId);

  const items = rows.map<EnrolleeDto>((row) => {
    const own = rights.filter((item) => item.userId === row.userId);
    const access = decideAccess({
      enrollment: { anchorAt: row.anchorAt, suspendedAt: row.suspendedAt },
      accountSuspended: suspendedAccounts.has(row.userId),
      entitlements: own,
      now: input.now,
    });
    const manual = own
      .filter((item) => item.source === 'admin_grant' && item.revokedAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const completed = new Set(
      done.filter((item) => item.userId === row.userId).map((item) => item.lessonId),
    );
    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      status:
        access.reason === 'ok'
          ? 'active'
          : access.reason === 'expired'
            ? 'expired'
            : access.reason === 'suspended'
              ? 'suspended'
              : 'inactive',
      expiresAt: access.expiresAt ? access.expiresAt.toISOString() : null,
      anchorAt: row.anchorAt.toISOString(),
      suspendedReason: row.suspendedReason,
      progress: computeProgress(tree.modules, completed),
      courseCompletedAt: finished.get(row.userId)?.toISOString() ?? null,
      manualGrant: manual
        ? { entitlementId: manual.id, expiresAt: manual.expiresAt.toISOString() }
        : null,
    };
  });
  return { items, total, page: input.page, pageSize: input.pageSize };
}
