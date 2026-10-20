import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { planReplay, type RevocationLogEntry } from '../../features/ops/revocation-log';
import { revokeEntitlementIn } from '../access/entitlement-store';
import { auditEvent } from '../auth/access-store';

/**
 * Reaplica, depois de restaurar um backup, as revogações e suspensões registradas FORA do banco (M9-05, ADR 0034). Vale o
 * ESTADO FINAL de cada alvo, na ordem da auditoria (`planReplay`). Cada passo é idempotente, tem o resultado contado
 * (aplicado, já estava, ausente na cópia restaurada) e deixa uma linha de auditoria `restore.revocation_reapplied` só com ids.
 * Usa SQL direto e a auditoria PRÓPRIA (não as funções da Staff): não depende de uma pessoa logada e não gera novas linhas
 * no diário (a ação original já está nele).
 */
export interface ReplaySummary {
  applied: number;
  alreadyDone: number;
  /** O alvo não existe na cópia restaurada (nasceu depois do backup). */
  absent: number;
  /** Quantos passos o registro reduziu. */
  steps: number;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

type Outcome = 'applied' | 'already' | 'absent';

export async function replayRevocations(
  db: Database,
  entries: readonly RevocationLogEntry[],
  options: { execute: boolean },
): Promise<ReplaySummary> {
  const steps = planReplay(entries);
  const summary: ReplaySummary = { applied: 0, alreadyDone: 0, absent: 0, steps: steps.length };

  for (const step of steps) {
    const outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const run = options.execute;
      let result: Outcome;
      let target: string;
      switch (step.kind) {
        case 'certificate.revoke': {
          target = step.certificateId;
          const [row] = rowsOf(
            await tx.execute(
              sql`select status from certificate where id = ${step.certificateId}::uuid for update`,
            ),
          );
          if (!row) return 'absent';
          if (row.status !== 'ready') return 'already';
          if (!run) return 'applied';
          await tx.execute(sql`
            update certificate
               set status = 'revoked', revoked_at = ${step.occurredAt}::timestamptz,
                   revocation_category = ${step.category ?? 'other'},
                   revocation_note = 'Reaplicada do registro fora do banco (restauração)'
             where id = ${step.certificateId}::uuid and status = 'ready'`);
          result = 'applied';
          break;
        }
        case 'entitlement.revoke': {
          target = step.entitlementId;
          const [row] = rowsOf(
            await tx.execute(
              sql`select revoked_at from entitlement where id = ${step.entitlementId}::uuid for update`,
            ),
          );
          if (!row) return 'absent';
          if (row.revoked_at !== null) return 'already';
          if (!run) return 'applied';
          // Mesma regra de sempre (recalcula a matrícula e audita): reaproveita a função da Staff, sem pessoa logada.
          await revokeEntitlementIn(tx, {
            entitlementId: step.entitlementId,
            reason: 'restore_reapply',
            actorId: null,
            now: new Date(),
          });
          result = 'applied';
          break;
        }
        case 'account': {
          target = step.userId;
          const [row] = rowsOf(
            await tx.execute(sql`select id from "user" where id = ${step.userId} for update`),
          );
          if (!row) return 'absent';
          const active = rowsOf(
            await tx.execute(
              sql`select id from user_suspension where user_id = ${step.userId} and lifted_at is null`,
            ),
          );
          if (step.suspended ? active.length > 0 : active.length === 0) return 'already';
          if (!run) return 'applied';
          if (step.suspended) {
            await tx.execute(
              sql`insert into user_suspension (user_id, reason) values (${step.userId}, 'restore_reapply')`,
            );
            await tx.execute(sql`delete from session where user_id = ${step.userId}`);
          } else {
            await tx.execute(
              sql`update user_suspension set lifted_at = now() where user_id = ${step.userId} and lifted_at is null`,
            );
          }
          result = 'applied';
          break;
        }
        case 'enrollment': {
          target = `${step.courseId}:${step.userId}`;
          const [row] = rowsOf(
            await tx.execute(
              sql`select suspended_at from enrollment where user_id = ${step.userId} and course_id = ${step.courseId}::uuid for update`,
            ),
          );
          if (!row) return 'absent';
          if (step.suspended ? row.suspended_at !== null : row.suspended_at === null)
            return 'already';
          if (!run) return 'applied';
          await (step.suspended
            ? tx.execute(
                sql`update enrollment set suspended_at = now(), suspended_reason = 'restore_reapply', suspended_by = null where user_id = ${step.userId} and course_id = ${step.courseId}::uuid`,
              )
            : tx.execute(
                sql`update enrollment set suspended_at = null, suspended_reason = null, suspended_by = null where user_id = ${step.userId} and course_id = ${step.courseId}::uuid`,
              ));
          result = 'applied';
          break;
        }
      }
      await auditEvent(tx, {
        actorId: null,
        action: 'restore.revocation_reapplied',
        targetType:
          step.kind === 'account'
            ? 'user'
            : step.kind === 'enrollment'
              ? 'enrollment'
              : step.kind.split('.')[0]!,
        targetId: target,
        details: {
          step: step.kind,
          ...(step.kind === 'account' || step.kind === 'enrollment'
            ? { suspended: step.suspended }
            : {}),
        },
      });
      return result;
    });
    if (outcome === 'applied') summary.applied += 1;
    else if (outcome === 'already') summary.alreadyDone += 1;
    else summary.absent += 1;
  }
  return summary;
}
