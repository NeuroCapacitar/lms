import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { testUtils } from 'better-auth/plugins';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { authOptions, type AuthConfig } from '../../src/server/auth/create-auth.ts';

/**
 * Instância do Better Auth SÓ para testes: as mesmas opções de produção (`authOptions`) mais o
 * plugin de utilidades de teste, que cria usuários e sessões sem passar por um método de login.
 * Nunca entra em código de produção.
 */
export async function createTestAuth(connectionString: string, config: AuthConfig) {
  const opened = await openDatabase(connectionString);
  const auth = betterAuth({
    ...authOptions(config),
    database: drizzleAdapter(opened.db, { provider: 'pg', schema }),
    plugins: [testUtils()],
  });
  const context = await auth.$context;
  return { auth, db: opened.db, test: context.test, close: opened.close };
}
