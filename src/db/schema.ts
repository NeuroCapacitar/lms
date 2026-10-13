import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  jsonb,
  primaryKey,
  timestamp,
  unique,
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
    unique('offer_id_course_unique').on(table.id, table.courseId),
  ],
);

/**
 * Estado do currículo vivo de um curso (M2-02): o contador do RASCUNHO (`draft_rev`, concorrência
 * otimista: não é histórico) e o da PUBLICAÇÃO (`published_version`, simples contador). Não existe
 * CourseRelease nem revisão imutável: o publicado anterior não é retido.
 */
export const curriculumState = pgTable('curriculum_state', {
  courseId: uuid()
    .primaryKey()
    .references(() => course.id, { onDelete: 'restrict' }),
  draftRev: integer().notNull().default(0),
  publishedVersion: integer().notNull().default(0),
  publishedAt: timestamp({ withTimezone: true }),
  ...stamps,
});

/** Detalhes do curso exibidos ao público (rascunho). O título interno fica em `course`. */
export const courseDraft = pgTable(
  'course_draft',
  {
    courseId: uuid()
      .primaryKey()
      .references(() => course.id, { onDelete: 'cascade' }),
    displayTitle: text().notNull(),
    /** Texto rico (Tiptap JSON validado por allowlist, M2-05); nulo = sem descrição. */
    description: jsonb(),
    workloadHours: integer(),
    ...stamps,
  },
  (table) => [
    check(
      'course_draft_description_size_check',
      sql`${table.description} is null or octet_length(${table.description}::text) <= 100000`,
    ),
    check(
      'course_draft_workload_check',
      sql`${table.workloadHours} is null or ${table.workloadHours} between 1 and 10000`,
    ),
  ],
);

/** Os mesmos detalhes, PUBLICADOS (o que quem estuda e o público veem). */
export const courseContent = pgTable(
  'course_content',
  {
    courseId: uuid()
      .primaryKey()
      .references(() => course.id, { onDelete: 'restrict' }),
    displayTitle: text().notNull(),
    /** Texto rico (Tiptap JSON validado por allowlist, M2-05); nulo = sem descrição. */
    description: jsonb(),
    workloadHours: integer(),
    ...stamps,
  },
  (table) => [
    check(
      'course_content_description_size_check',
      sql`${table.description} is null or octet_length(${table.description}::text) <= 100000`,
    ),
    check(
      'course_content_workload_check',
      sql`${table.workloadHours} is null or ${table.workloadHours} between 1 and 10000`,
    ),
  ],
);

/** Módulo do RASCUNHO. O id nasce aqui e é o MESMO id do módulo publicado (estável para sempre). */
export const moduleDraft = pgTable(
  'module_draft',
  {
    id: uuid().primaryKey().defaultRandom(),
    courseId: uuid()
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    position: integer().notNull(),
    /** D+N: dias depois do primeiro acesso em que o módulo libera (0 = imediato). */
    dripDays: integer().notNull().default(0),
    ...stamps,
  },
  (table) => [
    unique('module_draft_id_course_unique').on(table.id, table.courseId),
    index('module_draft_course_idx').on(table.courseId, table.position),
    check('module_draft_drip_check', sql`${table.dripDays} between 0 and 3650`),
    check('module_draft_position_check', sql`${table.position} >= 0`),
  ],
);

/** Aula do RASCUNHO (só `text` neste marco). Pode mudar de módulo mantendo o id. */
export const lessonDraft = pgTable(
  'lesson_draft',
  {
    id: uuid().primaryKey().defaultRandom(),
    courseId: uuid().notNull(),
    moduleId: uuid().notNull(),
    title: text().notNull(),
    position: integer().notNull(),
    kind: text().notNull().default('text'),
    isOptional: boolean().notNull().default(false),
    body: jsonb(),
    ...stamps,
  },
  (table) => [
    foreignKey({
      name: 'lesson_draft_module_fk',
      columns: [table.moduleId, table.courseId],
      foreignColumns: [moduleDraft.id, moduleDraft.courseId],
    }).onDelete('cascade'),
    index('lesson_draft_module_idx').on(table.moduleId, table.position),
    check('lesson_draft_kind_check', sql`${table.kind} = 'text'`),
    check(
      'lesson_draft_body_size_check',
      sql`${table.body} is null or octet_length(${table.body}::text) <= 100000`,
    ),
    check('lesson_draft_position_check', sql`${table.position} >= 0`),
  ],
);

/**
 * Módulo PUBLICADO. Nunca é apagado: o que sai do rascunho é APOSENTADO (`retired_at`) e some do
 * aluno e da elegibilidade, mas o id continua existindo para progresso, conclusão e discussão.
 */
export const courseModule = pgTable(
  'module',
  {
    id: uuid().primaryKey(),
    courseId: uuid()
      .notNull()
      .references(() => course.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    position: integer().notNull(),
    dripDays: integer().notNull().default(0),
    retiredAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    unique('module_id_course_unique').on(table.id, table.courseId),
    index('module_course_idx').on(table.courseId, table.position),
    check('module_drip_check', sql`${table.dripDays} between 0 and 3650`),
  ],
);

/** Aula PUBLICADA (mesmas regras do módulo: aposentada, nunca apagada). */
export const lesson = pgTable(
  'lesson',
  {
    id: uuid().primaryKey(),
    courseId: uuid().notNull(),
    moduleId: uuid().notNull(),
    title: text().notNull(),
    position: integer().notNull(),
    kind: text().notNull().default('text'),
    isOptional: boolean().notNull().default(false),
    body: jsonb(),
    retiredAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    foreignKey({
      name: 'lesson_module_fk',
      columns: [table.moduleId, table.courseId],
      foreignColumns: [courseModule.id, courseModule.courseId],
    }).onDelete('restrict'),
    index('lesson_module_idx').on(table.moduleId, table.position),
    unique('lesson_id_course_unique').on(table.id, table.courseId),
    check('lesson_kind_check', sql`${table.kind} = 'text'`),
    check(
      'lesson_body_size_check',
      sql`${table.body} is null or octet_length(${table.body}::text) <= 100000`,
    ),
  ],
);

/**
 * Matrícula (M3-01): UMA linha por (pessoa, curso), criada uma vez. É a PROJEÇÃO efetiva dos direitos
 * (`entitlement`): `anchor_at` é a âncora do drip, definida na criação e IMUTÁVEL (gatilho); nova
 * compra ou inscrição depois de expirar continua nesta mesma linha (nada de episódio). A linha é
 * também o que serializa concessões concorrentes (`SELECT ... FOR UPDATE`). `effective_expires_at` é a
 * maior expiração entre os direitos não revogados, recalculada na mesma transação de toda mudança.
 */
export const enrollment = pgTable(
  'enrollment',
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    courseId: uuid()
      .notNull()
      .references(() => course.id, { onDelete: 'restrict' }),
    anchorAt: timestamp({ withTimezone: true }).notNull(),
    effectiveExpiresAt: timestamp({ withTimezone: true }),
    suspendedAt: timestamp({ withTimezone: true }),
    suspendedReason: text(),
    suspendedBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [
    primaryKey({ name: 'enrollment_pk', columns: [table.userId, table.courseId] }),
    index('enrollment_course_idx').on(table.courseId),
    check(
      'enrollment_suspension_check',
      sql`${table.suspendedAt} is not null or (${table.suspendedReason} is null and ${table.suspendedBy} is null)`,
    ),
  ],
);

/**
 * Direito de acesso (M3-01): a FONTE do acesso. Um direito por concessão, com janela própria
 * (`starts_at` a `expires_at`, sempre com prazo, sem vitalício). Nunca é apagado nem reescrito: só
 * pode ser REVOGADO (definitivo), por gatilho. `source_ref` é único por `source` e serve de
 * idempotência (ex.: o id do pedido numa compra; uma chave por pessoa e curso na inscrição gratuita).
 */
export const entitlement = pgTable(
  'entitlement',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().notNull(),
    courseId: uuid().notNull(),
    offerId: uuid(),
    source: text().notNull(),
    sourceRef: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text(),
    revokedBy: text().references(() => user.id, { onDelete: 'set null' }),
    grantedBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'entitlement_enrollment_fk',
      columns: [table.userId, table.courseId],
      foreignColumns: [enrollment.userId, enrollment.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'entitlement_offer_fk',
      columns: [table.offerId, table.courseId],
      foreignColumns: [offer.id, offer.courseId],
    }).onDelete('restrict'),
    uniqueIndex('entitlement_source_ref_idx').on(table.source, table.sourceRef),
    index('entitlement_person_course_idx').on(table.userId, table.courseId),
    check(
      'entitlement_source_check',
      sql`${table.source} in ('free_offer', 'purchase', 'admin_grant')`,
    ),
    check('entitlement_source_ref_check', sql`char_length(${table.sourceRef}) between 1 and 200`),
    check('entitlement_window_check', sql`${table.expiresAt} > ${table.startsAt}`),
    check(
      'entitlement_offer_required_check',
      sql`${table.source} = 'admin_grant' or ${table.offerId} is not null`,
    ),
    check(
      'entitlement_revocation_check',
      sql`(${table.revokedAt} is null and ${table.revokedReason} is null and ${table.revokedBy} is null) or (${table.revokedAt} is not null and ${table.revokedReason} is not null)`,
    ),
  ],
);

/**
 * Conclusão de aula (M3-03 cria a tabela para o drip e a sequência guiada lerem; a ESCRITA, o botão
 * "Concluir" e a conclusão do curso são do M3-04). Única por (pessoa, aula), só existe para quem tem
 * matrícula no curso da aula (FK composta) e é APPEND-ONLY: uma conclusão não se desfaz nem se
 * reescreve (gatilho), então o progresso histórico não some.
 */
export const lessonCompletion = pgTable(
  'lesson_completion',
  {
    userId: text().notNull(),
    courseId: uuid().notNull(),
    lessonId: uuid().notNull(),
    completedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    method: text().notNull().default('manual'),
  },
  (table) => [
    primaryKey({ name: 'lesson_completion_pk', columns: [table.userId, table.lessonId] }),
    foreignKey({
      name: 'lesson_completion_enrollment_fk',
      columns: [table.userId, table.courseId],
      foreignColumns: [enrollment.userId, enrollment.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_completion_lesson_fk',
      columns: [table.lessonId, table.courseId],
      foreignColumns: [lesson.id, lesson.courseId],
    }).onDelete('restrict'),
    index('lesson_completion_course_idx').on(table.userId, table.courseId),
    check('lesson_completion_method_check', sql`${table.method} = 'manual'`),
  ],
);

/**
 * Conclusão do curso (M3-04): HISTÓRICA e única por (pessoa, curso). Nasce na MESMA transação da
 * última aula obrigatória, depois de travar a matrícula, e persiste mesmo que o currículo mude depois
 * (o percentual pode cair; a conclusão não some nem se duplica). `required_total` é o total de aulas
 * obrigatórias NO MOMENTO. Append-only por gatilho. O certificado (M7) nasce desta linha.
 */
export const courseCompletion = pgTable(
  'course_completion',
  {
    userId: text().notNull(),
    courseId: uuid().notNull(),
    completedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    requiredTotal: integer().notNull(),
  },
  (table) => [
    primaryKey({ name: 'course_completion_pk', columns: [table.userId, table.courseId] }),
    foreignKey({
      name: 'course_completion_enrollment_fk',
      columns: [table.userId, table.courseId],
      foreignColumns: [enrollment.userId, enrollment.courseId],
    }).onDelete('restrict'),
    check('course_completion_total_check', sql`${table.requiredTotal} > 0`),
  ],
);

/**
 * Outbox (M4-01): a FONTE DA VERDADE das intenções (e-mail, chamada a provider, tarefa). Nasce na MESMA
 * transação da mudança de domínio; a Queue só acelera (ADR 0006). O payload leva só IDs. A linha é
 * reivindicada com `FOR UPDATE SKIP LOCKED` e um LEASE cujo tempo vem do `now()` do banco; cada claim
 * incrementa `lease_version` (fencing): quem perdeu o lease não conclui nada.
 * Estados: `pending` (aguarda `available_at`), `leased`, `delivered` (concluída), `failed` (falha
 * permanente, à espera de decisão humana), `dead` (tentativas esgotadas) e `superseded` (substituída).
 */
export const outboxMessage = pgTable(
  'outbox_message',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    queue: text().notNull(),
    dedupeKey: text().notNull(),
    payload: jsonb().notNull(),
    /** Menor vai primeiro: link de login < transacional < marketing (usado pelo e-mail, M4-05/08). */
    priority: integer().notNull().default(100),
    state: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text(),
    leaseUntil: timestamp({ withTimezone: true }),
    leaseVersion: integer().notNull().default(0),
    correlationId: text().notNull(),
    lastErrorCode: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Quando entrou em estado final (`delivered`, `failed`, `dead`, `superseded`): base da retenção. */
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('outbox_message_dedupe_key_idx').on(table.dedupeKey),
    index('outbox_message_claimable_idx')
      .on(table.priority, table.availableAt)
      .where(sql`${table.state} in ('pending', 'leased')`),
    index('outbox_message_finished_idx')
      .on(table.state, table.finishedAt)
      .where(sql`${table.finishedAt} is not null`),
    check('outbox_message_kind_check', sql`length(${table.kind}) between 1 and 100`),
    check('outbox_message_queue_check', sql`${table.queue} in ('finance', 'general')`),
    check('outbox_message_dedupe_key_check', sql`length(${table.dedupeKey}) between 1 and 200`),
    check(
      'outbox_message_state_check',
      sql`${table.state} in ('pending', 'leased', 'delivered', 'failed', 'dead', 'superseded')`,
    ),
    check('outbox_message_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'outbox_message_correlation_check',
      sql`length(${table.correlationId}) between 1 and 100`,
    ),
    check(
      'outbox_message_lease_check',
      sql`(${table.state} = 'leased') = (${table.leaseOwner} is not null and ${table.leaseUntil} is not null)`,
    ),
    check(
      'outbox_message_finished_check',
      sql`(${table.state} in ('delivered', 'failed', 'dead', 'superseded')) = (${table.finishedAt} is not null)`,
    ),
    check('outbox_message_payload_check', sql`jsonb_typeof(${table.payload}) = 'object'`),
  ],
);

/**
 * Inbox (M4-01): eventos EXTERNOS (Asaas, Resend) persistidos ANTES do ACK e deduplicados por
 * `(provider, event_id)`. O payload é limitado (64 KiB) e a retenção é de 30 dias depois de concluído.
 * Mesmo esquema de estados e de lease da outbox.
 */
export const inboxEvent = pgTable(
  'inbox_event',
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    eventId: text().notNull(),
    payload: jsonb().notNull(),
    state: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text(),
    leaseUntil: timestamp({ withTimezone: true }),
    leaseVersion: integer().notNull().default(0),
    correlationId: text().notNull(),
    lastErrorCode: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('inbox_event_provider_event_idx').on(table.provider, table.eventId),
    index('inbox_event_claimable_idx')
      .on(table.availableAt)
      .where(sql`${table.state} in ('pending', 'leased')`),
    index('inbox_event_finished_idx')
      .on(table.state, table.finishedAt)
      .where(sql`${table.finishedAt} is not null`),
    check('inbox_event_provider_check', sql`${table.provider} in ('asaas', 'resend')`),
    check('inbox_event_event_id_check', sql`length(${table.eventId}) between 1 and 200`),
    check(
      'inbox_event_state_check',
      sql`${table.state} in ('pending', 'leased', 'delivered', 'failed', 'dead', 'superseded')`,
    ),
    check('inbox_event_attempts_check', sql`${table.attempts} >= 0`),
    check('inbox_event_correlation_check', sql`length(${table.correlationId}) between 1 and 100`),
    check(
      'inbox_event_lease_check',
      sql`(${table.state} = 'leased') = (${table.leaseOwner} is not null and ${table.leaseUntil} is not null)`,
    ),
    check(
      'inbox_event_finished_check',
      sql`(${table.state} in ('delivered', 'failed', 'dead', 'superseded')) = (${table.finishedAt} is not null)`,
    ),
    check('inbox_event_payload_check', sql`jsonb_typeof(${table.payload}) = 'object'`),
    check('inbox_event_payload_size_check', sql`octet_length(${table.payload}::text) <= 65536`),
  ],
);

/**
 * Chaves de operação (M4-02): hoje só o kill switch por fila (`queue.finance.paused`,
 * `queue.general.paused`). A AUSÊNCIA da linha significa "não pausada". Só a Staff com a capacidade
 * certa muda (Operations Center, M4-09); o consumidor apenas LÊ.
 */
export const systemFlag = pgTable(
  'system_flag',
  {
    key: text().primaryKey(),
    enabled: boolean().notNull().default(false),
    reason: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('system_flag_key_check', sql`${table.key} ~ '^[a-z][a-z0-9_.]{0,99}$'`)],
);
