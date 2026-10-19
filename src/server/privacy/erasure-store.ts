import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  ERASURE_POLICY_VERSION,
  REMOVED_TEXT,
  anonymizedEmail,
  isAnonymizedEmail,
  type ErasureLogEntry,
} from '../../features/privacy/erasure-policy';
import { auditEvent } from '../auth/access-store';

/**
 * Exclusão de uma pessoa (M9-10), conforme a política de `features/privacy/erasure-policy.ts`. É chamada SÓ pelo script
 * `scripts/privacy/privacy-request.ts` (nunca por rota, Cron ou tela: não existe botão de exclusão). Tudo numa transação,
 * sob trava da linha da pessoa, e idempotente: repetir não muda nada. NÃO escreve nenhum dado pessoal na auditoria nem no
 * registro de eliminação (só o identificador interno e contagens).
 */
type ErasureCounts = Record<string, number>;

export type ErasureResult =
  | { outcome: 'not_found' | 'already_erased' | 'staff_account' }
  | { outcome: 'dry_run'; counts: ErasureCounts }
  | { outcome: 'erased'; counts: ErasureCounts; entry: ErasureLogEntry };

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}
const affected = (result: unknown): number => (result as { rowCount?: number }).rowCount ?? 0;
const count = (row: Record<string, unknown> | undefined, key: string): number =>
  Number(row?.[key] ?? 0);

/** O que a exclusão tocaria, sem tocar. As contagens usam as MESMAS condições dos comandos de `eraseUser`. */
async function countAffected(
  tx: Pick<Database, 'execute'>,
  userId: string,
): Promise<ErasureCounts> {
  const row = rowsOf(
    await tx.execute(sql`
      select
        (select count(*) from session where user_id = ${userId}) as sessions,
        (select count(*) from account where user_id = ${userId}) as accounts,
        (select count(*) from profile where user_id = ${userId}) as profile,
        (select count(*) from discussion_post where author_id = ${userId} and body <> ${REMOVED_TEXT}) as discussion_posts,
        (select count(*) from discussion_report where reporter_id = ${userId} and reason is not null and reason <> ${REMOVED_TEXT}) as discussion_reports,
        (select count(*) from support_request where user_id = ${userId} and message <> ${REMOVED_TEXT}) as support_requests,
        (select count(*) from course_interest where user_id = ${userId}) as course_interests,
        (select count(*) from offline_operation where user_id = ${userId}) as offline_operations`),
  )[0];
  return {
    sessions: count(row, 'sessions'),
    accounts: count(row, 'accounts'),
    profile: count(row, 'profile'),
    discussionPosts: count(row, 'discussion_posts'),
    discussionReports: count(row, 'discussion_reports'),
    supportRequests: count(row, 'support_requests'),
    courseInterests: count(row, 'course_interests'),
    offlineOperations: count(row, 'offline_operations'),
  };
}

/** Quem tem papel ou grant ATIVO da Staff não é excluído por aqui: a conta de Staff tem procedimento próprio. */
async function isStaff(tx: Pick<Database, 'execute'>, userId: string): Promise<boolean> {
  const row = rowsOf(
    await tx.execute(sql`
      select (select count(*) from user_role where user_id = ${userId} and revoked_at is null)
           + (select count(*) from staff_grant where user_id = ${userId} and revoked_at is null) as n`),
  )[0];
  return count(row, 'n') > 0;
}

export async function eraseUser(
  db: Database,
  userId: string,
  options: {
    execute: boolean;
    operatorId?: string | null;
    requestRef?: string | null;
    reapplied?: boolean;
  },
): Promise<ErasureResult> {
  return db.transaction(async (tx) => {
    const found = rowsOf(
      await tx.execute(sql`select id, email from "user" where id = ${userId} for update`),
    )[0];
    if (!found) return { outcome: 'not_found' };
    const email = String(found.email);
    if (isAnonymizedEmail(email)) return { outcome: 'already_erased' };
    if (await isStaff(tx, userId)) return { outcome: 'staff_account' };

    const counts = await countAffected(tx, userId);
    if (!options.execute) return { outcome: 'dry_run', counts };

    // Links de acesso pendentes que carregam o e-mail da pessoa (a tabela não tem chave estrangeira).
    const verifications = affected(
      await tx.execute(sql`
        delete from verification
         where lower(identifier) = lower(${email}) or position(lower(${email}) in lower(value)) > 0`),
    );
    await tx.execute(sql`delete from session where user_id = ${userId}`);
    await tx.execute(sql`delete from account where user_id = ${userId}`);
    await tx.execute(sql`delete from profile where user_id = ${userId}`);
    await tx.execute(sql`
      update discussion_report set reason = ${REMOVED_TEXT}
       where reporter_id = ${userId} and reason is not null and reason <> ${REMOVED_TEXT}`);
    await tx.execute(sql`
      update discussion_post set body = ${REMOVED_TEXT}
       where author_id = ${userId} and body <> ${REMOVED_TEXT}`);
    await tx.execute(sql`
      update support_request set message = ${REMOVED_TEXT}
       where user_id = ${userId} and message <> ${REMOVED_TEXT}`);
    await tx.execute(sql`
      delete from course_interest_notification
       where interest_id in (select id from course_interest where user_id = ${userId})`);
    await tx.execute(sql`delete from course_interest where user_id = ${userId}`);
    await tx.execute(sql`delete from offline_operation where user_id = ${userId}`);
    await tx.execute(sql`
      update "user"
         set name = ${REMOVED_TEXT}, email = ${anonymizedEmail(userId)}, image = null,
             email_verified = false, updated_at = now()
       where id = ${userId}`);

    const full: ErasureCounts = { ...counts, verifications };
    const erasedAt = String(rowsOf(await tx.execute(sql`select now() as at`))[0]?.at);
    const entry: ErasureLogEntry = {
      version: 1,
      userId,
      erasedAt: new Date(erasedAt).toISOString(),
      policyVersion: ERASURE_POLICY_VERSION,
      requestRef: options.requestRef ?? null,
      counts: full,
    };
    await auditEvent(tx, {
      actorId: options.operatorId ?? null,
      action: 'privacy.erasure',
      targetType: 'user',
      targetId: userId,
      details: {
        policyVersion: ERASURE_POLICY_VERSION,
        requestRef: entry.requestRef,
        counts: full,
        ...(options.reapplied ? { reapplied: true } : {}),
      },
    });
    return { outcome: 'erased', counts: full, entry };
  });
}

export interface ReapplySummary {
  reapplied: number;
  alreadyErased: number;
  absent: number;
  staffAccounts: number;
  dryRun: number;
}

/**
 * Depois de restaurar um backup ANTERIOR a uma exclusão, a pessoa "voltou". O registro de eliminações guardado FORA do
 * banco diz quem já foi excluído: esta função repete a exclusão de cada um. Quem não existe na cópia restaurada (nasceu
 * depois ou nunca esteve) é só contado.
 */
export async function reapplyErasures(
  db: Database,
  entries: readonly ErasureLogEntry[],
  options: { execute: boolean; operatorId?: string | null },
): Promise<ReapplySummary> {
  const summary: ReapplySummary = {
    reapplied: 0,
    alreadyErased: 0,
    absent: 0,
    staffAccounts: 0,
    dryRun: 0,
  };
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.userId)) continue;
    seen.add(entry.userId);
    const result = await eraseUser(db, entry.userId, {
      execute: options.execute,
      operatorId: options.operatorId ?? null,
      requestRef: entry.requestRef,
      reapplied: true,
    });
    if (result.outcome === 'erased') summary.reapplied += 1;
    else if (result.outcome === 'dry_run') summary.dryRun += 1;
    else if (result.outcome === 'already_erased') summary.alreadyErased += 1;
    else if (result.outcome === 'staff_account') summary.staffAccounts += 1;
    else summary.absent += 1;
  }
  return summary;
}
