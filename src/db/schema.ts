import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
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

/**
 * Papéis de Staff (M1-03). `student` é implícito (sem linha). Papéis não exclusivos: uma pessoa pode
 * ter `support` e `admin`. Ativo = `revoked_at` nulo; a história fica.
 */
export const userRole = pgTable(
  'user_role',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    grantedBy: text().references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: text().references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    check('user_role_role_check', sql`${table.role} in ('support', 'admin')`),
    uniqueIndex('user_role_active_idx')
      .on(table.userId, table.role)
      .where(sql`${table.revokedAt} is null`),
  ],
);

/**
 * Grants do Suporte, um por capability delegável. O CHECK lista SÓ as delegáveis: o banco recusa
 * grant de capability exclusiva do Admin. A lista duplica o catálogo de
 * src/features/identity/capabilities.ts (a camada db não importa features); um teste confere.
 */
export const staffGrant = pgTable(
  'staff_grant',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    capability: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    grantedBy: text().references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: text().references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    check(
      'staff_grant_capability_check',
      sql`${table.capability} in ('course.edit', 'access.grant', 'enrollment.support_edit', 'refund.execute', 'finance.review', 'finance.view', 'certificate.reissue', 'discussion.moderate', 'help.edit', 'audit.view', 'ops.queue')`,
    ),
    uniqueIndex('staff_grant_active_idx')
      .on(table.userId, table.capability)
      .where(sql`${table.revokedAt} is null`),
  ],
);

/** Suspensão de conta (reversível e auditada). Ativa = `lifted_at` nulo; no máximo uma por pessoa. */
export const userSuspension = pgTable(
  'user_suspension',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    suspendedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    suspendedBy: text().references(() => user.id, { onDelete: 'set null' }),
    reason: text(),
    liftedAt: timestamp({ withTimezone: true }),
    liftedBy: text().references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('user_suspension_active_idx')
      .on(table.userId)
      .where(sql`${table.liftedAt} is null`),
  ],
);

/**
 * Auditoria durável e APPEND-ONLY (um gatilho recusa UPDATE e DELETE). Sem chave estrangeira para
 * o ator nem para o alvo: o registro sobrevive à remoção da pessoa. Sem segredos nem dados
 * pessoais além dos IDs; `details` guarda só o necessário (papel, capability, motivo curto).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorId: text(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text().notNull(),
    details: jsonb().notNull().default({}),
  },
  (table) => [
    index('audit_log_at_idx').on(table.at),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
  ],
);
