import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { enrollment, entitlement, userSuspension } from '../../db/schema';
import {
  addCalendarMonths,
  decideAccess,
  effectiveExpiry,
  type AccessResult,
} from '../../features/access/access';
import { auditEvent } from '../auth/access-store';
import { markInterestConvertedIn } from '../interest/conversion';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

type GrantSource = 'free_offer' | 'purchase' | 'admin_grant';

export class EntitlementNotFoundError extends Error {
  constructor() {
    super('entitlement_not_found');
  }
}

/** A mesma `source_ref` já existe para OUTRA pessoa ou OUTRO curso: nunca devolva o direito alheio. */
export class SourceRefConflictError extends Error {
  constructor() {
    super('source_ref_conflict');
  }
}

export interface GrantInput {
  userId: string;
  courseId: string;
  /** `null` só na matrícula manual (`admin_grant`); o banco exige a oferta nas demais origens. */
  offerId: string | null;
  source: GrantSource;
  /** Idempotência: único por `source` (ex.: id do pedido; chave por pessoa e curso na gratuita). */
  sourceRef: string;
  /** Prazo em meses de calendário (1 a 600). Quem chama lê da oferta; aqui só se valida. */
  accessMonths: number;
  /** Início do direito (o `agora` de quem chama). Na primeira concessão também vira a ÂNCORA do drip. */
  startsAt: Date;
  grantedBy: string | null;
  /** Motivo (matrícula manual): vai para a auditoria. */
  reason?: string;
}

export interface GrantResult {
  entitlementId: string;
  /** `false`: a `source_ref` já tinha direito (repetição idempotente); nada novo foi gravado. */
  created: boolean;
  anchorAt: Date;
  effectiveExpiresAt: Date | null;
}

/** Recalcula `effective_expires_at` (maior expiração dos não revogados) NA transação de quem mudou. */
export async function recompute(tx: Tx, userId: string, courseId: string): Promise<Date | null> {
  const rows = await tx
    .select({
      startsAt: entitlement.startsAt,
      expiresAt: entitlement.expiresAt,
      revokedAt: entitlement.revokedAt,
    })
    .from(entitlement)
    .where(and(eq(entitlement.userId, userId), eq(entitlement.courseId, courseId)));
  const effective = effectiveExpiry(rows);
  await tx
    .update(enrollment)
    .set({ effectiveExpiresAt: effective })
    .where(and(eq(enrollment.userId, userId), eq(enrollment.courseId, courseId)));
  return effective;
}

/**
 * Garante a linha da matrícula e a TRAVA para a transação (`INSERT ... ON CONFLICT DO NOTHING` e
 * `SELECT ... FOR UPDATE`). A âncora só é definida aqui na primeira vez (`anchorAt`) e nunca muda.
 */
export async function lockEnrollmentIn(
  tx: Tx,
  userId: string,
  courseId: string,
  anchorAt: Date,
): Promise<{ anchorAt: Date; suspendedAt: Date | null }> {
  await tx.insert(enrollment).values({ userId, courseId, anchorAt }).onConflictDoNothing();
  const [locked] = await tx
    .select({ anchorAt: enrollment.anchorAt, suspendedAt: enrollment.suspendedAt })
    .from(enrollment)
    .where(and(eq(enrollment.userId, userId), eq(enrollment.courseId, courseId)))
    .for('update');
  return locked!;
}

/**
 * Concede um direito DENTRO de uma transação já aberta (para compor com a compra no M6 e a inscrição
 * no M3-02). Concessões simultâneas se serializam pela linha da matrícula: `INSERT ... ON CONFLICT DO
 * NOTHING` garante UMA linha e UMA âncora; o `SELECT ... FOR UPDATE` põe as demais na fila. A mesma
 * `source_ref` é idempotente. A matrícula e a âncora nascem na primeira concessão e nunca mais mudam,
 * então conceder de novo depois de expirar continua o drip e o progresso.
 */
export async function grantEntitlementIn(tx: Tx, input: GrantInput): Promise<GrantResult> {
  const expiresAt = addCalendarMonths(input.startsAt, input.accessMonths);
  const locked = await lockEnrollmentIn(tx, input.userId, input.courseId, input.startsAt);

  const inserted = await tx
    .insert(entitlement)
    .values({
      userId: input.userId,
      courseId: input.courseId,
      offerId: input.offerId,
      source: input.source,
      sourceRef: input.sourceRef,
      startsAt: input.startsAt,
      expiresAt,
      grantedBy: input.grantedBy,
    })
    .onConflictDoNothing({ target: [entitlement.source, entitlement.sourceRef] })
    .returning({ id: entitlement.id });

  let entitlementId = inserted[0]?.id;
  const created = entitlementId !== undefined;
  if (entitlementId === undefined) {
    const [existing] = await tx
      .select({
        id: entitlement.id,
        userId: entitlement.userId,
        courseId: entitlement.courseId,
      })
      .from(entitlement)
      .where(and(eq(entitlement.source, input.source), eq(entitlement.sourceRef, input.sourceRef)));
    if (!existing || existing.userId !== input.userId || existing.courseId !== input.courseId) {
      throw new SourceRefConflictError();
    }
    entitlementId = existing.id;
  }

  const effectiveExpiresAt = await recompute(tx, input.userId, input.courseId);
  // M5-06: com direito efetivo, o interesse em ser avisada deixa de valer (vira `converted`).
  await markInterestConvertedIn(tx, input.userId, input.courseId);
  if (created) {
    await auditEvent(tx, {
      actorId: input.grantedBy,
      action: 'entitlement.grant',
      targetType: 'entitlement',
      targetId: entitlementId,
      details: {
        userId: input.userId,
        courseId: input.courseId,
        offerId: input.offerId,
        source: input.source,
        accessMonths: input.accessMonths,
        expiresAt: expiresAt.toISOString(),
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });
  }
  return { entitlementId, created, anchorAt: locked!.anchorAt, effectiveExpiresAt };
}

export function grantEntitlement(db: Database, input: GrantInput): Promise<GrantResult> {
  return db.transaction((tx) => grantEntitlementIn(tx, input));
}

/**
 * Revoga um direito (definitivo; o gatilho impede desfazer) e recalcula a matrícula na mesma
 * transação. Revogar de novo o que já está revogado é um no-op (`revoked: false`). Não apaga nada.
 */
export async function revokeEntitlementIn(
  tx: Tx,
  input: { entitlementId: string; reason: string; actorId: string | null; now: Date },
): Promise<{ revoked: boolean }> {
  const [row] = await tx
    .select({ userId: entitlement.userId, courseId: entitlement.courseId })
    .from(entitlement)
    .where(eq(entitlement.id, input.entitlementId));
  if (!row) throw new EntitlementNotFoundError();
  await tx
    .select({ userId: enrollment.userId })
    .from(enrollment)
    .where(and(eq(enrollment.userId, row.userId), eq(enrollment.courseId, row.courseId)))
    .for('update');
  const updated = await tx
    .update(entitlement)
    .set({ revokedAt: input.now, revokedReason: input.reason, revokedBy: input.actorId })
    .where(and(eq(entitlement.id, input.entitlementId), isNull(entitlement.revokedAt)))
    .returning({ id: entitlement.id });
  if (updated.length === 0) return { revoked: false };
  await recompute(tx, row.userId, row.courseId);
  await auditEvent(tx, {
    actorId: input.actorId,
    action: 'entitlement.revoke',
    targetType: 'entitlement',
    targetId: input.entitlementId,
    details: { userId: row.userId, courseId: row.courseId, reason: input.reason },
  });
  return { revoked: true };
}

export async function revokeEntitlement(
  db: Database,
  input: { entitlementId: string; reason: string; actorId: string | null; now: Date },
): Promise<{ revoked: boolean }> {
  return db.transaction((tx) => revokeEntitlementIn(tx, input));
}

/**
 * A decisão de acesso DENTRO de uma transação já aberta: lê a matrícula, os direitos e a suspensão da
 * conta e entrega à função pura. É a mesma decisão de `resolveAccess`; existe para quem precisa
 * decidir e escrever na MESMA transação (ex.: concluir uma aula, M3-04).
 */
export async function resolveAccessIn(
  tx: Tx,
  userId: string,
  courseId: string,
  now: Date,
): Promise<AccessResult> {
  const [suspension] = await tx
    .select({ id: userSuspension.id })
    .from(userSuspension)
    .where(and(eq(userSuspension.userId, userId), isNull(userSuspension.liftedAt)))
    .limit(1);
  const [row] = await tx
    .select({ anchorAt: enrollment.anchorAt, suspendedAt: enrollment.suspendedAt })
    .from(enrollment)
    .where(and(eq(enrollment.userId, userId), eq(enrollment.courseId, courseId)));
  const rows = row
    ? await tx
        .select({
          startsAt: entitlement.startsAt,
          expiresAt: entitlement.expiresAt,
          revokedAt: entitlement.revokedAt,
        })
        .from(entitlement)
        .where(and(eq(entitlement.userId, userId), eq(entitlement.courseId, courseId)))
    : [];
  return decideAccess({
    enrollment: row ?? null,
    accountSuspended: suspension !== undefined,
    entitlements: rows,
    now,
  });
}

/**
 * A ÚNICA decisão de acesso do servidor: lê a matrícula, os direitos e a suspensão da conta numa
 * leitura consistente e entrega à função pura. `agora` vem de quem chama; a expiração é avaliada a
 * cada chamada, sem tarefa agendada. A interface só reflete este resultado.
 */
export async function resolveAccess(
  db: Database,
  userId: string,
  courseId: string,
  now: Date,
): Promise<AccessResult> {
  return db.transaction((tx) => resolveAccessIn(tx, userId, courseId, now), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}
