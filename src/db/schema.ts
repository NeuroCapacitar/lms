import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  jsonb,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
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

/**
 * Reautenticação recente (M1-05): prova de posse do e-mail numa AÇÃO SENSÍVEL. O desafio nasce
 * ligado a UMA sessão, é de uso único e guarda só o hash do token. Não confundir com sessão
 * recente: entrar há pouco não vale como prova.
 */
export const reauthChallenge = pgTable(
  'reauth_challenge',
  {
    tokenHash: text().primaryKey(),
    sessionId: text()
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('reauth_challenge_session_idx').on(table.sessionId)],
);

/** A prova vale só para a sessão que a obteve e some junto dela (cascade). */
export const reauthProof = pgTable('reauth_proof', {
  sessionId: text()
    .primaryKey()
    .references(() => session.id, { onDelete: 'cascade' }),
  verifiedAt: timestamp({ withTimezone: true }).notNull(),
});

/**
 * Convite de Staff (M1-04): uso único, expira (7 dias), revogável e reenviável. Guarda só o HASH do
 * token. `email` é sempre minúsculo. Pendente = `status = 'pending'`; vencido é calculado por
 * `expires_at` (sem job). Só o papel `support` é convidável: Admin nasce do bootstrap.
 */
export const staffInvitation = pgTable(
  'staff_invitation',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    role: text().notNull().default('support'),
    tokenHash: text().notNull().unique(),
    status: text().notNull().default('pending'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    invitedBy: text().references(() => user.id, { onDelete: 'set null' }),
    acceptedBy: text().references(() => user.id, { onDelete: 'set null' }),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedBy: text().references(() => user.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
    lastSentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...stamps,
  },
  (table) => [
    check('staff_invitation_role_check', sql`${table.role} = 'support'`),
    check(
      'staff_invitation_status_check',
      sql`${table.status} in ('pending', 'accepted', 'revoked')`,
    ),
    check('staff_invitation_email_lower_check', sql`${table.email} = lower(${table.email})`),
    uniqueIndex('staff_invitation_pending_email_idx')
      .on(table.email)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/** Grants iniciais do convite (mesma lista do CHECK de `staff_grant`: só delegáveis). */
export const staffInvitationGrant = pgTable(
  'staff_invitation_grant',
  {
    invitationId: uuid()
      .notNull()
      .references(() => staffInvitation.id, { onDelete: 'cascade' }),
    capability: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invitationId, table.capability] }),
    check(
      'staff_invitation_grant_capability_check',
      sql`${table.capability} in ('course.edit', 'access.grant', 'enrollment.support_edit', 'refund.execute', 'finance.review', 'finance.view', 'certificate.reissue', 'discussion.moderate', 'help.edit', 'audit.view', 'ops.queue')`,
    ),
  ],
);

/**
 * Versões dos documentos legais (M1-09): Termos de Uso e Política de Privacidade. Só o MECANISMO é
 * do Hub; o texto é do advogado do cliente (PENDENTE). `body` é texto simples, em parágrafos.
 * Vigente = a versão de cada tipo com a maior `effective_from` já alcançada. Publicar uma nova
 * versão (nova linha) exige novo aceite no próximo acesso. Versões com aceite não se apagam.
 */
export const legalDocumentVersion = pgTable(
  'legal_document_version',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    version: text().notNull(),
    body: text().notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('legal_document_version_kind_check', sql`${table.kind} in ('terms', 'privacy')`),
    uniqueIndex('legal_document_version_kind_version_idx').on(table.kind, table.version),
  ],
);

/**
 * Aceite de uma versão por uma pessoa, junto da declaração de ter 18 anos ou mais (obrigatória: o
 * CHECK recusa `false`). Não guarda IP nem agente de usuário (salvo orientação do advogado).
 */
export const termsAcceptance = pgTable(
  'terms_acceptance',
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentVersionId: uuid()
      .notNull()
      .references(() => legalDocumentVersion.id, { onDelete: 'restrict' }),
    acceptedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    adultDeclared: boolean().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.documentVersionId] }),
    check('terms_acceptance_adult_check', sql`${table.adultDeclared} = true`),
  ],
);

/**
 * Course (M2-01): identidade pedagógica e comercial estável. `slug` único (base das URLs públicas) e
 * só muda enquanto o curso nunca foi publicado (`first_published_at`, mantido por gatilho). O título
 * é INTERNO; os textos exibidos ao público vêm do conteúdo do M2-02. Curso com direitos, conclusões
 * ou Orders não se apaga (só arquiva); as FKs de marcos futuros usam RESTRICT.
 */
export const course = pgTable(
  'course',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    /** Escolha obrigatória, sem valor padrão: a sequência pedagógica é decisão de quem cria. */
    sequenceMode: text().notNull(),
    status: text().notNull().default('draft'),
    firstPublishedAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [
    check(
      'course_slug_format_check',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) between 3 and 80`,
    ),
    check('course_title_check', sql`char_length(btrim(${table.title})) between 1 and 200`),
    check('course_sequence_mode_check', sql`${table.sequenceMode} in ('guided', 'free')`),
    check('course_status_check', sql`${table.status} in ('draft', 'published', 'archived')`),
  ],
);

/**
 * Offer (M2-01): oferta de EXATAMENTE um Course. Preço em centavos inteiros de BRL (moeda fixa);
 * TODA oferta tem prazo em meses (sem vitalício), inclusive a gratuita; parcelamento 1 a 12 sem
 * juros (1 se gratuita). As regras comerciais estão em CHECK, não só no código.
 */
export const offer = pgTable(
  'offer',
  {
    id: uuid().primaryKey().defaultRandom(),
    courseId: uuid()
      .notNull()
      .references(() => course.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    kind: text().notNull(),
    priceCents: integer().notNull(),
    currency: text().notNull().default('BRL'),
    accessMonths: integer().notNull(),
    maxInstallments: integer().notNull().default(1),
    status: text().notNull().default('draft'),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [
    index('offer_course_id_idx').on(table.courseId),
    check('offer_name_check', sql`char_length(btrim(${table.name})) between 1 and 120`),
    check('offer_kind_check', sql`${table.kind} in ('free', 'paid')`),
    check('offer_currency_check', sql`${table.currency} = 'BRL'`),
    check(
      'offer_price_check',
      sql`(${table.kind} = 'free' and ${table.priceCents} = 0) or (${table.kind} = 'paid' and ${table.priceCents} > 0)`,
    ),
    check('offer_access_months_check', sql`${table.accessMonths} between 1 and 600`),
    check(
      'offer_installments_check',
      sql`${table.maxInstallments} between 1 and 12 and (${table.kind} = 'paid' or ${table.maxInstallments} = 1)`,
    ),
    check('offer_status_check', sql`${table.status} in ('draft', 'active', 'paused', 'archived')`),
  ],
);
