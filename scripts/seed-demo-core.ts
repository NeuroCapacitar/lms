import { ENVIRONMENTS } from './environments.ts';
import { parseTarget, type DatabaseTarget } from './db/guards.ts';

/**
 * Trava do seed demonstrativo (M2-07): só Development e Staging. Recusa por TRÊS caminhos
 * independentes, porque um erro de configuração não pode criar dados sintéticos em Production:
 * o nome do ambiente, o host aprovado para o ambiente (`parseTarget`) e o host de Production em
 * qualquer ambiente pedido. Também recusa nome de banco que lembre produção.
 */
export function resolveSeedTarget(
  environment: string,
  connectionString: string | undefined,
): DatabaseTarget {
  if (environment === 'production') {
    throw new Error('Production recusada: o curso demonstrativo é só de dev e staging.');
  }
  const target = parseTarget(environment, connectionString);
  if (target.url.hostname === ENVIRONMENTS.production.databaseHost) {
    throw new Error('recusado: o host do banco é o de Production.');
  }
  const database = target.url.pathname.replace(/^\//, '').toLowerCase();
  if (/(^|[-_])(prod|production)([-_]|$)/.test(database)) {
    throw new Error(`recusado: o nome do banco ("${database}") lembra Production.`);
  }
  return target;
}
