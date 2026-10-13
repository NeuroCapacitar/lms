import { and, eq, sql } from 'drizzle-orm';

import { courseInterest } from '../../db/schema';
import type { DomainTx } from '../async/outbox-store';

/**
 * Chamado na MESMA transação que cria o direito efetivo (M5-06): o interesse ativo da pessoa vira `converted`
 * e ela deixa de receber o aviso de abertura. Fica num arquivo próprio para o armazém de direitos poder
 * importá-lo sem formar ciclo com o armazém de interesses (que lê o acesso).
 */
export async function markInterestConvertedIn(
  tx: DomainTx,
  userId: string,
  courseId: string,
): Promise<void> {
  await tx
    .update(courseInterest)
    .set({ status: 'converted', updatedAt: sql`now()` })
    .where(
      and(
        eq(courseInterest.userId, userId),
        eq(courseInterest.courseId, courseId),
        sql`${courseInterest.status} = 'active'`,
      ),
    );
}
