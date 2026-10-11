import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  staffInvitation,
  staffInvitationGrant,
  user,
  userRole,
  userSuspension,
} from '../../db/schema';
import {
  INVITATION_TTL_SECONDS,
  type InvitationDto,
  type InvitationStatus,
} from '../../features/identity/staff-invitation';
import { normalizeEmail } from '../../features/identity/email';
import { sha256Hex } from '../crypto';
import { auditEvent, grantCapabilityIn, grantRoleIn, type Tx } from './access-store';
import { randomToken } from './token';

/** Já existe uma pessoa com papel de Staff ativo neste e-mail. */
export class AlreadyStaffError extends Error {
  constructor() {
    super('already_staff');
  }
}
/** Já existe um convite pendente para este e-mail (reenvie ou revogue o anterior). */
export class AlreadyInvitedError extends Error {
  constructor() {
    super('already_invited');
  }
}

const expiryFromNow = () => new Date(Date.now() + INVITATION_TTL_SECONDS * 1000);

/** Violação de índice único do Postgres (convite pendente concorrente para o mesmo e-mail). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function hasActiveStaffRole(tx: Tx, email: string): Promise<boolean> {
  const rows = await tx
    .select({ id: userRole.id })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(and(eq(user.email, email), isNull(userRole.revokedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Cria o convite: grava o hash do token, os grants iniciais e a auditoria na mesma transação.
 * Devolve o token em texto (só para o e-mail; nunca é guardado). A auditoria não guarda o e-mail.
 */
export async function createInvitation(
  db: Database,
  input: { actorId: string; email: string; grants: readonly string[] },
): Promise<{ id: string; token: string }> {
  const email = normalizeEmail(input.email);
  const token = randomToken();
  try {
    return await db.transaction(async (tx) => {
      if (await hasActiveStaffRole(tx, email)) throw new AlreadyStaffError();
      const [pending] = await tx
        .select({ id: staffInvitation.id })
        .from(staffInvitation)
        .where(and(eq(staffInvitation.email, email), eq(staffInvitation.status, 'pending')));
      if (pending) throw new AlreadyInvitedError();
      const [created] = await tx
        .insert(staffInvitation)
        .values({
          email,
          tokenHash: await sha256Hex(token),
          expiresAt: expiryFromNow(),
          invitedBy: input.actorId,
        })
        .returning({ id: staffInvitation.id });
      const id = created!.id;
      if (input.grants.length > 0) {
        await tx
          .insert(staffInvitationGrant)
          .values(input.grants.map((capability) => ({ invitationId: id, capability })));
      }
      await auditEvent(tx, {
        actorId: input.actorId,
        action: 'staff_invitation.create',
        targetType: 'staff_invitation',
        targetId: id,
        details: { role: 'support', grants: [...input.grants] },
      });
      return { id, token };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AlreadyInvitedError();
    throw error;
  }
}

/**
 * Reenvia: gera um token NOVO e estende a validade; o link anterior deixa de valer. Só convite
 * pendente (vencido pode ser reenviado). Devolve `null` se não existe ou não está pendente. O
 * e-mail do destinatário volta junto para o envio.
 */
export async function resendInvitation(
  db: Database,
  input: { actorId: string; id: string },
): Promise<{ token: string; email: string } | null> {
  const token = randomToken();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: staffInvitation.id, email: staffInvitation.email })
      .from(staffInvitation)
      .where(and(eq(staffInvitation.id, input.id), eq(staffInvitation.status, 'pending')))
      .for('update');
    if (!row) return null;
    // A pessoa pode ter virado Staff por outro caminho desde o convite.
    if (await hasActiveStaffRole(tx, row.email)) throw new AlreadyStaffError();
    await tx
      .update(staffInvitation)
      .set({
        tokenHash: await sha256Hex(token),
        expiresAt: expiryFromNow(),
        lastSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(staffInvitation.id, row.id));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'staff_invitation.resend',
      targetType: 'staff_invitation',
      targetId: row.id,
    });
    return { token, email: row.email };
  });
}

/** Revoga um convite pendente. `false` se não existe ou já foi aceito, revogado ou substituído. */
export async function revokeInvitation(
  db: Database,
  input: { actorId: string; id: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(staffInvitation)
      .set({
        status: 'revoked',
        revokedBy: input.actorId,
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(staffInvitation.id, input.id), eq(staffInvitation.status, 'pending')))
      .returning({ id: staffInvitation.id });
    if (revoked.length === 0) return false;
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'staff_invitation.revoke',
      targetType: 'staff_invitation',
      targetId: input.id,
    });
    return true;
  });
}

/** Lista os convites (mais novos primeiro) com o estado efetivo. O token nunca é devolvido. */
export async function listInvitations(db: Database): Promise<InvitationDto[]> {
  const rows = await db
    .select({
      id: staffInvitation.id,
      email: staffInvitation.email,
      status: staffInvitation.status,
      expiresAt: staffInvitation.expiresAt,
      createdAt: staffInvitation.createdAt,
      expired: sql<boolean>`${staffInvitation.expiresAt} <= now()`,
    })
    .from(staffInvitation)
    .orderBy(desc(staffInvitation.createdAt))
    .limit(200);
  const ids = rows.map((row) => row.id);
  const grants = ids.length
    ? await db
        .select({
          invitationId: staffInvitationGrant.invitationId,
          capability: staffInvitationGrant.capability,
        })
        .from(staffInvitationGrant)
        .where(inArray(staffInvitationGrant.invitationId, ids))
        .orderBy(asc(staffInvitationGrant.capability))
    : [];
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status === 'pending' && row.expired ? 'expired' : (row.status as InvitationStatus),
    grants: grants.filter((g) => g.invitationId === row.id).map((g) => g.capability),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export type AcceptResult = 'accepted' | 'invalid' | 'suspended' | 'unverified';

/** Quem convidou ainda é Admin ativo? Convite de quem perdeu o papel ou foi suspenso não vale. */
async function inviterStillAdmin(tx: Tx, inviterId: string | null): Promise<boolean> {
  if (!inviterId) return false;
  const [admin] = await tx
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      and(eq(userRole.userId, inviterId), eq(userRole.role, 'admin'), isNull(userRole.revokedAt)),
    );
  if (!admin) return false;
  const [suspension] = await tx
    .select({ id: userSuspension.id })
    .from(userSuspension)
    .where(and(eq(userSuspension.userId, inviterId), isNull(userSuspension.liftedAt)));
  return !suspension;
}

/**
 * Aceita o convite na sessão da própria pessoa. Tudo numa transação: trava o convite, confere que
 * está pendente e vigente, que o e-mail da SESSÃO é o do convite, que quem convidou segue Admin
 * ativo e que a conta não está suspensa; então marca aceito, concede o papel de Suporte e os grants
 * iniciais e audita. Token errado, usado, revogado, vencido, substituído ou de outro e-mail: o
 * mesmo `invalid`, sem dizer qual (não vira oráculo). O papel concedido encerra as sessões da
 * pessoa (ADR 0008): ela volta a entrar por link e passa a ver o que o Suporte vê.
 */
export async function acceptInvitation(
  db: Database,
  input: { token: string; userId: string },
): Promise<AcceptResult> {
  const tokenHash = await sha256Hex(input.token);
  return db.transaction(async (tx) => {
    const [person] = await tx
      .select({ email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, input.userId));
    if (!person) return 'invalid';
    if (!person.emailVerified) return 'unverified';
    const [suspension] = await tx
      .select({ id: userSuspension.id })
      .from(userSuspension)
      .where(and(eq(userSuspension.userId, input.userId), isNull(userSuspension.liftedAt)));
    if (suspension) return 'suspended';

    const [invitation] = await tx
      .select()
      .from(staffInvitation)
      .where(eq(staffInvitation.tokenHash, tokenHash))
      .for('update');
    if (
      !invitation ||
      invitation.status !== 'pending' ||
      invitation.expiresAt.getTime() <= Date.now() ||
      invitation.email !== normalizeEmail(person.email) ||
      !(await inviterStillAdmin(tx, invitation.invitedBy))
    ) {
      return 'invalid';
    }

    const grants = await tx
      .select({ capability: staffInvitationGrant.capability })
      .from(staffInvitationGrant)
      .where(eq(staffInvitationGrant.invitationId, invitation.id));
    await tx
      .update(staffInvitation)
      .set({
        status: 'accepted',
        acceptedBy: input.userId,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(staffInvitation.id, invitation.id), eq(staffInvitation.status, 'pending')));
    const via = { via: 'invitation', invitationId: invitation.id };
    await grantRoleIn(tx, {
      actorId: invitation.invitedBy,
      targetId: input.userId,
      role: 'support',
      details: via,
    });
    for (const { capability } of grants) {
      await grantCapabilityIn(tx, {
        actorId: invitation.invitedBy,
        targetId: input.userId,
        capability,
        details: via,
      });
    }
    await auditEvent(tx, {
      actorId: input.userId,
      action: 'staff_invitation.accept',
      targetType: 'staff_invitation',
      targetId: invitation.id,
      details: { grants: grants.map((g) => g.capability) },
    });
    return 'accepted';
  });
}
