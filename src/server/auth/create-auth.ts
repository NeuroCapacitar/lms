import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { Database } from '../../db/client';
import * as schema from '../../db/schema';

export interface AuthConfig {
  /** Origem pública do app neste ambiente (`APP_BASE_URL`). Única origem confiável. */
  baseUrl: string;
  /** Segredo do Better Auth (`BETTER_AUTH_SECRET`), por ambiente. */
  secret: string;
}

/**
 * Opções do Better Auth 1.7.7 (ADR 0029), SEM o banco. Separadas para o teste de schema comparar
 * as tabelas com `getAuthTables(authOptions(...))` e para os testes montarem a mesma instância
 * com o plugin de testes. Regras fixas (ADR 0007): sessão em Postgres de 7 dias rolling, sem cache
 * de cookie, origem exata (sem curingas nem `localhost` fora de Development), sem provedores
 * confiáveis, IP de `cf-connecting-ip` e limite de requisições no banco. Os métodos de login
 * (magic link, Google, senha) entram nas tarefas seguintes.
 */
export function authOptions(config: AuthConfig) {
  return {
    baseURL: config.baseUrl,
    secret: config.secret,
    trustedOrigins: [config.baseUrl],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { validateSchema: false },
      // Explícito: por padrão o Better Auth DESLIGA a checagem de origem quando NODE_ENV=test ou
      // TEST está definida; aqui ela fica ligada em qualquer ambiente (e os testes a exercitam).
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: config.baseUrl.startsWith('https://'),
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },
    account: {
      accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false },
    },
  } satisfies BetterAuthOptions;
}

/** Uma instância POR REQUISIÇÃO, sobre o `Database` da requisição. */
export function createAuth(db: Database, config: AuthConfig) {
  return betterAuth({
    ...authOptions(config),
    database: drizzleAdapter(db, { provider: 'pg', schema }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
