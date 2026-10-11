import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { auditLog, session, staffGrant, user, userRole, userSuspension } from '../../db/schema';
import {
  isDelegable,
  type AccessContext,
  type DelegableCapability,
  type Role,
} from '../../features/identity/capabilities';

/** Tentou tirar o último Admin ativo (remoção, rebaixamento ou suspensão). */
export class LastAdminError extends Error {
  constructor() {
    super('last_admin');
  }
}
/** Capability inexistente ou exclusiva do Admin: não pode ser concedida por grant. */
export class NotDelegableError extends Error {
  constructor() {
    super('not_delegable');
  }
}
/** Grant só vale para quem tem o papel de Suporte. */
export class TargetNotSupportError extends Error {
  constructor() {
    super('target_not_support');
  }
}

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface Change {
  /** Quem fez a mudança. `null` = o sistema (ex.: criação do primeiro Admin pelo script de bootstrap). */
  actorId: string | null;
  targetId: string;
  /** Contexto extra da auditoria (ex.: `via: 'invitation'`). Nunca e-mail nem segredo. */
  details?: Record<string, unknown>;
}

/**
 * Carrega, do banco, quem a pessoa é: papéis ativos, grants ativos e suspensão. Roda a CADA
 * requisição protegida (sem cache), então revogar um grant ou suspender uma conta vale na
 * requisição seguinte, sem logout.
 */
export async function loadAccess(db: Database, userId: string): Promise<AccessContext> {
  const [roles, grants, suspensions] = await Promise.all([
    db
      .select({ role: userRole.role })
      .from(userRole)
      .where(and(eq(userRole.userId, userId), isNull(userRole.revokedAt))),
    db
      .select({ capability: staffGrant.capability })
      .from(staffGrant)
      .where(and(eq(staffGrant.userId, userId), isNull(staffGrant.revokedAt))),
    db
      .select({ id: userSuspension.id })
      .from(userSuspension)
      .where(and(eq(userSuspension.userId, userId), isNull(userSuspension.liftedAt))),
  ]);
  return {
    userId,
    suspended: suspensions.length > 0,
    roles: new Set(roles.map((row) => row.role as Role)),
    grants: new Set(
      grants.map((row) => row.capability).filter(isDelegable) as DelegableCapability[],
    ),
  };
}

/** A conta está suspensa agora? */
export async function isSuspended(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userSuspension.id })
    .from(userSuspension)
    .where(and(eq(userSuspension.userId, userId), isNull(userSuspension.liftedAt)))
    .limit(1);
  return rows.length > 0;
}

/** Esta pessoa tem papel de Staff ativo? (Staff só entra por link de acesso) */
export async function hasStaffRole(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userRole.id })
    .from(userRole)
    .where(and(eq(userRole.userId, userId), isNull(userRole.revokedAt)))
    .limit(1);
  return rows.length > 0;
}

/** Este e-mail pertence a alguém com papel de Staff ativo? (impede cadastro livre de Staff) */
export async function isStaffEmail(db: Database, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: userRole.id })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(and(eq(user.email, email), isNull(userRole.revokedAt)))
    .limit(1);
  return rows.length > 0;
}

/** Linha de auditoria na transação do chamador (append-only; só IDs e dados mínimos, sem e-mail). */
export async function auditEvent(
  tx: Tx,
  entry: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
  },
) {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: entry.details ?? {},
  });
}

async function audit(
  tx: Tx,
  entry: {
    actorId: string | null;
    action: string;
    targetId: string;
    details?: Record<string, unknown>;
  },
) {
  await auditEvent(tx, { ...entry, targetType: 'user' });
}

/** Mudança de papel, grant ou suspensão encerra as sessões da pessoa (ADR 0008). */
async function endSessions(tx: Tx, userId: string) {
  await tx.delete(session).where(eq(session.userId, userId));
}

/**
 * Trava as linhas de TODOS os papéis de Admin ativos (suspensos ou não) com FOR UPDATE e devolve os
 * IDs dos que estão ativos de fato (não suspensos). Duas operações que poderiam tirar os últimos
 * Admins se serializam aqui: a segunda espera, e só DEPOIS de obter a trava consulta as suspensões
 * numa instrução nova (em READ COMMITTED ela enxerga o que a primeira confirmou). Uma única
 * consulta com junção não serve: a releitura da trava não atualiza a outra tabela da junção, e um
 * Admin suspenso por uma operação concorrente ainda apareceria como ativo (achado dos testes).
 */
async function lockActiveAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ userId: userRole.userId })
    .from(userRole)
    .where(and(eq(userRole.role, 'admin'), isNull(userRole.revokedAt)))
    .for('update');
  const ids = rows.map((row) => row.userId);
  if (ids.length === 0) return [];
  const suspended = await tx
    .select({ userId: userSuspension.userId })
    .from(userSuspension)
    .where(and(inArray(userSuspension.userId, ids), isNull(userSuspension.liftedAt)));
  const suspendedIds = new Set(suspended.map((row) => row.userId));
  return ids.filter((id) => !suspendedIds.has(id));
}

/**
 * Concede o papel DENTRO da transação do chamador (convite e bootstrap compõem isto com outras
 * escritas). Devolve `false` se a pessoa já o tinha (nada muda, nada é auditado).
 */
export async function grantRoleIn(tx: Tx, change: Change & { role: Role }): Promise<boolean> {
  const [existing] = await tx
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, change.targetId),
        eq(userRole.role, change.role),
        isNull(userRole.revokedAt),
      ),
    );
  if (existing) return false;
  await tx
    .insert(userRole)
    .values({ userId: change.targetId, role: change.role, grantedBy: change.actorId });
  await audit(tx, {
    actorId: change.actorId,
    action: 'role.grant',
    targetId: change.targetId,
    details: { role: change.role, ...change.details },
  });
  await endSessions(tx, change.targetId);
  return true;
}

/** Concede o papel. Devolve `false` se a pessoa já o tinha (nada muda, nada é auditado). */
export async function grantRole(db: Database, change: Change & { role: Role }): Promise<boolean> {
  return db.transaction((tx) => grantRoleIn(tx, change));
}

/**
 * Retira o papel. Retirar `admin` do último Admin ativo é recusado (`LastAdminError`). Retirar
 * `support` também encerra os grants da pessoa (grant sem o papel seria letra morta e voltaria a
 * valer sozinho se o papel fosse devolvido).
 */
export async function revokeRole(db: Database, change: Change & { role: Role }): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (change.role === 'admin') {
      const admins = await lockActiveAdmins(tx);
      const isActiveAdmin = admins.includes(change.targetId);
      if (isActiveAdmin && admins.filter((id) => id !== change.targetId).length === 0) {
        throw new LastAdminError();
      }
    }
    const revoked = await tx
      .update(userRole)
      .set({ revokedAt: new Date(), revokedBy: change.actorId })
      .where(
        and(
          eq(userRole.userId, change.targetId),
          eq(userRole.role, change.role),
          isNull(userRole.revokedAt),
        ),
      )
      .returning({ id: userRole.id });
    if (revoked.length === 0) return false;
    await audit(tx, {
      actorId: change.actorId,
      action: 'role.revoke',
      targetId: change.targetId,
      details: { role: change.role },
    });
    if (change.role === 'support') {
      const dropped = await tx
        .update(staffGrant)
        .set({ revokedAt: new Date(), revokedBy: change.actorId })
        .where(and(eq(staffGrant.userId, change.targetId), isNull(staffGrant.revokedAt)))
        .returning({ capability: staffGrant.capability });
      for (const grant of dropped) {
        await audit(tx, {
          actorId: change.actorId,
          action: 'grant.revoke',
          targetId: change.targetId,
          details: { capability: grant.capability, reason: 'support_role_revoked' },
        });
      }
    }
    await endSessions(tx, change.targetId);
    return true;
  });
}

/** Concede uma capability delegável a quem é Suporte, na transação do chamador. */
export async function grantCapabilityIn(
  tx: Tx,
  change: Change & { capability: string },
): Promise<boolean> {
  if (!isDelegable(change.capability)) throw new NotDelegableError();
  const capability = change.capability;
  const [support] = await tx
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, change.targetId),
        eq(userRole.role, 'support'),
        isNull(userRole.revokedAt),
      ),
    );
  if (!support) throw new TargetNotSupportError();
  const [existing] = await tx
    .select({ id: staffGrant.id })
    .from(staffGrant)
    .where(
      and(
        eq(staffGrant.userId, change.targetId),
        eq(staffGrant.capability, capability),
        isNull(staffGrant.revokedAt),
      ),
    );
  if (existing) return false;
  await tx
    .insert(staffGrant)
    .values({ userId: change.targetId, capability, grantedBy: change.actorId });
  await audit(tx, {
    actorId: change.actorId,
    action: 'grant.add',
    targetId: change.targetId,
    details: { capability, ...change.details },
  });
  await endSessions(tx, change.targetId);
  return true;
}

/** Concede uma capability delegável a quem é Suporte. Só delegáveis: o banco também recusa. */
export async function grantCapability(
  db: Database,
  change: Change & { capability: string },
): Promise<boolean> {
  return db.transaction((tx) => grantCapabilityIn(tx, change));
}

export async function revokeCapability(
  db: Database,
  change: Change & { capability: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(staffGrant)
      .set({ revokedAt: new Date(), revokedBy: change.actorId })
      .where(
        and(
          eq(staffGrant.userId, change.targetId),
          eq(staffGrant.capability, change.capability),
          isNull(staffGrant.revokedAt),
        ),
      )
      .returning({ id: staffGrant.id });
    if (revoked.length === 0) return false;
    await audit(tx, {
      actorId: change.actorId,
      action: 'grant.revoke',
      targetId: change.targetId,
      details: { capability: change.capability },
    });
    await endSessions(tx, change.targetId);
    return true;
  });
}

/**
 * Suspende a conta (reversível). Suspender o último Admin ativo é recusado. A pessoa perde as
 * sessões e toda capability na requisição seguinte. A linha do usuário é travada (FOR UPDATE) antes
 * de tudo: um login em andamento (o gatilho `session_refuse_suspended` pega FOR KEY SHARE na mesma
 * linha) ou termina antes e a sessão é apagada aqui, ou espera e é recusado. Nenhuma sessão
 * sobrevive à suspensão.
 */
export async function suspendUser(
  db: Database,
  change: Change & { reason?: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, change.targetId)).for('update');
    const admins = await lockActiveAdmins(tx);
    if (
      admins.includes(change.targetId) &&
      admins.filter((id) => id !== change.targetId).length === 0
    ) {
      throw new LastAdminError();
    }
    const [already] = await tx
      .select({ id: userSuspension.id })
      .from(userSuspension)
      .where(and(eq(userSuspension.userId, change.targetId), isNull(userSuspension.liftedAt)));
    if (already) return false;
    await tx.insert(userSuspension).values({
      userId: change.targetId,
      suspendedBy: change.actorId,
      reason: change.reason?.slice(0, 200) ?? null,
    });
    await audit(tx, {
      actorId: change.actorId,
      action: 'account.suspend',
      targetId: change.targetId,
      details: change.reason ? { reason: change.reason.slice(0, 200) } : {},
    });
    await endSessions(tx, change.targetId);
    return true;
  });
}

export async function liftSuspension(db: Database, change: Change): Promise<boolean> {
  return db.transaction(async (tx) => {
    const lifted = await tx
      .update(userSuspension)
      .set({ liftedAt: new Date(), liftedBy: change.actorId })
      .where(and(eq(userSuspension.userId, change.targetId), isNull(userSuspension.liftedAt)))
      .returning({ id: userSuspension.id });
    if (lifted.length === 0) return false;
    await audit(tx, {
      actorId: change.actorId,
      action: 'account.reactivate',
      targetId: change.targetId,
    });
    return true;
  });
}
