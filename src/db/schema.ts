import {
  bigint,
  boolean,
  check,
  date,
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
    /** Percentual assistido que conclui uma aula de vídeo (M5-02); o padrão do produto é 90. */
    videoCompletionPercent: integer().notNull().default(90),
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
    check(
      'course_video_completion_percent_check',
      sql`${table.videoCompletionPercent} between 50 and 100`,
    ),
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
    /** Capa e banner (M5-07): `media_asset` PRONTOS; nulos = sem imagem. */
    coverMediaId: uuid().references(() => mediaAsset.id, { onDelete: 'restrict' }),
    bannerMediaId: uuid().references(() => mediaAsset.id, { onDelete: 'restrict' }),
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
    /** Capa e banner PUBLICADOS (M5-07): o master já foi copiado para o bucket público antes do ponteiro. */
    coverMediaId: uuid().references(() => mediaAsset.id, { onDelete: 'restrict' }),
    bannerMediaId: uuid().references(() => mediaAsset.id, { onDelete: 'restrict' }),
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
    /** Aula de vídeo: o UM vídeo da aula (vazio enquanto o rascunho está incompleto; a publicação exige). */
    videoAssetId: uuid().references(() => videoAsset.id, { onDelete: 'restrict' }),
    /** Aula de quiz (M5-04): o quiz inteiro, com gabarito (só a Staff lê); pode estar incompleto no rascunho. */
    quiz: jsonb(),
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
    check('lesson_draft_kind_check', sql`${table.kind} in ('text', 'video', 'quiz')`),
    check('lesson_draft_quiz_check', sql`${table.kind} = 'quiz' or ${table.quiz} is null`),
    check(
      'lesson_draft_quiz_size_check',
      sql`${table.quiz} is null or octet_length(${table.quiz}::text) <= 200000`,
    ),
    check(
      'lesson_draft_video_asset_check',
      sql`${table.kind} = 'video' or ${table.videoAssetId} is null`,
    ),
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
    /** Aula de vídeo: exatamente UM `video_asset` (a aula de texto não tem). */
    videoAssetId: uuid().references(() => videoAsset.id, { onDelete: 'restrict' }),
    /** Aula de quiz (M5-04): o quiz publicado, com gabarito; NUNCA sai inteiro para o aluno. */
    quiz: jsonb(),
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
    check('lesson_kind_check', sql`${table.kind} in ('text', 'video', 'quiz')`),
    check('lesson_quiz_check', sql`(${table.kind} = 'quiz') = (${table.quiz} is not null)`),
    check(
      'lesson_quiz_size_check',
      sql`${table.quiz} is null or octet_length(${table.quiz}::text) <= 200000`,
    ),
    check(
      'lesson_video_asset_check',
      sql`(${table.kind} = 'video') = (${table.videoAssetId} is not null)`,
    ),
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
    check('lesson_completion_method_check', sql`${table.method} in ('manual', 'video', 'quiz')`),
  ],
);

/**
 * Comando recebido do outbox offline do aluno (M8-03). A chave (pessoa, `clientOperationId`) torna a sincronização IDEMPOTENTE: o
 * primeiro resultado é definitivo (`applied` nasce na MESMA transação do efeito; `rejected` guarda o motivo) e repetir o mesmo
 * id devolve esse resultado sem refazer nada. A pessoa vem sempre da sessão. `client_created_at` é só metadado (a hora do fato é
 * a do servidor: `processed_at` e a `completed_at` da conclusão). O comando guardado é cortado em 64 caracteres.
 */
export const offlineOperation = pgTable(
  'offline_operation',
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    clientOperationId: uuid().notNull(),
    command: text().notNull(),
    lessonId: uuid(),
    outcome: text().notNull(),
    reason: text(),
    clientCreatedAt: timestamp({ withTimezone: true }),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'offline_operation_pk', columns: [table.userId, table.clientOperationId] }),
    check('offline_operation_outcome_check', sql`${table.outcome} in ('applied', 'rejected')`),
    check(
      'offline_operation_reason_check',
      sql`(${table.outcome} = 'rejected') = (${table.reason} is not null)`,
    ),
    check('offline_operation_command_check', sql`char_length(${table.command}) <= 64`),
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
 * Política de certificado por curso (M7-01). Sem linha ou `enabled = false`: a conclusão existe e NENHUM certificado
 * nasce. Ligar é decisão do Admin; o template publicado (M7-03) passa a ser exigido quando existir.
 */
export const certificatePolicy = pgTable('certificate_policy', {
  courseId: uuid()
    .primaryKey()
    .references(() => course.id, { onDelete: 'cascade' }),
  enabled: boolean().notNull().default(false),
  ...stamps,
});

/**
 * Certificado (M7-01). Nasce na MESMA transação da `course_completion` (só o vencedor do insert cria), com UMA
 * intenção `certificate.render` na outbox. O `snapshot` congela no `queued` e nunca muda (gatilho); `code` é opaco
 * e único; o PDF (M7-02) só aparece com `pdf_key` e `pdf_sha256` juntos, em `ready`. A reemissão (M7-04) cria outro
 * certificado com `predecessor_id`: o índice parcial garante UM certificado original por conclusão. Falha de PDF
 * nunca remove a conclusão nem duplica o certificado.
 */
export const certificate = pgTable(
  'certificate',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().notNull(),
    courseId: uuid().notNull(),
    code: text().notNull(),
    status: text().notNull().default('queued'),
    snapshot: jsonb().notNull(),
    pdfKey: text(),
    pdfSha256: text(),
    predecessorId: uuid(),
    /** Quantas vezes a renderização foi iniciada (compõe a chave de dedupe da nova tentativa). */
    renderAttempts: integer().notNull().default(0),
    failureCode: text(),
    readyAt: timestamp({ withTimezone: true }),
    /** Revogação (M7-04, só Admin): quando, por quem, categoria padronizada e nota INTERNA (nunca vai ao aluno). */
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: text().references(() => user.id, { onDelete: 'set null' }),
    revocationCategory: text(),
    revocationNote: text(),
    ...stamps,
  },
  (table) => [
    uniqueIndex('certificate_code_idx').on(table.code),
    /** Um certificado tem no máximo UM sucessor: a reemissão concorrente perde pelo índice, não por código. */
    uniqueIndex('certificate_successor_idx')
      .on(table.predecessorId)
      .where(sql`${table.predecessorId} is not null`),
    check(
      'certificate_revoked_check',
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
    uniqueIndex('certificate_original_idx')
      .on(table.userId, table.courseId)
      .where(sql`${table.predecessorId} is null`),
    index('certificate_status_idx').on(table.status, table.createdAt),
    foreignKey({
      name: 'certificate_completion_fk',
      columns: [table.userId, table.courseId],
      foreignColumns: [courseCompletion.userId, courseCompletion.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'certificate_predecessor_fk',
      columns: [table.predecessorId],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    check(
      'certificate_status_check',
      sql`${table.status} in ('awaiting_name', 'queued', 'rendering', 'ready', 'failed', 'revoked', 'superseded')`,
    ),
    check('certificate_code_check', sql`${table.code} ~ '^[A-Za-z0-9_-]{22}$'`),
    check(
      'certificate_pdf_check',
      sql`(${table.pdfKey} is null) = (${table.pdfSha256} is null) and (${table.status} <> 'ready' or ${table.pdfKey} is not null)`,
    ),
  ],
);

/**
 * Emitente do certificado (M7-06): UMA linha só (`singleton` é sempre verdadeiro). Razão social e CNPJ (14 dígitos,
 * dígitos verificadores validados no servidor). Só o Admin edita; cada certificado copia estes dados para o snapshot.
 */
export const certificateIssuer = pgTable(
  'certificate_issuer',
  {
    singleton: boolean().primaryKey().default(true),
    legalName: text().notNull(),
    cnpj: text().notNull(),
    updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [
    check('certificate_issuer_singleton_check', sql`${table.singleton}`),
    check('certificate_issuer_cnpj_check', sql`${table.cnpj} ~ '^[0-9]{14}$'`),
    check('certificate_issuer_name_check', sql`char_length(${table.legalName}) between 3 and 200`),
  ],
);

/**
 * Signatário POR CURSO (M7-06), sem fallback global. A assinatura é mídia PRIVADA (`certificate_asset`) amarrada por
 * `media_reference` (dono `certificate_signatory`, espaço `signature`); a coluna guarda só o id para o snapshot.
 */
export const certificateSignatory = pgTable(
  'certificate_signatory',
  {
    courseId: uuid()
      .primaryKey()
      .references(() => course.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    title: text().notNull(),
    signatureMediaId: uuid().references(() => mediaAsset.id, { onDelete: 'restrict' }),
    updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [
    check('certificate_signatory_name_check', sql`char_length(${table.name}) between 2 and 120`),
    check('certificate_signatory_title_check', sql`char_length(${table.title}) between 2 and 120`),
  ],
);

/**
 * Template do certificado POR CURSO (M7-03): o layout (campos pré-definidos em mm, validado por Zod no servidor) e o
 * fundo A4 opcional (mídia privada `certificate_asset`). No máximo UM `draft` e UM `published` por curso; publicar
 * congela o layout (gatilho) e o `published` anterior vira `superseded`. `version` é o controle otimista do
 * rascunho (dois Admins no mesmo rascunho). Certificados já emitidos mantêm o layout do SEU snapshot.
 */
export const certificateTemplate = pgTable(
  'certificate_template',
  {
    id: uuid().primaryKey().defaultRandom(),
    courseId: uuid()
      .notNull()
      .references(() => course.id, { onDelete: 'restrict' }),
    status: text().notNull().default('draft'),
    layout: jsonb().notNull(),
    backgroundMediaId: uuid().references(() => mediaAsset.id, { onDelete: 'restrict' }),
    version: integer().notNull().default(1),
    publishedAt: timestamp({ withTimezone: true }),
    updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [
    uniqueIndex('certificate_template_draft_idx')
      .on(table.courseId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('certificate_template_published_idx')
      .on(table.courseId)
      .where(sql`${table.status} = 'published'`),
    check(
      'certificate_template_status_check',
      sql`${table.status} in ('draft', 'published', 'superseded')`,
    ),
    check(
      'certificate_template_published_check',
      sql`(${table.status} = 'draft') = (${table.publishedAt} is null)`,
    ),
    check('certificate_template_version_check', sql`${table.version} >= 1`),
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

/**
 * Última execução de cada job do Cron (M4-03), uma linha por nome. Serve a dois fins: o LEASE do job
 * (execuções sobrepostas não duplicam trabalho; o tempo vem do `now()` do banco, `lease_version` é o
 * fencing) e o registro da última execução (início, fim, resultado, contagem e código do erro) que o
 * Operations Center e o alerta "Cron sem rodar" leem. Nunca guarda texto de erro, só código.
 */
export const jobRun = pgTable(
  'job_run',
  {
    name: text().primaryKey(),
    leaseOwner: text(),
    leaseUntil: timestamp({ withTimezone: true }),
    leaseVersion: integer().notNull().default(0),
    lastStartedAt: timestamp({ withTimezone: true }),
    lastFinishedAt: timestamp({ withTimezone: true }),
    /** `ok` ou `error` da última execução concluída; vazio enquanto nunca terminou uma. */
    lastStatus: text(),
    lastCount: integer(),
    lastDurationMs: integer(),
    lastErrorCode: text(),
  },
  (table) => [
    check('job_run_name_check', sql`${table.name} ~ '^[a-z][a-z0-9_.-]{0,99}$'`),
    check('job_run_status_check', sql`${table.lastStatus} in ('ok', 'error')`),
    check(
      'job_run_lease_check',
      sql`(${table.leaseOwner} is null) = (${table.leaseUntil} is null)`,
    ),
  ],
);

/**
 * Rastro de cada e-mail transacional enviado pelo outbox (M4-04). SEM corpo, SEM destinatário em claro
 * (a pessoa é referenciada por `recipient_user_id` e o endereço é lido da conta só na hora de enviar) e
 * SEM token ou link de acesso. `variables` guarda só valores NÃO sensíveis validados pelo contrato do
 * template (ex.: título do curso). Estados: `queued` (aguarda envio), `sending`, `accepted` (o Resend
 * aceitou), `acceptance_unknown` (timeout ou 5xx: pode ter sido aceito; só se repete com a MESMA chave de
 * idempotência, dentro da janela), `delivered`, `delayed`, `bounced`, `complained` (estes quatro vêm do
 * webhook, M4-07), `failed`, `suppressed` e `blocked` (fora da lista permitida do Staging).
 */
export const emailMessage = pgTable(
  'email_message',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Idempotência da intenção de e-mail: repetir não cria outra mensagem nem outro envio. */
    dedupeKey: text().notNull(),
    template: text().notNull(),
    recipientKind: text().notNull(),
    recipientUserId: text().references(() => user.id, { onDelete: 'set null' }),
    variables: jsonb().notNull().default({}),
    state: text().notNull().default('queued'),
    providerMessageId: text(),
    /** Dia (UTC) da cota reservada para este envio; vazio = nada reservado. Evita contar duas vezes na repetição. */
    quotaReservedDay: date(),
    /** Início da janela de idempotência do Resend (a primeira tentativa de envio). */
    firstAttemptAt: timestamp({ withTimezone: true }),
    acceptedAt: timestamp({ withTimezone: true }),
    lastErrorCode: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_message_dedupe_key_idx').on(table.dedupeKey),
    index('email_message_recipient_idx').on(table.recipientUserId, table.createdAt),
    index('email_message_provider_idx').on(table.providerMessageId),
    check('email_message_dedupe_key_check', sql`length(${table.dedupeKey}) between 1 and 200`),
    check(
      'email_message_recipient_kind_check',
      sql`${table.recipientKind} in ('user', 'support_inbox')`,
    ),
    check(
      'email_message_state_check',
      sql`${table.state} in ('queued', 'sending', 'accepted', 'acceptance_unknown', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'suppressed', 'blocked')`,
    ),
    check('email_message_variables_check', sql`jsonb_typeof(${table.variables}) = 'object'`),
  ],
);

/**
 * Estado de entregabilidade por DESTINATÁRIO (M4-07): quem teve bounce permanente ou reclamação não
 * recebe mais e-mail transacional enfileirado. A chave é o HMAC-SHA256 do endereço normalizado (nunca o
 * endereço em claro) com uma chave de servidor, então a tabela não vira lista de e-mails. Bounce e
 * reclamação NÃO alteram User, Enrollment nem Order.
 */
export const emailRecipientState = pgTable(
  'email_recipient_state',
  {
    recipientHash: text().primaryKey(),
    state: text().notNull().default('suppressed'),
    reason: text().notNull(),
    /** Id do evento do Resend (inbox) que causou a supressão: rastro para a Staff. */
    sourceEventId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('email_recipient_state_hash_check', sql`${table.recipientHash} ~ '^[0-9a-f]{64}$'`),
    check('email_recipient_state_state_check', sql`${table.state} = 'suppressed'`),
    check(
      'email_recipient_state_reason_check',
      sql`${table.reason} in ('hard_bounce', 'complaint')`,
    ),
  ],
);

/**
 * Livro-razão da cota do Resend (M4-08): quantos e-mails FORAM RESERVADOS ou aceitos por dia (UTC; o Resend
 * Free zera à meia-noite UTC e conta 100 por dia e 3.000 por mês). A reserva é feita ANTES do envio, de
 * forma atômica, e devolvida se o provider não aceitou. Só contagem: sem endereço, sem conteúdo.
 */
export const emailSendLedger = pgTable(
  'email_send_ledger',
  {
    day: date().primaryKey(),
    count: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('email_send_ledger_count_check', sql`${table.count} >= 0`)],
);

/**
 * Conexão com um provider de vídeo (M5-01): a conta do CLIENTE. O segredo (token de API) é guardado CIFRADO
 * (AES-256-GCM; nonce aleatório de 96 bits, AAD = id da conexão + provider, chave mestra VERSIONADA num
 * segredo do Worker, nunca no banco). As três colunas do cofre vêm juntas ou ficam todas vazias (conexão sem
 * credenciais, como YouTube e Vimeo públicos). Várias conexões por provider; sem provider padrão por curso.
 * Nenhuma rota devolve o segredo, cifrado ou não.
 */
export const videoProviderConnection = pgTable(
  'video_provider_connection',
  {
    id: uuid().primaryKey(),
    provider: text().notNull(),
    label: text().notNull(),
    ciphertext: text(),
    nonce: text(),
    keyVersion: integer(),
    status: text().notNull().default('active'),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [
    check(
      'video_provider_connection_provider_check',
      sql`${table.provider} in ('jmvstream', 'panda', 'cloudflare_stream', 'mux', 'youtube', 'vimeo')`,
    ),
    check('video_provider_connection_status_check', sql`${table.status} in ('active', 'disabled')`),
    check('video_provider_connection_label_check', sql`length(${table.label}) between 1 and 80`),
    check(
      'video_provider_connection_secret_check',
      sql`(${table.ciphertext} is null) = (${table.nonce} is null) and (${table.ciphertext} is null) = (${table.keyVersion} is null)`,
    ),
    check(
      'video_provider_connection_key_version_check',
      sql`${table.keyVersion} is null or ${table.keyVersion} >= 1`,
    ),
    index('video_provider_connection_provider_idx').on(table.provider, table.status),
  ],
);

/**
 * Um vídeo de um provider (M5-01). Usa UMA conexão concreta; trocar ou desativar a conexão NÃO altera o
 * asset existente (nem o histórico de progresso): a FK é `restrict` e o `provider` fica copiado aqui.
 * `managed` = subido pelo Hub (pode ser apagado no provider); `referenced` = só apontado (nunca apagado).
 * `duration_seconds` vem do provider, nunca do cliente. `capabilities` só traz o que o adapter declarou.
 */
export const videoAsset = pgTable(
  'video_asset',
  {
    id: uuid().primaryKey().defaultRandom(),
    connectionId: uuid()
      .notNull()
      .references(() => videoProviderConnection.id, { onDelete: 'restrict' }),
    provider: text().notNull(),
    externalId: text().notNull(),
    mode: text().notNull(),
    state: text().notNull().default('processing'),
    durationSeconds: integer(),
    capabilities: jsonb().notNull().default({}),
    ...stamps,
  },
  (table) => [
    uniqueIndex('video_asset_provider_external_idx').on(table.connectionId, table.externalId),
    check(
      'video_asset_provider_check',
      sql`${table.provider} in ('jmvstream', 'panda', 'cloudflare_stream', 'mux', 'youtube', 'vimeo')`,
    ),
    check('video_asset_mode_check', sql`${table.mode} in ('managed', 'referenced')`),
    check(
      'video_asset_state_check',
      sql`${table.state} in ('processing', 'ready', 'error', 'unavailable')`,
    ),
    check('video_asset_external_id_check', sql`length(${table.externalId}) between 1 and 200`),
    check(
      'video_asset_duration_check',
      sql`${table.durationSeconds} is null or ${table.durationSeconds} between 1 and 86400`,
    ),
    check('video_asset_capabilities_check', sql`jsonb_typeof(${table.capabilities}) = 'object'`),
  ],
);

/**
 * Progresso de uma aula de vídeo (M5-02), uma linha por pessoa e aula. `max_position` (segundos) é a MAIOR
 * posição já alcançada e só SOBE (gatilho): seek para trás não a reduz. Conclui quando `max_position /
 * duration` alcança o limiar do curso; a conclusão grava a EVIDÊNCIA (provider, asset, posição, duração,
 * hora do servidor) e depois disso a linha não muda mais. Só existe para quem tem matrícula (FK composta).
 * `last_session_id` e `last_seq` ordenam os envios de UMA sessão de reprodução: o que chega com `seq`
 * menor ou igual ao último é ignorado.
 */
export const videoProgress = pgTable(
  'video_progress',
  {
    userId: text().notNull(),
    lessonId: uuid().notNull(),
    courseId: uuid().notNull(),
    videoAssetId: uuid()
      .notNull()
      .references(() => videoAsset.id, { onDelete: 'restrict' }),
    maxPosition: integer().notNull().default(0),
    durationSeconds: integer().notNull(),
    lastSessionId: text(),
    lastSeq: integer().notNull().default(0),
    completedAt: timestamp({ withTimezone: true }),
    evidence: jsonb(),
    ...stamps,
  },
  (table) => [
    primaryKey({ name: 'video_progress_pk', columns: [table.userId, table.lessonId] }),
    foreignKey({
      name: 'video_progress_enrollment_fk',
      columns: [table.userId, table.courseId],
      foreignColumns: [enrollment.userId, enrollment.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'video_progress_lesson_fk',
      columns: [table.lessonId, table.courseId],
      foreignColumns: [lesson.id, lesson.courseId],
    }).onDelete('restrict'),
    check('video_progress_position_check', sql`${table.maxPosition} >= 0`),
    check(
      'video_progress_position_duration_check',
      sql`${table.maxPosition} <= ${table.durationSeconds}`,
    ),
    check('video_progress_duration_check', sql`${table.durationSeconds} between 1 and 86400`),
    check('video_progress_seq_check', sql`${table.lastSeq} >= 0`),
    check(
      'video_progress_completion_check',
      sql`(${table.completedAt} is null) = (${table.evidence} is null)`,
    ),
  ],
);

/**
 * Tentativa de quiz (M5-04): APPEND-ONLY (gatilho) e com número sequencial por (pessoa, aula), protegido por
 * `UNIQUE(user, lesson, number)` e pela matrícula travada. Guarda uma CÓPIA do quiz como foi apresentado
 * (ordem, gabarito e nota mínima vigentes na hora) e das respostas, então editar o quiz depois não reescreve o
 * histórico. A nota é calculada só no servidor.
 */
export const quizAttempt = pgTable(
  'quiz_attempt',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().notNull(),
    courseId: uuid().notNull(),
    lessonId: uuid().notNull(),
    number: integer().notNull(),
    snapshot: jsonb().notNull(),
    answers: jsonb().notNull(),
    earnedPoints: integer().notNull(),
    totalPoints: integer().notNull(),
    scorePercent: integer().notNull(),
    passed: boolean().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('quiz_attempt_number_unique').on(table.userId, table.lessonId, table.number),
    foreignKey({
      name: 'quiz_attempt_enrollment_fk',
      columns: [table.userId, table.courseId],
      foreignColumns: [enrollment.userId, enrollment.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'quiz_attempt_lesson_fk',
      columns: [table.lessonId, table.courseId],
      foreignColumns: [lesson.id, lesson.courseId],
    }).onDelete('restrict'),
    check('quiz_attempt_number_check', sql`${table.number} >= 1`),
    check(
      'quiz_attempt_score_check',
      sql`${table.earnedPoints} >= 0 and ${table.earnedPoints} <= ${table.totalPoints} and ${table.scorePercent} between 0 and 100`,
    ),
  ],
);

/**
 * Discussão por aula (M5-05): perguntas e respostas assíncronas, texto simples, com UM nível de resposta. O
 * post referencia a aula ESTÁVEL; aula retirada do currículo só some da tela (o post é preservado). Moderação
 * muda o `state` (nunca apaga a linha) e fica na auditoria com o motivo. `author_role` guarda se o post veio da
 * Staff (resposta da equipe) no momento em que foi escrito. Um nível: a resposta aponta para um post de topo da
 * MESMA aula (FK composta + gatilho que recusa resposta de resposta).
 */
export const discussionPost = pgTable(
  'discussion_post',
  {
    id: uuid().primaryKey().defaultRandom(),
    courseId: uuid().notNull(),
    lessonId: uuid().notNull(),
    parentId: uuid(),
    authorId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    authorRole: text().notNull().default('student'),
    body: text().notNull(),
    state: text().notNull().default('visible'),
    editedAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    unique('discussion_post_id_lesson_unique').on(table.id, table.lessonId),
    foreignKey({
      name: 'discussion_post_lesson_fk',
      columns: [table.lessonId, table.courseId],
      foreignColumns: [lesson.id, lesson.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'discussion_post_parent_fk',
      columns: [table.parentId, table.lessonId],
      foreignColumns: [table.id, table.lessonId],
    }).onDelete('restrict'),
    index('discussion_post_lesson_idx').on(table.lessonId, table.createdAt),
    index('discussion_post_author_idx').on(table.authorId, table.createdAt),
    check('discussion_post_state_check', sql`${table.state} in ('visible', 'hidden', 'deleted')`),
    check('discussion_post_role_check', sql`${table.authorRole} in ('student', 'staff')`),
    check(
      'discussion_post_body_check',
      sql`char_length(${table.body}) between 1 and 2000 and ${table.body} = btrim(${table.body})`,
    ),
    check(
      'discussion_post_not_own_parent_check',
      sql`${table.parentId} is distinct from ${table.id}`,
    ),
  ],
);

/** Denúncia de um post: UMA por pessoa e post. `resolved_at` fecha a denúncia (a Staff agiu ou descartou). */
export const discussionReport = pgTable(
  'discussion_report',
  {
    postId: uuid()
      .notNull()
      .references(() => discussionPost.id, { onDelete: 'restrict' }),
    reporterId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: 'discussion_report_pk', columns: [table.postId, table.reporterId] }),
    index('discussion_report_open_idx')
      .on(table.postId)
      .where(sql`${table.resolvedAt} is null`),
    check(
      'discussion_report_reason_check',
      sql`${table.reason} is null or char_length(${table.reason}) <= 300`,
    ),
  ],
);

/**
 * Interesse em um curso que ainda não pode ser adquirido (M5-06). UM por (curso, pessoa); o estado vai de
 * `active` (quer ser avisada) para `withdrawn` (retirou na conta) ou `converted` (já tem direito efetivo). Só a
 * pessoa autenticada registra, nunca uma lista externa.
 */
export const courseInterest = pgTable(
  'course_interest',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    courseId: uuid()
      .notNull()
      .references(() => course.id, { onDelete: 'restrict' }),
    status: text().notNull().default('active'),
    ...stamps,
  },
  (table) => [
    unique('course_interest_course_user_unique').on(table.courseId, table.userId),
    index('course_interest_course_status_idx').on(table.courseId, table.status),
    check(
      'course_interest_status_check',
      sql`${table.status} in ('active', 'withdrawn', 'converted')`,
    ),
  ],
);

/**
 * Ciclo de disponibilidade do curso (M5-06): nasce na transição "não adquirível → adquirível" e fecha na volta.
 * No máximo UM ciclo aberto por curso (índice único parcial). Acrescentar oferta a curso já adquirível NÃO cria
 * ciclo; fechar e reabrir cria outro (o aviso se repete a cada reabertura).
 */
export const courseAvailabilityCycle = pgTable(
  'course_availability_cycle',
  {
    id: uuid().primaryKey().defaultRandom(),
    courseId: uuid()
      .notNull()
      .references(() => course.id, { onDelete: 'restrict' }),
    number: integer().notNull(),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('course_availability_cycle_number_unique').on(table.courseId, table.number),
    uniqueIndex('course_availability_cycle_open_idx')
      .on(table.courseId)
      .where(sql`${table.closedAt} is null`),
    check('course_availability_cycle_number_check', sql`${table.number} >= 1`),
  ],
);

/** Quem já foi avisado em qual ciclo: a garantia de NO MÁXIMO um aviso por (interesse, ciclo). */
export const courseInterestNotification = pgTable(
  'course_interest_notification',
  {
    interestId: uuid()
      .notNull()
      .references(() => courseInterest.id, { onDelete: 'restrict' }),
    cycleId: uuid()
      .notNull()
      .references(() => courseAvailabilityCycle.id, { onDelete: 'restrict' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'course_interest_notification_pk',
      columns: [table.interestId, table.cycleId],
    }),
  ],
);

/**
 * Objeto de mídia no R2 (M5-07, ADR 0016). Nasce `pending_upload` (PUT pré-assinado curto, expira em 24 h) e só
 * vira `ready` depois de o servidor conferir os BYTES (tamanho, assinatura mágica, dimensões do cabeçalho e
 * SHA-256); "200 no PUT" não publica nada. A chave do master é opaca e imutável. Capa e banner são PÚBLICOS: o
 * master é copiado para o bucket público (`public_key`) ANTES de qualquer ponteiro apontar para ele. Todo o
 * resto é privado e só sai depois de autorização. Nada é apagado enquanto houver referência.
 */
export const mediaAsset = pgTable(
  'media_asset',
  {
    id: uuid().primaryKey().defaultRandom(),
    purpose: text().notNull(),
    visibility: text().notNull(),
    state: text().notNull().default('pending_upload'),
    declaredType: text().notNull(),
    declaredSize: integer().notNull(),
    contentType: text(),
    size: integer(),
    width: integer(),
    height: integer(),
    sha256: text(),
    /** Chave opaca do master no bucket PRIVADO. */
    storageKey: text().notNull().unique(),
    /** Chave do master copiado no bucket PÚBLICO (só capa e banner, depois de publicados). */
    publicKey: text(),
    publishedAt: timestamp({ withTimezone: true }),
    createdBy: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    /** Upload não confirmado expira aqui (24 h). */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    confirmedAt: timestamp({ withTimezone: true }),
    rejectedReason: text(),
    deletedAt: timestamp({ withTimezone: true }),
    /** Quando os objetos do R2 foram de fato apagados (depois do `deleted`, fora da transação). */
    storagePurgedAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    index('media_asset_state_idx').on(table.state, table.createdAt),
    check(
      'media_asset_purpose_check',
      sql`${table.purpose} in ('course_cover', 'course_banner', 'panel_banner', 'login_media', 'lesson_material', 'certificate_asset')`,
    ),
    check('media_asset_visibility_check', sql`${table.visibility} in ('public', 'private')`),
    check(
      'media_asset_state_check',
      sql`${table.state} in ('pending_upload', 'ready', 'rejected', 'deleted')`,
    ),
    check(
      'media_asset_ready_check',
      sql`${table.state} <> 'ready' or (${table.sha256} is not null and ${table.size} is not null and ${table.contentType} is not null and ${table.confirmedAt} is not null)`,
    ),
    check(
      'media_asset_public_key_check',
      sql`${table.publicKey} is null or ${table.visibility} = 'public'`,
    ),
    check(
      'media_asset_size_check',
      sql`${table.declaredSize} > 0 and (${table.size} is null or ${table.size} > 0)`,
    ),
  ],
);

/**
 * Quem usa o objeto (M5-07): UMA linha por (dono, espaço). A contagem de referências é a das linhas, lida SOB
 * TRAVA do asset na mesma transação que muda o ponteiro e na limpeza, então uma corrida entre "passar a usar" e
 * "apagar o órfão" nunca apaga o que acabou de ganhar referência.
 */
export const mediaReference = pgTable(
  'media_reference',
  {
    mediaId: uuid()
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'restrict' }),
    ownerType: text().notNull(),
    ownerId: text().notNull(),
    slot: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'media_reference_pk',
      columns: [table.ownerType, table.ownerId, table.slot],
    }),
    index('media_reference_media_idx').on(table.mediaId),
    check(
      'media_reference_owner_check',
      sql`${table.ownerType} in ('course_draft', 'course_content', 'lesson', 'panel_banner', 'login_media', 'certificate_signatory', 'certificate_template')`,
    ),
  ],
);

/**
 * Item da FAQ da Ajuda (M5-14): pergunta curta e resposta em texto rico (Tiptap JSON validado por allowlist),
 * numa categoria fixa. `draft` só a Staff vê; `published` aparece para quem está logado. A ordem é por
 * `position` (botões de subir e descer, sem arrastar).
 */
export const helpFaqItem = pgTable(
  'help_faq_item',
  {
    id: uuid().primaryKey().defaultRandom(),
    category: text().notNull(),
    question: text().notNull(),
    answer: jsonb().notNull(),
    position: integer().notNull(),
    state: text().notNull().default('draft'),
    ...stamps,
  },
  (table) => [
    index('help_faq_item_state_idx').on(table.state, table.position),
    check(
      'help_faq_item_category_check',
      sql`${table.category} in ('conta', 'acesso', 'curso', 'certificado', 'pagamento', 'outro')`,
    ),
    check('help_faq_item_state_check', sql`${table.state} in ('draft', 'published')`),
    check(
      'help_faq_item_question_check',
      sql`char_length(${table.question}) between 1 and 300 and ${table.question} = btrim(${table.question})`,
    ),
    check('help_faq_item_answer_size_check', sql`octet_length(${table.answer}::text) <= 100000`),
    check('help_faq_item_position_check', sql`${table.position} >= 0`),
  ],
);

/**
 * Pedido de suporte (M5-14): o texto fica guardado AQUI (a Staff o lê na página de pedidos) e o e-mail ao
 * suporte leva só o id e a categoria, com o `Reply-To` da pessoa. A resposta humana acontece fora do Hub (sem
 * helpdesk). Gravado na mesma transação da intenção do e-mail: falha do Resend nunca perde o pedido.
 */
export const supportRequest = pgTable(
  'support_request',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    category: text().notNull(),
    message: text().notNull(),
    /** Contexto opcional: o curso a que o pedido se refere. */
    courseId: uuid().references(() => course.id, { onDelete: 'restrict' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('support_request_user_idx').on(table.userId, table.createdAt),
    index('support_request_created_idx').on(table.createdAt),
    check(
      'support_request_category_check',
      sql`${table.category} in ('conta', 'acesso', 'curso', 'certificado', 'pagamento', 'outro')`,
    ),
    check(
      'support_request_message_check',
      sql`char_length(${table.message}) between 1 and 2000 and ${table.message} = btrim(${table.message})`,
    ),
  ],
);

/**
 * Banner do painel do aluno (M5-15). A imagem é um `media_asset` PÚBLICO (propósito `panel_banner`); o texto
 * alternativo é OBRIGATÓRIO; o link é só interno ou https de host permitido; a janela de exibição é opcional.
 * Publicar copia a imagem para o bucket público ANTES de o estado mudar. A ordem é por `position`.
 */
export const panelBanner = pgTable(
  'panel_banner',
  {
    id: uuid().primaryKey().defaultRandom(),
    mediaId: uuid()
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'restrict' }),
    alt: text().notNull(),
    linkUrl: text(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    position: integer().notNull(),
    state: text().notNull().default('draft'),
    ...stamps,
  },
  (table) => [
    index('panel_banner_state_idx').on(table.state, table.position),
    check('panel_banner_state_check', sql`${table.state} in ('draft', 'published')`),
    check(
      'panel_banner_alt_check',
      sql`char_length(${table.alt}) between 1 and 200 and ${table.alt} = btrim(${table.alt})`,
    ),
    check(
      'panel_banner_link_check',
      sql`${table.linkUrl} is null or char_length(${table.linkUrl}) between 1 and 500`,
    ),
    check(
      'panel_banner_window_check',
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check('panel_banner_position_check', sql`${table.position} >= 0`),
  ],
);

/**
 * Imagem decorativa da tela de login (M5-15): até 5 PUBLICADAS (conferido sob trava da tabela), sem texto
 * alternativo (decorativa). Mesma regra de publicação do banner do painel.
 */
export const loginMedia = pgTable(
  'login_media',
  {
    id: uuid().primaryKey().defaultRandom(),
    mediaId: uuid()
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    state: text().notNull().default('draft'),
    ...stamps,
  },
  (table) => [
    index('login_media_state_idx').on(table.state, table.position),
    check('login_media_state_check', sql`${table.state} in ('draft', 'published')`),
    check('login_media_position_check', sql`${table.position} >= 0`),
  ],
);

/**
 * Pedido de compra (M6-01; "Order"). Guarda para SEMPRE as condições do momento da compra (snapshot: curso, Offer,
 * preço em centavos BRL, prazo, parcelas, meios); alterar a Offer depois nunca muda o pedido (gatilho recusa a mudança
 * do snapshot, da pessoa e da Offer, e a exclusão). `attempt_id` é a tentativa gerada pelo cliente: repetir com o
 * mesmo `attempt_id` devolve o mesmo pedido. Sem PII além do `user_id`. Nome `purchase_order` (`order` é palavra
 * reservada do SQL).
 */
export const purchaseOrder = pgTable(
  'purchase_order',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    offerId: uuid().notNull(),
    courseId: uuid().notNull(),
    attemptId: uuid().notNull(),
    status: text().notNull().default('pending'),
    courseTitle: text().notNull(),
    offerName: text().notNull(),
    priceCents: integer().notNull(),
    currency: text().notNull().default('BRL'),
    accessMonths: integer().notNull(),
    maxInstallments: integer().notNull(),
    paymentMethods: text().array().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Reconciliação (M6-04): quantas consultas ao provider já foram feitas e quando a próxima vale (backoff). */
    reconcileAttempts: integer().notNull().default(0),
    reconcileNextAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    foreignKey({
      columns: [table.offerId, table.courseId],
      foreignColumns: [offer.id, offer.courseId],
      name: 'purchase_order_offer_course_fk',
    }).onDelete('restrict'),
    unique('purchase_order_user_attempt_unique').on(table.userId, table.attemptId),
    index('purchase_order_user_status_idx').on(table.userId, table.status),
    index('purchase_order_status_expires_idx').on(table.status, table.expiresAt),
    index('purchase_order_reconcile_idx')
      .on(table.reconcileNextAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      'purchase_order_status_check',
      sql`${table.status} in ('pending', 'paid', 'expired', 'canceled', 'refund_requested', 'refunded', 'disputed', 'review')`,
    ),
    check('purchase_order_currency_check', sql`${table.currency} = 'BRL'`),
    check('purchase_order_price_check', sql`${table.priceCents} >= 1000`),
    check('purchase_order_access_months_check', sql`${table.accessMonths} between 1 and 600`),
    check(
      'purchase_order_installments_check',
      sql`${table.maxInstallments} between 1 and 12 and ${table.maxInstallments} <= ${table.priceCents} / 1000`,
    ),
    check(
      'purchase_order_methods_check',
      sql`cardinality(${table.paymentMethods}) >= 1 and ${table.paymentMethods} <@ array['pix', 'card']::text[]`,
    ),
    check(
      'purchase_order_snapshot_text_check',
      sql`char_length(btrim(${table.courseTitle})) >= 1 and char_length(btrim(${table.offerName})) >= 1`,
    ),
  ],
);

/**
 * Sessão de checkout do Asaas (M6-01): várias por pedido no modelo, no máximo UMA ativa (`creating`, `open` ou
 * `unknown`) por pedido na v1 (índice único parcial). `unknown` = chamada ao Asaas com resultado ambíguo: não se recria
 * até a janela expirar. A URL só é guardada `https` (a allowlist de hosts é do M6-02).
 */
export const checkoutSession = pgTable(
  'checkout_session',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: 'restrict' }),
    state: text().notNull().default('creating'),
    providerSessionId: text().unique(),
    checkoutUrl: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...stamps,
  },
  (table) => [
    uniqueIndex('checkout_session_active_idx')
      .on(table.orderId)
      .where(sql`${table.state} in ('creating', 'open', 'unknown')`),
    index('checkout_session_state_expires_idx').on(table.state, table.expiresAt),
    check(
      'checkout_session_state_check',
      sql`${table.state} in ('creating', 'open', 'unknown', 'failed', 'expired', 'completed')`,
    ),
    check(
      'checkout_session_open_check',
      sql`${table.state} <> 'open' or (${table.providerSessionId} is not null and ${table.checkoutUrl} is not null)`,
    ),
    check(
      'checkout_session_url_check',
      sql`${table.checkoutUrl} is null or (${table.checkoutUrl} like 'https://%' and char_length(${table.checkoutUrl}) <= 2048)`,
    ),
  ],
);

/**
 * Pagamento (M6-01): estado local do pagamento no provider. `UNIQUE (provider, provider_payment_id)` impede dois
 * registros do mesmo pagamento. Guarda o que a Staff e o contador veem (pagador, documento informado, valor, forma,
 * data); nada de cartão. O estado do provider só vale depois de relido na API (M6-07).
 */
export const payment = pgTable(
  'payment',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: 'restrict' }),
    checkoutSessionId: uuid().references(() => checkoutSession.id, { onDelete: 'restrict' }),
    provider: text().notNull().default('asaas'),
    providerPaymentId: text().notNull(),
    installmentId: text(),
    method: text().notNull(),
    amountCents: integer().notNull(),
    providerStatus: text().notNull(),
    paidAt: timestamp({ withTimezone: true }),
    /** Dados do pagador lidos do Asaas DEPOIS da confirmação (M6-08). O nome vai em claro; o CPF/CNPJ só CIFRADO. */
    payerName: text(),
    /** CPF/CNPJ cifrado em repouso (AES-GCM, chave versionada do Worker); abrir grava auditoria. */
    payerDocumentCiphertext: text(),
    payerDocumentNonce: text(),
    payerDocumentKeyVersion: integer(),
    /** Máscara para exibir por padrão (`•••.•••.•••-09`), calculada na gravação. */
    payerDocumentMasked: text(),
    payerInfoReadAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    unique('payment_provider_payment_unique').on(table.provider, table.providerPaymentId),
    index('payment_order_idx').on(table.orderId),
    check('payment_provider_check', sql`${table.provider} = 'asaas'`),
    check('payment_method_check', sql`${table.method} in ('pix', 'card')`),
    check('payment_amount_check', sql`${table.amountCents} > 0`),
    check(
      'payment_payer_document_check',
      sql`(${table.payerDocumentCiphertext} is null and ${table.payerDocumentNonce} is null and ${table.payerDocumentKeyVersion} is null and ${table.payerDocumentMasked} is null) or (${table.payerDocumentCiphertext} is not null and ${table.payerDocumentNonce} is not null and ${table.payerDocumentKeyVersion} is not null and ${table.payerDocumentMasked} is not null)`,
    ),
    check(
      'payment_provider_payment_id_check',
      sql`char_length(${table.providerPaymentId}) between 1 and 100`,
    ),
  ],
);

/**
 * Fato financeiro APPEND-ONLY (M6-01): proveniência (webhook, reconciliação, API, ação administrativa) de tudo que
 * mexe no dinheiro ou no pedido. Gatilho recusa UPDATE e DELETE (o papel de runtime não tem TRUNCATE; um gatilho de TRUNCATE quebraria a limpeza em cascata dos testes de outros marcos). `(kind, provider_event_id)` único (quando
 * há id do provider) faz cada evidência aplicar os efeitos uma só vez.
 */
export const financialEvent = pgTable(
  'financial_event',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid().references(() => purchaseOrder.id, { onDelete: 'restrict' }),
    paymentId: uuid().references(() => payment.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    source: text().notNull(),
    providerEventId: text(),
    details: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('financial_event_evidence_idx')
      .on(table.kind, table.providerEventId)
      .where(sql`${table.providerEventId} is not null`),
    index('financial_event_order_idx').on(table.orderId, table.createdAt),
    index('financial_event_payment_idx').on(table.paymentId, table.createdAt),
    check('financial_event_kind_check', sql`char_length(${table.kind}) between 1 and 80`),
    check(
      'financial_event_source_check',
      sql`${table.source} in ('webhook', 'reconciliation', 'api', 'admin')`,
    ),
  ],
);

/**
 * Revisão financeira (M6-07; resolução e telas no M6-04): valor, identidade ou estado divergente, correlação incerta,
 * status desconhecido ou resultado ambíguo. Bloqueia a concessão insegura (o pedido vai a `review`); a REVOGAÇÃO por
 * reembolso ou chargeback nunca espera revisão. No máximo UMA revisão ABERTA por (tipo, pagamento do provider).
 */
export const financialReview = pgTable(
  'financial_review',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid().references(() => purchaseOrder.id, { onDelete: 'restrict' }),
    providerPaymentId: text(),
    type: text().notNull(),
    state: text().notNull().default('open'),
    reason: text().notNull(),
    details: jsonb().notNull().default({}),
    resolution: text(),
    resolvedBy: text().references(() => user.id, { onDelete: 'set null' }),
    resolvedAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    uniqueIndex('financial_review_open_idx')
      .on(
        table.type,
        sql`coalesce(${table.providerPaymentId}, '')`,
        sql`coalesce(${table.orderId}::text, '')`,
      )
      .where(sql`${table.state} = 'open'`),
    index('financial_review_state_idx').on(table.state, table.createdAt),
    check(
      'financial_review_type_check',
      sql`${table.type} in ('amount_mismatch', 'terminal_conflict', 'event_anomaly', 'partial_refund', 'uncertain_result', 'unknown_checkout', 'duplicate_purchase')`,
    ),
    check('financial_review_state_check', sql`${table.state} in ('open', 'resolved')`),
    check(
      'financial_review_resolved_check',
      sql`(${table.state} = 'open' and ${table.resolvedAt} is null) or (${table.state} = 'resolved' and ${table.resolvedAt} is not null and ${table.resolution} is not null)`,
    ),
  ],
);

/**
 * Pedido de reembolso INTEGRAL (M6-05). Durável: o executor (intenção `finance.refund`) lê daqui, nunca chama o
 * provider dentro de transação e nunca reenvia às cegas (`unknown` só relê). No máximo UM ativo por pedido (índice único
 * parcial). Sem campo de valor: é sempre o total. `reason` e quem pediu ficam para sempre (gatilho).
 */
export const refundRequest = pgTable(
  'refund_request',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: 'restrict' }),
    paymentId: uuid()
      .notNull()
      .references(() => payment.id, { onDelete: 'restrict' }),
    requestedBy: text()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    reason: text().notNull(),
    state: text().notNull().default('requested'),
    failureCode: text(),
    completedAt: timestamp({ withTimezone: true }),
    ...stamps,
  },
  (table) => [
    uniqueIndex('refund_request_active_idx')
      .on(table.orderId)
      .where(sql`${table.state} not in ('done', 'failed')`),
    index('refund_request_state_idx').on(table.state, table.createdAt),
    check(
      'refund_request_state_check',
      sql`${table.state} in ('requested', 'submitting', 'submitted', 'unknown', 'awaiting_external_authorization', 'done', 'failed')`,
    ),
    check('refund_request_reason_check', sql`char_length(${table.reason}) between 5 and 500`),
    check(
      'refund_request_done_check',
      sql`(${table.state} = 'done') = (${table.completedAt} is not null)`,
    ),
  ],
);
