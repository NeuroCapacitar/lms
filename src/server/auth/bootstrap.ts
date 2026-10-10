import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { user, userRole } from '../../db/schema';
import { normalizeEmail } from '../../features/identity/email';
import { grantRoleIn } from './access-store';

/** Já existe um Admin (ativo ou não): o bootstrap só serve para o PRIMEIRO. */
export class AdminAlreadyExistsError extends Error {
  constructor() {
    super('admin_already_exists');
  }
}

/**
 * Cria o primeiro Admin, sem senha nem segredo no código: grava (ou reaproveita) a pessoa pelo
 * e-mail, concede o papel `admin` e audita (ator `null` = sistema). Recusa se já houver um Admin.
 * A pessoa entra depois por link de acesso (Staff só entra por link) e o e-mail é confirmado por
 * esse primeiro login, não pelo script.
 *
 * Execução manual, só em Development e Staging neste marco (a trava está no script). O
 * `SHARE ROW EXCLUSIVE` na tabela de papéis serializa dois bootstraps simultâneos (sem advisory
 * lock): o segundo espera e então enxerga o Admin criado pelo primeiro.
 */
export async function bootstrapAdmin(
  db: Database,
  rawEmail: string,
): Promise<{ userId: string; createdUser: boolean }> {
  const email = normalizeEmail(rawEmail);
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table user_role in share row exclusive mode`);
    const [anyAdmin] = await tx
      .select({ id: userRole.id })
      .from(userRole)
      .where(eq(userRole.role, 'admin'))
      .limit(1);
    if (anyAdmin) throw new AdminAlreadyExistsError();

    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    let userId = existing?.id;
    const createdUser = !existing;
    if (!userId) {
      userId = crypto.randomUUID();
      // O perfil nasce junto, pelo gatilho do banco (migration 0003). O nome é o trecho antes da @.
      await tx.insert(user).values({
        id: userId,
        email,
        name: email.split('@')[0] || 'Admin',
        emailVerified: false,
      });
    }
    await grantRoleIn(tx, {
      actorId: null,
      targetId: userId,
      role: 'admin',
      details: { via: 'bootstrap' },
    });
    return { userId, createdUser };
  });
}

/** Já existe algum Admin (ativo ou não)? Usado pelo script para avisar antes de aplicar. */
export async function adminExists(db: Database): Promise<boolean> {
  const rows = await db
    .select({ id: userRole.id })
    .from(userRole)
    .where(eq(userRole.role, 'admin'))
    .limit(1);
  return rows.length > 0;
}
