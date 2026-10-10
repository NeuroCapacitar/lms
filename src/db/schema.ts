import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Tabela mínima de verificação do M0-04 (conectividade e prova de cache desligado).
 * Não guarda dado de negócio nem pessoal.
 */
export const healthProbe = pgTable('health_probe', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  note: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tabelas do Better Auth (identidade), na versão fixada (ADR 0029). Os NOMES das propriedades
 * exportadas (`user`, `session`, `account`, `verification`, `rateLimit`) são os modelos que o
 * adapter procura; os nomes das colunas seguem `snake_case` (casing do Drizzle). Com
 * `validateSchema: false` nada confere o schema em execução: o teste src/server/auth/schema.test.ts
 * compara estas tabelas com `getAuthTables()` da versão instalada.
 */
const stamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

export const user = pgTable('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  ...stamps,
});

export const session = pgTable(
  'session',
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...stamps,
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...stamps,
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...stamps,
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const rateLimit = pgTable('rate_limit', {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: 'number' }).notNull(),
});

/**
 * Contadores de janela fixa para limitar pedidos de link (M1-06). A chave NUNCA contém o e-mail em
 * claro (só um hash) nem o token. Uma linha por chave; a janela reinicia quando expira.
 */
export const authThrottle = pgTable('auth_throttle', {
  key: text().primaryKey(),
  windowStart: timestamp({ withTimezone: true }).notNull().defaultNow(),
  count: integer().notNull().default(0),
});

/**
 * Perfil 1:1 com o usuário (M1-02). Criado JUNTO do usuário, na mesma transação, por um gatilho do
 * Postgres (migration 0003), então nenhum usuário existe sem perfil. Não guarda e-mail nem dado de
 * autenticação. `certificate_name` fica nulo até a confirmação da M7; alterá-lo zera a confirmação.
 */
export const profile = pgTable(
  'profile',
  {
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text().notNull(),
    certificateName: text(),
    certificateNameConfirmedAt: timestamp({ withTimezone: true }),
    theme: text().notNull().default('system'),
    autoAdvance: boolean().notNull().default(false),
    ...stamps,
  },
  (table) => [check('profile_theme_check', sql`${table.theme} in ('system', 'light', 'dark')`)],
);
