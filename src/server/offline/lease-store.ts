import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { enrollment } from '../../db/schema';
import { computeLeaseUntil, type OfflineLeaseDto } from '../../features/pwa/offline-lease';
import { resolveAccess } from '../access/entitlement-store';
import { hasStaffRole } from '../auth/access-store';

export type LeaseResult = { kind: 'ok'; lease: OfflineLeaseDto } | { kind: 'staff' };

/**
 * Lease de acesso offline (M8-02). Um lease por curso em que a pessoa TEM acesso agora, pela MESMA decisão do estudo
 * (`resolveAccess`): suspensa, expirada ou sem matrícula não recebe lease. `leaseUntil = min(expiração do direito,
 * agora + 72 h)`. Conta com papel de Staff não recebe nada (Staff é só online; nada dela vai para o aparelho). O usuário
 * vem SEMPRE da sessão. Emitir o lease não grava nada.
 */
export async function issueOfflineLease(
  db: Database,
  userId: string,
  now: Date,
): Promise<LeaseResult> {
  if (await hasStaffRole(db, userId)) return { kind: 'staff' };
  const rows = await db
    .select({ courseId: enrollment.courseId })
    .from(enrollment)
    .where(eq(enrollment.userId, userId));
  const courses: OfflineLeaseDto['courses'] = [];
  for (const row of rows) {
    const access = await resolveAccess(db, userId, row.courseId, now);
    if (!access.hasAccess || access.expiresAt === null) continue;
    courses.push({
      courseId: row.courseId,
      leaseUntil: computeLeaseUntil(access.expiresAt, now).toISOString(),
    });
  }
  return { kind: 'ok', lease: { serverNow: now.toISOString(), courses } };
}
