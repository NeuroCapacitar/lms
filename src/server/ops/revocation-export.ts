import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  revocationLogKey,
  type RevocationAction,
  type RevocationLogEntry,
} from '../../features/ops/revocation-log';
import type { ObjectStorage } from '../media/storage';

/**
 * Exporta o diário de revogações para o R2 privado (M9-05, ADR 0034): um objeto por ação em `revocation-log/`, que
 * sobrevive a uma restauração do banco. Idempotente e repetível em qualquer ponto: o PUT do mesmo objeto sobrescreve o
 * mesmo conteúdo, e só DEPOIS do PUT a linha ganha `exported_at`. Falha do R2 numa linha deixa as outras seguirem e a
 * linha fica para o ciclo seguinte. Nada de motivo, nota, nome ou e-mail no objeto.
 */
const BATCH_LIMIT = 100;

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/** Há algo a exportar? (sonda barata do Cron: sem trabalho o job nem assume o lease) */
export async function hasPendingRevocationExport(db: Database): Promise<boolean> {
  return (
    rowsOf(
      await db.execute(
        sql`select 1 as due from revocation_journal where exported_at is null limit 1`,
      ),
    ).length > 0
  );
}

export async function exportRevocations(
  db: Database,
  storage: ObjectStorage,
): Promise<{ exported: number; failed: number }> {
  const pending = rowsOf(
    await db.execute(sql`
      select id::text as id, audit_id::int as audit_id, action, target_id, user_id, course_id::text as course_id,
             category, occurred_at
        from revocation_journal
       where exported_at is null
       order by audit_id
       limit ${BATCH_LIMIT}`),
  );
  const result = { exported: 0, failed: 0 };
  for (const row of pending) {
    const entry: RevocationLogEntry = {
      version: 1,
      auditId: row.audit_id as number,
      action: row.action as RevocationAction,
      targetId: row.target_id as string,
      userId: (row.user_id as string | null) ?? null,
      courseId: (row.course_id as string | null) ?? null,
      category: (row.category as string | null) ?? null,
      occurredAt: new Date(row.occurred_at as Date | string).toISOString(),
    };
    const key = revocationLogKey(entry);
    try {
      await storage.put(
        'private',
        key,
        new TextEncoder().encode(JSON.stringify(entry)),
        'application/json',
      );
      await db.execute(sql`
        update revocation_journal set exported_at = now(), export_key = ${key}
         where id = ${row.id as string}::uuid and exported_at is null`);
      result.exported += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
