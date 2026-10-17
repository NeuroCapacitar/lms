import { and, desc, eq, lt } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { auditLog } from '../../db/schema';
import type { AuditPageDto } from '../../features/staff/audit';

/**
 * Uma página da auditoria, do mais novo para o mais antigo, por cursor (`id < cursor`). Busca UMA linha a mais só para saber se há
 * próxima página. Só leitura: a tabela é de acréscimo e nenhum caminho daqui a altera.
 */
export async function readAuditPage(
  db: Database,
  query: {
    limit: number;
    cursor?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
  },
): Promise<AuditPageDto> {
  const filters = [
    query.cursor !== undefined ? lt(auditLog.id, Number(query.cursor)) : undefined,
    query.action !== undefined ? eq(auditLog.action, query.action) : undefined,
    query.targetType !== undefined ? eq(auditLog.targetType, query.targetType) : undefined,
    query.targetId !== undefined ? eq(auditLog.targetId, query.targetId) : undefined,
  ].filter((filter) => filter !== undefined);

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...filters))
    .orderBy(desc(auditLog.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  return {
    items: page.map((row) => ({
      id: String(row.id),
      at: row.at.toISOString(),
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      details: (row.details ?? {}) as Record<string, unknown>,
    })),
    nextCursor: rows.length > query.limit ? String(page[page.length - 1]!.id) : null,
  };
}
