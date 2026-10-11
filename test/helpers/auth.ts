import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { testUtils } from 'better-auth/plugins';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { authOptions, type AuthConfig, type AuthDeps } from '../../src/server/auth/create-auth.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';

/**
 * Instância do Better Auth SÓ para testes: as mesmas opções de produção (`authOptions`) mais o
 * plugin de utilidades de teste, que cria usuários e sessões sem passar por um método de login.
 * Nunca entra em código de produção.
 */
export async function createTestAuth(
  connectionString: string,
  config: AuthConfig,
  deps: AuthDeps = {
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    isSuspended: async () => false,
    // Os testes abrem sessão de Staff por `testUtils`, sem método de login: não aplica a regra "Staff só por link".
    isStaffUser: async () => false,
  },
) {
  const opened = await openDatabase(connectionString);
  const auth = betterAuth({
    ...authOptions(config, deps),
    database: drizzleAdapter(opened.db, { provider: 'pg', schema }),
    plugins: [testUtils()],
  });
  const context = await auth.$context;
  return { auth, db: opened.db, test: context.test, close: opened.close };
}
