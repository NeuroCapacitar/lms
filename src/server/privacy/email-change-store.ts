import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../../db/client';
import { isAnonymizedEmail } from '../../features/privacy/erasure-policy';
import { auditEvent } from '../auth/access-store';

/**
 * Troca de e-mail de uma pessoa (M9-10), só pelo script, depois de a Staff confirmar os DOIS endereços (o antigo e o
 * novo) fora do sistema. O e-mail novo precisa ser único (sem diferenciar maiúsculas); as sessões e os links de acesso
 * pendentes do e-mail antigo são apagados. A auditoria diz QUE houve troca, nunca os endereços.
 */
export type EmailChangeResult =
  | {
      outcome:
        | 'invalid_email'
        | 'not_found'
        | 'anonymized'
        | 'staff_account'
        | 'same_email'
        | 'email_in_use';
    }
  | { outcome: 'dry_run' | 'changed' };

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

export async function changeUserEmail(
  db: Database,
  userId: string,
  newEmailRaw: string,
  options: { execute: boolean; operatorId?: string | null; requestRef?: string | null },
): Promise<EmailChangeResult> {
  const parsed = z.email().safeParse(newEmailRaw.trim());
  if (!parsed.success) return { outcome: 'invalid_email' };
  const newEmail = parsed.data.toLowerCase();

  return db.transaction(async (tx) => {
    const found = rowsOf(
      await tx.execute(sql`select id, email from "user" where id = ${userId} for update`),
    )[0];
    if (!found) return { outcome: 'not_found' };
    const oldEmail = String(found.email);
    if (isAnonymizedEmail(oldEmail)) return { outcome: 'anonymized' };
    const staff = rowsOf(
      await tx.execute(sql`
        select (select count(*) from user_role where user_id = ${userId} and revoked_at is null)
             + (select count(*) from staff_grant where user_id = ${userId} and revoked_at is null) as n`),
    )[0];
    if (Number(staff?.n ?? 0) > 0) return { outcome: 'staff_account' };
    if (oldEmail.toLowerCase() === newEmail) return { outcome: 'same_email' };
    const taken = rowsOf(
      await tx.execute(
        sql`select 1 from "user" where lower(email) = ${newEmail} and id <> ${userId} limit 1`,
      ),
    );
    if (taken.length > 0) return { outcome: 'email_in_use' };
    if (!options.execute) return { outcome: 'dry_run' };

    await tx.execute(sql`
      delete from verification
       where lower(identifier) = lower(${oldEmail}) or position(lower(${oldEmail}) in lower(value)) > 0`);
    await tx.execute(sql`delete from session where user_id = ${userId}`);
    // As duas confirmações (endereço antigo e novo) foram feitas pela Staff antes de chamar: o endereço novo já é verificado.
    await tx.execute(sql`
      update "user" set email = ${newEmail}, email_verified = true, updated_at = now() where id = ${userId}`);
    await auditEvent(tx, {
      actorId: options.operatorId ?? null,
      action: 'privacy.email_change',
      targetType: 'user',
      targetId: userId,
      details: { requestRef: options.requestRef ?? null },
    });
    return { outcome: 'changed' };
  });
}
