import { z } from 'zod';

/**
 * Leitura da auditoria (M9-01, passo 3), só com `audit.view`. O registro já é gravado e é só de acréscimo (gatilho no banco); aqui se
 * lê, paginado por CURSOR (o `id` cresce com a gravação, então "mais antigos que o último visto" é estável mesmo com novas linhas).
 * Só IDs: a auditoria não guarda nome nem e-mail.
 */
const AUDIT_PAGE_SIZE = 25;
const AUDIT_MAX_PAGE_SIZE = 50;

export interface AuditEntryDto {
  id: string;
  at: string;
  /** `null` = ação do sistema. */
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
}

export interface AuditPageDto {
  items: AuditEntryDto[];
  /** Passe em `cursor` para a página seguinte; `null` = não há mais. */
  nextCursor: string | null;
}

/** Zod criado sob demanda (a CSP do navegador não aceita `new Function`; este esquema só roda no servidor, mas segue o padrão). */
export function auditQuerySchema() {
  return z.strictObject({
    limit: z.coerce.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).default(AUDIT_PAGE_SIZE),
    cursor: z
      .string()
      .regex(/^[0-9]{1,18}$/)
      .optional(),
    action: z.string().min(1).max(64).optional(),
    targetType: z.string().min(1).max(64).optional(),
    targetId: z.string().min(1).max(200).optional(),
  });
}
