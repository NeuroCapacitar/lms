import { and, asc, eq, sql } from 'drizzle-orm';

import {
  course,
  courseAvailabilityCycle,
  courseContent,
  courseInterest,
  courseInterestNotification,
} from '../../db/schema';
import { FANOUT_BATCH_SIZE, FANOUT_DEFER_SECONDS } from '../../features/interest/interest';
import { resolveAccessIn } from '../access/entitlement-store';
import { DeferError, PermanentError, type HandlerRegistry } from '../async/handler-types';
import { queueEmail } from '../email/email-store';

/**
 * Handler do aviso de abertura de vendas (M5-06). Roda FORA da transação do comando que abriu o ciclo, em
 * lotes de `FANOUT_BATCH_SIZE`, e é seguro repetir (a entrega é at-least-once): o `course_interest_notification`
 * (PK interesse+ciclo) e a `dedupe_key` do e-mail (`interesse+ciclo`) garantem NO MÁXIMO uma mensagem por
 * interesse e ciclo, mesmo com duas execuções simultâneas (cada lote trava as linhas com `SKIP LOCKED`).
 *
 * - Ciclo já FECHADO (as vendas fecharam antes do aviso): não avisa ninguém ("já abriu" seria falso).
 * - Interessada que já tem direito efetivo vira `converted` e não recebe nada.
 * - Interesse retirado antes do envio some do lote (só `active` entra).
 * - Lote cheio: o handler se ADIA (`DeferError`, sem gastar tentativa) e a próxima execução pega o resto.
 * A cota do Resend é tratada no envio (M4-08), não aqui.
 */
export function createInterestFanoutHandler(): HandlerRegistry['interest.fanout'] {
  return async ({ db, payload }) => {
    const full = await db.transaction(async (tx) => {
      const [cycle] = await tx
        .select()
        .from(courseAvailabilityCycle)
        .where(eq(courseAvailabilityCycle.id, payload.cycleId));
      if (!cycle) throw new PermanentError('cycle_not_found');
      if (cycle.closedAt !== null) return false;

      const [row] = await tx
        .select({ title: course.title, displayTitle: courseContent.displayTitle })
        .from(course)
        .leftJoin(courseContent, eq(courseContent.courseId, course.id))
        .where(eq(course.id, cycle.courseId));
      if (!row) throw new PermanentError('course_not_found');
      const title = row.displayTitle ?? row.title;

      const batch = await tx
        .select({ id: courseInterest.id, userId: courseInterest.userId })
        .from(courseInterest)
        .where(
          and(
            eq(courseInterest.courseId, cycle.courseId),
            eq(courseInterest.status, 'active'),
            sql`not exists (
              select 1 from course_interest_notification n
              where n.interest_id = ${courseInterest.id} and n.cycle_id = ${cycle.id}
            )`,
          ),
        )
        .orderBy(asc(courseInterest.id))
        .limit(FANOUT_BATCH_SIZE)
        .for('update', { of: courseInterest, skipLocked: true });

      const now = new Date();
      for (const interest of batch) {
        const access = await resolveAccessIn(tx, interest.userId, cycle.courseId, now);
        if (access.hasAccess) {
          await tx
            .update(courseInterest)
            .set({ status: 'converted', updatedAt: sql`now()` })
            .where(eq(courseInterest.id, interest.id));
          continue;
        }
        const marked = await tx
          .insert(courseInterestNotification)
          .values({ interestId: interest.id, cycleId: cycle.id })
          .onConflictDoNothing()
          .returning({ interestId: courseInterestNotification.interestId });
        if (marked.length === 0) continue;
        await queueEmail(tx, {
          template: 'course-available',
          dedupeKey: `course-available:${interest.id}:${cycle.id}`,
          recipientUserId: interest.userId,
          variables: { COURSE_TITLE: title },
          correlationId: crypto.randomUUID(),
        });
      }
      return batch.length >= FANOUT_BATCH_SIZE;
    });
    if (full) throw new DeferError('fanout_continues', FANOUT_DEFER_SECONDS);
  };
}
