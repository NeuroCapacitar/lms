/**
 * Travas dos scripts de backup e de ensaio de restauração (M9-05). Puras e testadas: o que decide se um comando
 * pode rodar contra um banco fica aqui, não espalhado pelos scripts.
 */

const RESTORE_DB_PREFIX = 'restore_rehearsal';

function parse(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error('URL de banco inválida');
  }
}

export function databaseName(url: string): string {
  return decodeURIComponent(parse(url).pathname.replace(/^\//, ''));
}

/**
 * O ensaio NUNCA restaura em Production nem em banco de uso: só em um banco descartável, cujo NOME começa por
 * `restore_rehearsal`. O nome é a trava (um banco comum do Neon se chama `neondb`), então apontar o ensaio para o
 * banco errado por engano falha antes de qualquer `pg_restore`.
 */
export function assertRestoreTarget(url: string): void {
  const name = databaseName(url);
  if (!name.startsWith(RESTORE_DB_PREFIX))
    throw new Error(
      `RECUSADO: o ensaio só restaura em um banco descartável cujo nome começa por "${RESTORE_DB_PREFIX}" (recebido: "${name}")`,
    );
}

/** O dump lê com uma role SOMENTE LEITURA e por conexão DIRETA (o pooler do Neon e o Hyperdrive não servem a `pg_dump`). */
export function assertDirectConnection(url: string): void {
  const host = parse(url).hostname;
  if (host.includes('-pooler.'))
    throw new Error('RECUSADO: o dump usa a conexão direta do Neon, não o pooler');
  if (host.endsWith('.hyperdrive.local'))
    throw new Error('RECUSADO: o dump não passa pelo Hyperdrive');
}

/** Recipiente `age` (chave PÚBLICA): `age1…`. Uma chave privada (`AGE-SECRET-KEY-…`) NUNCA entra no automatismo. */
export function assertAgeRecipient(value: string): void {
  if (value.startsWith('AGE-SECRET-KEY-'))
    throw new Error(
      'RECUSADO: isto é uma chave PRIVADA do age; o backup só recebe a chave pública (age1…)',
    );
  if (!/^age1[0-9a-z]{50,}$/.test(value))
    throw new Error('chave pública do age inválida (esperado age1…)');
}
