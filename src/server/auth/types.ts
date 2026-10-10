import type { Database } from '../../db/client';
import type { AccessContext } from '../../features/identity/capabilities';
import type { Auth } from './create-auth';

/** Variáveis do contexto Hono das rotas autenticadas (preenchidas pelos middlewares). */
export interface AuthVars {
  auth: Auth;
  db: Database;
  /** Registra trabalho que continua depois da resposta (envio do e-mail), antes de fechar o banco. */
  defer: (work: Promise<unknown>) => void;
  /** Preenchido por `requireCapability`: quem é a pessoa e o que ela pode, carregado nesta requisição. */
  access?: AccessContext;
}
