import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  PURGE_BATCH_LIMIT,
  SCRUBBED_HOLDER_NAME,
  purgeLogKey,
  type PurgeLogEntry,
} from '../../features/certificate/retention';
import { auditEvent } from '../auth/access-store';
import { sha256Hex } from '../crypto';
import type { ObjectStorage } from '../media/storage';

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

const dueClause = (days: number) =>
  sql`status = 'revoked' and pdf_key is not null and pdf_purged_at is null
      and revoked_at <= now() - (${days}::int * interval '1 day')`;

/** Há certificado revogado com PDF e prazo vencido? (sonda barata do Cron: sem trabalho o job nem assume o lease) */
export async function hasDueRevokedPdf(db: Database, days: number): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`select 1 as due from certificate where ${dueClause(days)} limit 1`),
  );
  return rows.length > 0;
}

export interface PurgeResult {
  purged: number;
  failed: number;
}

/**
 * Elimina o PDF dos certificados REVOGADOS cujo prazo venceu (M7-05). O prazo é contado no relógio do BANCO (UTC), a partir de `revoked_at`.
 * Por certificado, nesta ordem, e repetível em qualquer ponto:
 *   1. apaga o objeto no R2 (apagar o que já não existe não é erro), FORA de transação;
 *   2. grava o registro durável da eliminação no R2 (sem nome, só o hash do código), que sobrevive a uma restauração do banco;
 *   3. numa transação: tira `pdf_key`, marca `pdf_purged_at`, troca o nome do titular por "[removido]" no snapshot e apaga a nota
 *      interna da revogação, e audita. O TOMBSTONE fica (código, estado, `revoked_at` e o SHA-256 do PDF).
 * Falha do R2 num certificado não impede os outros: ele fica para o ciclo seguinte. Certificado válido, substituído ou reemitido nunca entra
 * (só `revoked`, e o novo é outra linha). Restaurar um dump anterior à purga reexecuta tudo sem erro.
 */
export async function purgeRevokedPdfs(
  db: Database,
  storage: ObjectStorage,
  options: { days: number; limit?: number },
): Promise<PurgeResult> {
  const due = rowsOf(
    await db.execute(sql`
      select id::text as id, code, pdf_key, pdf_sha256, revoked_at
        from certificate
       where ${dueClause(options.days)}
       order by revoked_at
       limit ${options.limit ?? PURGE_BATCH_LIMIT}`),
  );

  const result: PurgeResult = { purged: 0, failed: 0 };
  for (const row of due) {
    const id = row.id as string;
    const key = row.pdf_key as string;
    try {
      await storage.delete('private', key);
      const entry: PurgeLogEntry = {
        certificateId: id,
        codeSha256: await sha256Hex(row.code as string),
        pdfSha256: row.pdf_sha256 as string,
        revokedAt: new Date(row.revoked_at as Date | string).toISOString(),
        purgedAt: new Date().toISOString(),
        retentionDays: options.days,
        objectKey: key,
      };
      await storage.put(
        'private',
        purgeLogKey(id),
        new TextEncoder().encode(JSON.stringify(entry)),
        'application/json',
      );
      const done = await db.transaction(async (tx) => {
        const updated = rowsOf(
          await tx.execute(sql`
            update certificate
               set pdf_key = null,
                   pdf_purged_at = now(),
                   snapshot = jsonb_set(snapshot, '{holderName}', to_jsonb(${SCRUBBED_HOLDER_NAME}::text)),
                   revocation_note = null
             where id = ${id}::uuid and pdf_key = ${key} and ${dueClause(options.days)}
         returning id`),
        );
        if (updated.length === 0) return false;
        await auditEvent(tx, {
          actorId: null,
          action: 'certificate.pdf_purged',
          targetType: 'certificate',
          targetId: id,
          details: { retentionDays: options.days },
        });
        return true;
      });
      if (done) result.purged += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
