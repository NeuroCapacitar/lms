/**
 * Proteções dos scripts de banco: o alvo precisa ser um endpoint DIRETO (nunca o pooler
 * da Neon) e pertencer ao ambiente pedido. Nada aqui lê ou imprime senha.
 */
import { ENVIRONMENTS, isEnvironmentName, type EnvironmentName } from '../environments.ts';

export interface DatabaseTarget {
  readonly environment: EnvironmentName;
  readonly url: URL;
}

export function parseTarget(
  environment: string,
  connectionString: string | undefined,
): DatabaseTarget {
  if (!isEnvironmentName(environment)) {
    throw new Error(`ambiente desconhecido: "${environment}" (use dev, staging ou production)`);
  }
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_MIGRATION não definida (ver docs/operations/database-and-migrations.md)',
    );
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL_MIGRATION não é uma URL válida');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL_MIGRATION precisa usar o protocolo postgresql://');
  }
  if (url.hostname.includes('-pooler')) {
    throw new Error('recusado: endpoint com pooler. Migrações usam a conexão DIRETA da Neon.');
  }
  const approved = ENVIRONMENTS[environment].databaseHost;
  if (!approved) {
    throw new Error(
      `o ambiente "${environment}" não tem banco aprovado em scripts/environments.ts`,
    );
  }
  if (url.hostname !== approved) {
    throw new Error(
      `recusado: o host do banco (${url.hostname}) não é o aprovado para "${environment}" (${approved})`,
    );
  }
  return { environment, url };
}
