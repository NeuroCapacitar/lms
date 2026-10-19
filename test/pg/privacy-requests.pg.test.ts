import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import {
  ERASURE_POLICY_VERSION,
  POLICY_TABLES,
  REMOVED_TEXT,
  anonymizedEmail,
} from '../../src/features/privacy/erasure-policy.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { changeUserEmail } from '../../src/server/privacy/email-change-store.ts';
import { eraseUser, reapplyErasures } from '../../src/server/privacy/erasure-store.ts';
import { exportPersonData } from '../../src/server/privacy/export-store.ts';
import { createDemoCourse, type DemoFixture } from '../helpers/demo-course.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-10 em Postgres 18 real: os pedidos de privacidade que a Staff executa por script (exportar, excluir, trocar o
 * e-mail, reaplicar exclusões depois de uma restauração). O ensaio (`execute: false`) não grava nada; a exclusão tira a
 * identidade e retém o que a política manda reter; é idempotente; o registro e a auditoria NÃO levam nome nem e-mail.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const DAY = 86_400_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let demo: DemoFixture;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  demo = await createDemoCourse(tools.db);
}, 120_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

const CIPHERTEXT = 'Q0lQSEVSVEVYVC1ERS1URVNURQ==';
const PASSWORD_HASH = 'scrypt$hash-de-senha-de-teste';

interface Seeded {
  id: string;
  name: string;
  email: string;
  postId: string;
  orderId: string;
}

/** Uma pessoa COM dado em todas as tabelas que a política cobre (e um certificado, um pedido e um pagamento). */
async function seedPerson(options: { name?: string } = {}): Promise<Seeded> {
  seq += 1;
  const name = options.name ?? `Ana Souza ${seq}`;
  const email = `ana.souza.${seq}@exemplo.test`;
  const user = tools.test.createUser({ email, name });
  await tools.test.saveUser(user);
  const id = user.id as string;
  const now = new Date();

  // O perfil nasce por gatilho junto da conta; aqui só se preenche com dado pessoal.
  await tools.db
    .update(schema.profile)
    .set({
      displayName: name,
      certificateName: `${name} (certificado)`,
      certificateNameConfirmedAt: now,
    })
    .where(eq(schema.profile.userId, id));
  await tools.db.insert(schema.account).values({
    id: `acc-${seq}`,
    accountId: id,
    providerId: 'credential',
    userId: id,
    password: PASSWORD_HASH,
  });
  await tools.db.insert(schema.verification).values({
    id: `ver-${seq}`,
    identifier: `magic-${seq}`,
    value: JSON.stringify({ email, token: 'x' }),
    expiresAt: new Date(now.getTime() + DAY),
  });
  await tools.test.login({ userId: id });

  await grantEntitlement(tools.db, {
    userId: id,
    courseId: demo.courseId,
    offerId: demo.offerId,
    source: 'free_offer',
    sourceRef: `free:${id}:${demo.offerId}:0`,
    accessMonths: 3,
    startsAt: new Date(now.getTime() - 30 * DAY),
    grantedBy: id,
  });
  await tools.db.insert(schema.lessonCompletion).values({
    userId: id,
    courseId: demo.courseId,
    lessonId: demo.lessonIds[0]!,
  });
  await tools.db
    .insert(schema.courseCompletion)
    .values({ userId: id, courseId: demo.courseId, requiredTotal: 5 });
  await tools.db.insert(schema.certificate).values({
    userId: id,
    courseId: demo.courseId,
    code: `p${String(seq).padStart(21, 'x')}`,
    status: 'queued',
    snapshot: { version: 1, holderName: name },
  });
  await tools.db.insert(schema.termsAcceptance).values({
    userId: id,
    documentVersionId: await legalVersionId(),
    adultDeclared: true,
  });

  const [post] = await tools.db
    .insert(schema.discussionPost)
    .values({
      courseId: demo.courseId,
      lessonId: demo.lessonIds[0]!,
      authorId: id,
      body: `Texto da ${name} sobre a aula`,
    })
    .returning({ id: schema.discussionPost.id });
  await tools.db
    .insert(schema.discussionReport)
    .values({ postId: post!.id, reporterId: id, reason: `Denúncia escrita por ${name}` });
  await tools.db.insert(schema.supportRequest).values({
    userId: id,
    category: 'conta',
    message: `Meu nome é ${name} e preciso de ajuda`,
  });
  const [interest] = await tools.db
    .insert(schema.courseInterest)
    .values({ userId: id, courseId: demo.courseId })
    .returning({ id: schema.courseInterest.id });
  // O curso demonstrativo já tem um ciclo de disponibilidade; cria o primeiro só se não houver.
  const existing = await tools.db
    .select({ id: schema.courseAvailabilityCycle.id })
    .from(schema.courseAvailabilityCycle)
    .where(eq(schema.courseAvailabilityCycle.courseId, demo.courseId))
    .limit(1);
  const [cycle] = existing[0]
    ? existing
    : await tools.db
        .insert(schema.courseAvailabilityCycle)
        .values({ courseId: demo.courseId, number: 1 })
        .returning({ id: schema.courseAvailabilityCycle.id });
  await tools.db
    .insert(schema.courseInterestNotification)
    .values({ interestId: interest!.id, cycleId: cycle!.id });
  await tools.db.insert(schema.offlineOperation).values({
    userId: id,
    clientOperationId: crypto.randomUUID(),
    command: 'lesson.complete',
    outcome: 'applied',
  });

  const [order] = await tools.db
    .insert(schema.purchaseOrder)
    .values({
      userId: id,
      offerId: demo.offerId,
      courseId: demo.courseId,
      attemptId: crypto.randomUUID(),
      status: 'paid',
      courseTitle: 'Curso Demonstrativo',
      offerName: 'Oferta',
      priceCents: 9900,
      accessMonths: 3,
      maxInstallments: 1,
      paymentMethods: ['pix'],
      expiresAt: new Date(now.getTime() + DAY),
    })
    .returning({ id: schema.purchaseOrder.id });
  await tools.db.insert(schema.payment).values({
    orderId: order!.id,
    providerPaymentId: `pay_${seq}`,
    method: 'pix',
    amountCents: 9900,
    providerStatus: 'RECEIVED',
    paidAt: now,
    payerName: name,
    payerDocumentCiphertext: CIPHERTEXT,
    payerDocumentNonce: 'bm9uY2U=',
    payerDocumentKeyVersion: 1,
    payerDocumentMasked: '•••.•••.•••-09',
  });
  return { id, name, email, postId: post!.id, orderId: order!.id };
}

async function legalVersionId(): Promise<string> {
  const existing = await tools.db
    .select({ id: schema.legalDocumentVersion.id })
    .from(schema.legalDocumentVersion)
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await tools.db
    .insert(schema.legalDocumentVersion)
    .values({
      kind: 'terms',
      version: 'v1',
      body: 'Texto de teste',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    })
    .returning({ id: schema.legalDocumentVersion.id });
  return row!.id;
}

const count = async (table: string, where: ReturnType<typeof sql>) =>
  Number(
    (
      (await tools.db.execute(
        sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`,
      )) as unknown as {
        rows: { n: number }[];
      }
    ).rows[0]?.n,
  );

const userRow = async (id: string) =>
  (await tools.db.select().from(schema.user).where(eq(schema.user.id, id)))[0]!;

describe('a política cobre toda tabela que guarda uma pessoa', () => {
  it('toda tabela com FK para user ou com coluna user_id tem uma linha na política, e toda linha existe no banco', async () => {
    const rows = (
      (await tools.db.execute(sql`
        select distinct t.table_name from information_schema.tables t
         where t.table_schema = current_schema() and t.table_type = 'BASE TABLE'
           and (
             exists (select 1 from information_schema.columns c
                      where c.table_schema = t.table_schema and c.table_name = t.table_name
                        and c.column_name in ('user_id', 'author_id', 'reporter_id', 'requested_by', 'recipient_user_id'))
             or exists (select 1 from pg_constraint k
                         where k.contype = 'f' and k.conrelid = format('%I.%I', t.table_schema, t.table_name)::regclass
                           and k.confrelid = format('%I.%I', t.table_schema, 'user')::regclass)
           )`)) as unknown as { rows: { table_name: string }[] }
    ).rows.map((row) => row.table_name);
    const missing = rows.filter((name) => !POLICY_TABLES.has(name));
    expect(
      missing,
      `tabelas com pessoa e SEM linha em erasure-policy.ts: ${missing.join(', ')}`,
    ).toEqual([]);

    const existing = new Set(
      (
        (await tools.db.execute(
          sql`select table_name from information_schema.tables where table_schema = current_schema()`,
        )) as unknown as { rows: { table_name: string }[] }
      ).rows.map((row) => row.table_name),
    );
    const ghosts = [...POLICY_TABLES].filter((name) => !existing.has(name));
    expect(ghosts, `linhas da política para tabelas que não existem: ${ghosts.join(', ')}`).toEqual(
      [],
    );
  });
});

describe('ensaio (sem --execute)', () => {
  it('conta o que seria tocado e NÃO grava nada', async () => {
    const person = await seedPerson();
    const before = await userRow(person.id);
    const result = await eraseUser(tools.db, person.id, { execute: false });
    expect(result.outcome).toBe('dry_run');
    if (result.outcome !== 'dry_run') return;
    expect(result.counts).toMatchObject({
      accounts: 1,
      profile: 1,
      discussionPosts: 1,
      discussionReports: 1,
      supportRequests: 1,
      courseInterests: 1,
      offlineOperations: 1,
    });
    expect(result.counts.sessions).toBeGreaterThanOrEqual(1);
    expect(await userRow(person.id)).toEqual(before);
    expect(await count('profile', sql`user_id = ${person.id}`)).toBe(1);
  });
});

describe('exclusão', () => {
  it('tira a identidade, apaga credenciais e texto livre, e RETÉM o que a política manda reter', async () => {
    const person = await seedPerson();
    const other = await seedPerson();
    const result = await eraseUser(tools.db, person.id, {
      execute: true,
      operatorId: null,
      requestRef: 'CH-123',
    });
    expect(result.outcome).toBe('erased');
    if (result.outcome !== 'erased') return;

    // Identidade.
    const row = await userRow(person.id);
    expect(row).toMatchObject({
      name: REMOVED_TEXT,
      email: anonymizedEmail(person.id),
      image: null,
      emailVerified: false,
    });
    // Eliminado.
    expect(await count('session', sql`user_id = ${person.id}`)).toBe(0);
    expect(await count('account', sql`user_id = ${person.id}`)).toBe(0);
    expect(await count('profile', sql`user_id = ${person.id}`)).toBe(0);
    expect(await count('course_interest', sql`user_id = ${person.id}`)).toBe(0);
    expect(await count('offline_operation', sql`user_id = ${person.id}`)).toBe(0);
    expect(await count('verification', sql`value like ${`%${person.email}%`}`)).toBe(0);
    // Anonimizado (a linha fica, o texto some).
    const [post] = await tools.db
      .select()
      .from(schema.discussionPost)
      .where(eq(schema.discussionPost.id, person.postId));
    expect(post?.body).toBe(REMOVED_TEXT);
    const [report] = await tools.db
      .select()
      .from(schema.discussionReport)
      .where(eq(schema.discussionReport.postId, person.postId));
    expect(report?.reason).toBe(REMOVED_TEXT);
    const [support] = await tools.db
      .select()
      .from(schema.supportRequest)
      .where(eq(schema.supportRequest.userId, person.id));
    expect(support?.message).toBe(REMOVED_TEXT);
    expect(support?.category).toBe('conta');
    // Retido.
    expect(await count('enrollment', sql`user_id = ${person.id}`)).toBe(1);
    expect(await count('entitlement', sql`user_id = ${person.id}`)).toBe(1);
    expect(await count('lesson_completion', sql`user_id = ${person.id}`)).toBe(1);
    expect(await count('course_completion', sql`user_id = ${person.id}`)).toBe(1);
    expect(await count('certificate', sql`user_id = ${person.id}`)).toBe(1);
    expect(await count('terms_acceptance', sql`user_id = ${person.id}`)).toBe(1);
    expect(await count('purchase_order', sql`user_id = ${person.id}`)).toBe(1);
    expect(
      await count(
        'payment',
        sql`order_id = ${person.orderId}::uuid and payer_document_ciphertext = ${CIPHERTEXT}`,
      ),
    ).toBe(1);

    // O registro (que vai para FORA do banco) e a auditoria não levam nome nem e-mail.
    expect(result.entry).toMatchObject({
      version: 1,
      userId: person.id,
      policyVersion: ERASURE_POLICY_VERSION,
      requestRef: 'CH-123',
    });
    const audit = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, person.id));
    const serialized = JSON.stringify([result.entry, audit]);
    expect(serialized).not.toContain(person.email);
    expect(serialized).not.toContain(person.name);
    expect(audit.map((entry) => entry.action)).toContain('privacy.erasure');

    // Outra pessoa não foi tocada.
    expect((await userRow(other.id)).name).toBe(other.name);
    expect(await count('profile', sql`user_id = ${other.id}`)).toBe(1);
    const [otherPost] = await tools.db
      .select()
      .from(schema.discussionPost)
      .where(eq(schema.discussionPost.id, other.postId));
    expect(otherPost?.body).toContain(other.name);
  });

  it('é idempotente: repetir diz "já excluído" e não muda nada', async () => {
    const person = await seedPerson();
    expect((await eraseUser(tools.db, person.id, { execute: true })).outcome).toBe('erased');
    const after = await userRow(person.id);
    expect((await eraseUser(tools.db, person.id, { execute: true })).outcome).toBe(
      'already_erased',
    );
    expect(await userRow(person.id)).toEqual(after);
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, person.id));
    expect(audits.filter((entry) => entry.action === 'privacy.erasure')).toHaveLength(1);
  });

  it('pessoa inexistente e conta da Staff NÃO são excluídas', async () => {
    expect((await eraseUser(tools.db, 'nao-existe', { execute: true })).outcome).toBe('not_found');
    const staff = await seedPerson();
    await grantRole(tools.db, { actorId: null, targetId: staff.id, role: 'support' });
    expect((await eraseUser(tools.db, staff.id, { execute: true })).outcome).toBe('staff_account');
    expect((await userRow(staff.id)).name).toBe(staff.name);
  });
});

describe('reaplicar exclusões depois de restaurar um backup', () => {
  it('quem foi excluído e "voltou" na cópia restaurada é excluído de novo; quem não existe é só contado', async () => {
    const person = await seedPerson();
    const gone = crypto.randomUUID();
    const entries = [
      {
        version: 1 as const,
        userId: person.id,
        erasedAt: '2026-10-19T10:00:00.000Z',
        policyVersion: 'x',
        requestRef: 'CH-9',
        counts: {},
      },
      {
        version: 1 as const,
        userId: gone,
        erasedAt: '2026-10-19T10:00:00.000Z',
        policyVersion: 'x',
        requestRef: null,
        counts: {},
      },
    ];

    const dry = await reapplyErasures(tools.db, entries, { execute: false });
    expect(dry).toEqual({ reapplied: 0, alreadyErased: 0, absent: 1, staffAccounts: 0, dryRun: 1 });
    expect((await userRow(person.id)).name).toBe(person.name);

    const first = await reapplyErasures(tools.db, entries, { execute: true });
    expect(first).toEqual({
      reapplied: 1,
      alreadyErased: 0,
      absent: 1,
      staffAccounts: 0,
      dryRun: 0,
    });
    expect((await userRow(person.id)).email).toBe(anonymizedEmail(person.id));
    const second = await reapplyErasures(tools.db, entries, { execute: true });
    expect(second).toMatchObject({ reapplied: 0, alreadyErased: 1, absent: 1 });
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, person.id));
    expect(audits.find((entry) => entry.action === 'privacy.erasure')?.details).toMatchObject({
      reapplied: true,
    });
  });
});

describe('exportação', () => {
  it('lista os dados da pessoa por seção e NUNCA senha, token, sessão nem o documento cifrado', async () => {
    const person = await seedPerson();
    const data = await exportPersonData(tools.db, person.id);
    if (typeof data === 'string') throw new Error(`esperava dados, veio ${data}`);
    expect(data.person).toMatchObject({ id: person.id, name: person.name, email: person.email });
    for (const section of [
      'perfil',
      'matriculas',
      'acessos',
      'aulas_concluidas',
      'certificados',
      'pedidos',
      'pagamentos',
      'mensagens_nas_discussoes',
      'denuncias_feitas',
      'pedidos_de_suporte',
      'interesse_em_cursos',
      'aceite_dos_termos',
    ]) {
      expect(data.sections[section]?.length, section).toBeGreaterThanOrEqual(1);
    }
    expect(data.sections.pagamentos?.[0]).toMatchObject({
      payer_name: person.name,
      payer_document_masked: '•••.•••.•••-09',
    });
    const text = JSON.stringify(data);
    expect(text).not.toContain(CIPHERTEXT);
    expect(text).not.toContain(PASSWORD_HASH);
    expect(text).not.toMatch(/token|password|ciphertext/i);
  });

  it('pessoa inexistente e já excluída não geram arquivo', async () => {
    expect(await exportPersonData(tools.db, 'nao-existe')).toBe('not_found');
    const person = await seedPerson();
    await eraseUser(tools.db, person.id, { execute: true });
    expect(await exportPersonData(tools.db, person.id)).toBe('already_erased');
  });
});

describe('troca de e-mail', () => {
  it('troca (normalizado), verifica o novo, encerra sessões e links pendentes e audita SEM os endereços', async () => {
    const person = await seedPerson();
    const result = await changeUserEmail(tools.db, person.id, '  Novo.Endereco@Exemplo.TEST ', {
      execute: true,
      requestRef: 'CH-77',
    });
    expect(result.outcome).toBe('changed');
    const row = await userRow(person.id);
    expect(row.email).toBe('novo.endereco@exemplo.test');
    expect(row.emailVerified).toBe(true);
    expect(await count('session', sql`user_id = ${person.id}`)).toBe(0);
    expect(await count('verification', sql`value like ${`%${person.email}%`}`)).toBe(0);
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, person.id));
    const change = audits.find((entry) => entry.action === 'privacy.email_change');
    expect(change?.details).toEqual({ requestRef: 'CH-77' });
    expect(JSON.stringify(audits)).not.toContain('exemplo.test');
  });

  it('ensaio não grava; recusa e-mail inválido, igual, em uso (sem diferenciar maiúsculas), Staff e conta excluída', async () => {
    const person = await seedPerson();
    const other = await seedPerson();
    const before = await userRow(person.id);
    expect(
      (await changeUserEmail(tools.db, person.id, 'livre@exemplo.test', { execute: false }))
        .outcome,
    ).toBe('dry_run');
    expect(await userRow(person.id)).toEqual(before);
    expect(
      (await changeUserEmail(tools.db, person.id, 'isto não é e-mail', { execute: true })).outcome,
    ).toBe('invalid_email');
    expect(
      (await changeUserEmail(tools.db, person.id, person.email.toUpperCase(), { execute: true }))
        .outcome,
    ).toBe('same_email');
    expect(
      (await changeUserEmail(tools.db, person.id, other.email.toUpperCase(), { execute: true }))
        .outcome,
    ).toBe('email_in_use');
    expect(
      (await changeUserEmail(tools.db, 'nao-existe', 'x@exemplo.test', { execute: true })).outcome,
    ).toBe('not_found');
    const staff = await seedPerson();
    await grantRole(tools.db, { actorId: null, targetId: staff.id, role: 'admin' });
    expect(
      (await changeUserEmail(tools.db, staff.id, 'staff.novo@exemplo.test', { execute: true }))
        .outcome,
    ).toBe('staff_account');
    const gone = await seedPerson();
    await eraseUser(tools.db, gone.id, { execute: true });
    expect(
      (await changeUserEmail(tools.db, gone.id, 'volta@exemplo.test', { execute: true })).outcome,
    ).toBe('anonymized');
    expect((await userRow(person.id)).email).toBe(before.email);
  });
});
