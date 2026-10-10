import { eq } from 'drizzle-orm';

import type { ProfileDto, ProfilePatch, Theme } from '../../features/identity/profile';
import type { Database } from '../../db/client';
import { profile } from '../../db/schema';

function toDto(row: typeof profile.$inferSelect): ProfileDto {
  return {
    displayName: row.displayName,
    certificateName: row.certificateName,
    certificateNameConfirmed: row.certificateNameConfirmedAt !== null,
    theme: row.theme as Theme,
    autoAdvance: row.autoAdvance,
  };
}

/** `undefined` só se o perfil não existir (o gatilho do banco o cria junto do usuário). */
export async function getProfile(db: Database, userId: string): Promise<ProfileDto | undefined> {
  const [row] = await db.select().from(profile).where(eq(profile.userId, userId));
  return row ? toDto(row) : undefined;
}

/**
 * Atualiza só os campos informados do perfil DO PRÓPRIO usuário (o ID vem da sessão, nunca do
 * corpo). Trocar o nome do certificado zera a confirmação. O nome de exibição e o do certificado
 * não alteram nenhum dado histórico: snapshots guardam a sua própria cópia.
 */
export async function updateProfile(
  db: Database,
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileDto | undefined> {
  const [row] = await db
    .update(profile)
    .set({
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.certificateName !== undefined
        ? { certificateName: patch.certificateName, certificateNameConfirmedAt: null }
        : {}),
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
      ...(patch.autoAdvance !== undefined ? { autoAdvance: patch.autoAdvance } : {}),
      updatedAt: new Date(),
    })
    .where(eq(profile.userId, userId))
    .returning();
  return row ? toDto(row) : undefined;
}
