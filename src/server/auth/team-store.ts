import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { staffGrant, user, userRole, userSuspension } from '../../db/schema';
import type { TeamMemberDto } from '../../features/identity/team';

/**
 * A equipe: toda pessoa com papel de Staff ATIVO (Suporte ou Admin), com papéis, grants ativos e
 * se está suspensa. Só o Admin chega aqui (rota com `staff.manage`). Sem papel ativo a pessoa não
 * aparece (quem saiu da equipe volta a ser só aluno).
 */
export async function listTeam(db: Database): Promise<TeamMemberDto[]> {
  const roles = await db
    .select({
      userId: userRole.userId,
      role: userRole.role,
      name: user.name,
      email: user.email,
    })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(isNull(userRole.revokedAt))
    .orderBy(asc(user.name));
  if (roles.length === 0) return [];
  const ids = [...new Set(roles.map((row) => row.userId))];
  const [grants, suspensions] = await Promise.all([
    db
      .select({ userId: staffGrant.userId, capability: staffGrant.capability })
      .from(staffGrant)
      .where(and(inArray(staffGrant.userId, ids), isNull(staffGrant.revokedAt)))
      .orderBy(asc(staffGrant.capability)),
    db
      .select({ userId: userSuspension.userId })
      .from(userSuspension)
      .where(and(inArray(userSuspension.userId, ids), isNull(userSuspension.liftedAt))),
  ]);
  const suspended = new Set(suspensions.map((row) => row.userId));
  const members = new Map<string, TeamMemberDto>();
  for (const row of roles) {
    const member = members.get(row.userId) ?? {
      id: row.userId,
      name: row.name,
      email: row.email,
      roles: [],
      grants: grants.filter((g) => g.userId === row.userId).map((g) => g.capability),
      suspended: suspended.has(row.userId),
    };
    member.roles.push(row.role as 'support' | 'admin');
    members.set(row.userId, member);
  }
  return [...members.values()];
}
