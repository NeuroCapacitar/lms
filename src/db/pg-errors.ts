/** O que interessa de um erro do `pg`, mesmo embrulhado em `cause` (o Drizzle embrulha). */
interface PgErrorInfo {
  code?: string;
  constraint?: string;
  message?: string;
}

function pgError(error: unknown): PgErrorInfo {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const candidate = current as PgErrorInfo;
    if (candidate.code) return candidate;
    current = (current as { cause?: unknown }).cause;
  }
  return {};
}

/** 23505: violação de índice ou restrição única. */
export const isUniqueViolation = (error: unknown): boolean => pgError(error).code === '23505';

/** 23514: violação de CHECK. */
export const isCheckViolation = (error: unknown): boolean => pgError(error).code === '23514';

/** 23001: `restrict_violation`, a que os gatilhos do projeto levantam com o motivo na mensagem. */
export function isRestrictViolation(error: unknown, reason?: string): boolean {
  const info = pgError(error);
  return info.code === '23001' && (reason === undefined || info.message === reason);
}
