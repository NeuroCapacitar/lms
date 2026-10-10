import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';

import type { Database } from '../../db/client';
import * as schema from '../../db/schema';
import { LINK_LIMITS, type EmailSender } from '../../features/identity/link-policy';
import { sha256Hex } from '../crypto';

export interface AuthConfig {
  /** Origem pública do app neste ambiente (`APP_BASE_URL`). Única origem confiável. */
  baseUrl: string;
  /** Segredo do Better Auth (`BETTER_AUTH_SECRET`), por ambiente. */
  secret: string;
}

/** Dependências de saída do Better Auth: e-mail e a consulta de "este e-mail é de Staff?". */
export interface AuthDeps {
  emailSender: EmailSender;
  /** E-mail de Staff nunca nasce por cadastro livre (hook de criação de usuário). */
  isStaffEmail(email: string): Promise<boolean>;
}

/** Endereço da página de confirmação. O token vai no FRAGMENTO: não chega a servidores nem a logs. */
function confirmationUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/entrar/confirmar#token=${encodeURIComponent(token)}`;
}

/**
 * Opções do Better Auth 1.7.7 (ADR 0029), SEM o banco. Separadas para o teste de schema comparar
 * as tabelas com `getAuthTables(authOptions(...))` e para os testes montarem a mesma instância
 * com o plugin de testes. Regras fixas (ADR 0007): sessão em Postgres de 7 dias rolling, sem cache
 * de cookie, origem exata (sem curingas nem `localhost` fora de Development), sem provedores
 * confiáveis, IP de `cf-connecting-ip`, limite de requisições no banco e magic link com token
 * guardado em hash e validade de 15 minutos. Google e senha entram na M1-07.
 */
export function authOptions(config: AuthConfig, deps: AuthDeps) {
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
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (await deps.isStaffEmail(user.email)) {
              throw new APIError('FORBIDDEN', { message: 'staff_requires_invitation' });
            }
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: LINK_LIMITS.linkTtlSeconds,
        storeToken: 'hashed',
        // Os limites de pedido ficam em link-routes.ts (por e-mail, IP e teto global); o endpoint
        // nativo de pedido é bloqueado, então este limite do plugin nunca é a barreira.
        sendMagicLink: async ({ email, token }) => {
          await deps.emailSender.send({
            to: email,
            template: 'magic-link',
            variables: { LINK_URL: confirmationUrl(config.baseUrl, token) },
            idempotencyKey: `magic-link:${await sha256Hex(token)}`,
          });
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

/** Uma instância POR REQUISIÇÃO, sobre o `Database` da requisição. */
export function createAuth(db: Database, config: AuthConfig, deps: AuthDeps) {
  return betterAuth({
    ...authOptions(config, deps),
    database: drizzleAdapter(db, { provider: 'pg', schema }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
