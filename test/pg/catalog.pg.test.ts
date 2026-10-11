import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantCapability, grantRole } from '../../src/server/auth/access-store.ts';
import { getPublicCourse, listPublicCourses } from '../../src/server/catalog/catalog-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M2-01 em Postgres 18 real: Course e Offer. Invariantes comerciais em CHECK e gatilhos, comandos por
 * capability (`course.create`, `course.edit`, `offer.manage`), disponibilidade separada de
 * visibilidade e DTOs separados (público sem campos internos).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  await tools.db.execute(
    sql`truncate table lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => false });

async function newUser() {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}
async function newAdmin() {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'admin' });
  return { id: person.id, headers: (await tools.test.login({ userId: person.id })).headers };
}
async function newSupport(grants: string[] = []) {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'support' });
  for (const capability of grants) {
    await grantCapability(tools.db, { actorId: null, targetId: person.id, capability });
  }
  return { id: person.id, headers: (await tools.test.login({ userId: person.id })).headers };
}

function call(method: string, path: string, headers: Headers | undefined, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api/staff${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

const COURSE = { slug: 'protea-r', title: 'PROTEA-R (interno)', sequenceMode: 'guided' };
const PAID = {
  name: 'Anual',
  kind: 'paid',
  priceCents: 19_700,
  accessMonths: 12,
  maxInstallments: 12,
};
const FREE = { name: 'Gratuita', kind: 'free', accessMonths: 3 };

async function courseVia(admin: { headers: Headers }, body: object = COURSE) {
  const response = await call('POST', '/courses', admin.headers, body);
  expect(response.status).toBe(201);
  return (await json(response)).id as string;
}
async function offerVia(admin: { headers: Headers }, courseId: string, body: object = PAID) {
  const response = await call('POST', `/courses/${courseId}/offers`, admin.headers, body);
  expect(response.status).toBe(201);
  return (await json(response)).id as string;
}
const offerStatus = (
  admin: { headers: Headers },
  courseId: string,
  offerId: string,
  status: string,
) => call('POST', `/courses/${courseId}/offers/${offerId}/status`, admin.headers, { status });
const courseStatus = (admin: { headers: Headers }, courseId: string, status: string) =>
  call('POST', `/courses/${courseId}/status`, admin.headers, { status });
/** Publica um currículo mínimo (um módulo, uma aula obrigatória) pela API, como a Staff faria. */
async function withCurriculum(admin: { headers: Headers }, courseId: string) {
  const draft = await json(await call('GET', `/courses/${courseId}/draft`, admin.headers));
  const saved = await call('PUT', `/courses/${courseId}/draft`, admin.headers, {
    expectedRev: draft.rev,
    details: {
      displayTitle: 'Título público',
      description: 'Descrição pública',
      workloadHours: 10,
    },
    modules: [
      {
        title: 'Módulo 1',
        dripDays: 0,
        lessons: [{ title: 'Aula 1', isOptional: false, body: null }],
      },
    ],
  });
  expect(saved.status).toBe(200);
  const published = await call('POST', `/courses/${courseId}/publish`, admin.headers, {});
  expect(published.status).toBe(200);
}
const auditFor = async (targetId: string) =>
  (await tools.db.select().from(schema.auditLog)).filter((row) => row.targetId === targetId);

/** O Drizzle embrulha o erro do pg: a mensagem da violação fica em `cause`. */
async function expectViolation(work: PromiseLike<unknown>, pattern: RegExp) {
  const error = (await work.then(
    () => null,
    (reason: unknown) => reason,
  )) as { message?: string; cause?: { message?: string } } | null;
  expect(error, 'a escrita deveria ser recusada').not.toBeNull();
  expect(`${error?.message} ${error?.cause?.message}`).toMatch(pattern);
}

const rawCourse = (values: Partial<typeof schema.course.$inferInsert> = {}) =>
  tools.db
    .insert(schema.course)
    .values({ slug: `curso-${(seq += 1)}`, title: 'T', sequenceMode: 'free', ...values });

describe('o banco recusa o que o catálogo não permite (CHECK)', () => {
  it('curso: slug mal formado, título vazio, sequência ausente ou desconhecida, estado desconhecido', async () => {
    for (const slug of ['Curso-1', 'curso_1', 'ab', '-abc', 'abc-', 'a--b', 'a'.repeat(81)]) {
      await expectViolation(rawCourse({ slug }), /course_slug_format_check/);
    }
    await expectViolation(rawCourse({ title: '   ' }), /course_title_check/);
    await expectViolation(rawCourse({ sequenceMode: 'qualquer' }), /course_sequence_mode_check/);
    await expectViolation(
      tools.db.execute(`insert into course (slug, title) values ('sem-sequencia', 'T')` as never),
      /sequence_mode|not-null/i,
    );
    await expectViolation(rawCourse({ status: 'oculto' }), /course_status_check/);
  });

  it('curso: slug duplicado falha', async () => {
    await rawCourse({ slug: 'mesmo-slug' });
    await expectViolation(rawCourse({ slug: 'mesmo-slug' }), /course_slug_unique/);
  });

  it('oferta: preço, prazo, parcelas, moeda, modalidade e estado', async () => {
    const [parent] = await rawCourse({ slug: 'pai-das-ofertas' }).returning();
    const base = {
      courseId: parent!.id,
      name: 'O',
      kind: 'paid',
      priceCents: 1000,
      accessMonths: 12,
      maxInstallments: 1,
    };
    const insert = (values: Partial<typeof schema.offer.$inferInsert>) =>
      tools.db.insert(schema.offer).values({ ...base, ...values });
    await expectViolation(insert({ priceCents: -1 }), /offer_price_check/);
    await expectViolation(insert({ kind: 'free', priceCents: 500 }), /offer_price_check/);
    await expectViolation(insert({ kind: 'paid', priceCents: 0 }), /offer_price_check/);
    for (const accessMonths of [0, -1, 601]) {
      await expectViolation(insert({ accessMonths }), /offer_access_months_check/);
    }
    await expectViolation(
      tools.db.execute(
        `insert into offer (course_id, name, kind, price_cents) values ('${parent!.id}', 'O', 'paid', 1000)` as never,
      ),
      /access_months|not-null/i,
    );
    for (const maxInstallments of [0, 13]) {
      await expectViolation(insert({ maxInstallments }), /offer_installments_check/);
    }
    await expectViolation(
      insert({ kind: 'free', priceCents: 0, maxInstallments: 2 }),
      /offer_installments_check/,
    );
    await expectViolation(insert({ currency: 'USD' }), /offer_currency_check/);
    await expectViolation(insert({ kind: 'bundle' }), /offer_kind_check/);
    await expectViolation(insert({ status: 'open' }), /offer_status_check/);
    await expectViolation(insert({ name: '  ' }), /offer_name_check/);
    // e a oferta válida entra
    await insert({});
    await insert({ kind: 'free', priceCents: 0, accessMonths: 1, maxInstallments: 1 });
  });

  it('oferta sem curso ou de curso inexistente é recusada; curso com oferta não se apaga', async () => {
    await expectViolation(
      tools.db.insert(schema.offer).values({
        courseId: '00000000-0000-4000-8000-000000000000',
        name: 'O',
        kind: 'free',
        priceCents: 0,
        accessMonths: 1,
      }),
      /offer_course_id_course_id_fk|foreign key/,
    );
    const [parent] = await rawCourse({ slug: 'com-oferta' }).returning();
    await tools.db
      .insert(schema.offer)
      .values({ courseId: parent!.id, name: 'O', kind: 'free', priceCents: 0, accessMonths: 1 });
    await expectViolation(
      tools.db.delete(schema.course).where(eq(schema.course.id, parent!.id)),
      /violates RESTRICT setting of foreign key constraint/,
    );
  });
});

describe('gatilhos do catálogo', () => {
  it('a primeira publicação congela o slug, é gravada uma vez só e o curso nunca volta a rascunho', async () => {
    const [created] = await rawCourse({ slug: 'antes' }).returning();
    expect(created!.firstPublishedAt).toBeNull();
    await tools.db
      .update(schema.course)
      .set({ slug: 'depois' })
      .where(eq(schema.course.id, created!.id));

    await tools.db
      .update(schema.course)
      .set({ status: 'published' })
      .where(eq(schema.course.id, created!.id));
    const [published] = await tools.db
      .select()
      .from(schema.course)
      .where(eq(schema.course.id, created!.id));
    expect(published!.firstPublishedAt).toBeInstanceOf(Date);

    await expectViolation(
      tools.db
        .update(schema.course)
        .set({ slug: 'novo-slug' })
        .where(eq(schema.course.id, created!.id)),
      /slug_locked/,
    );
    await expectViolation(
      tools.db
        .update(schema.course)
        .set({ status: 'draft' })
        .where(eq(schema.course.id, created!.id)),
      /course_back_to_draft/,
    );
    // arquivar e republicar não regrava nem apaga a data da primeira publicação
    await tools.db
      .update(schema.course)
      .set({ status: 'archived' })
      .where(eq(schema.course.id, created!.id));
    await tools.db
      .update(schema.course)
      .set({ status: 'published', firstPublishedAt: null })
      .where(eq(schema.course.id, created!.id));
    const [again] = await tools.db
      .select()
      .from(schema.course)
      .where(eq(schema.course.id, created!.id));
    expect(again!.firstPublishedAt).toEqual(published!.firstPublishedAt);
  });

  it('curso inserido já publicado registra a primeira publicação', async () => {
    const [created] = await rawCourse({ status: 'published' }).returning();
    expect(created!.firstPublishedAt).toBeInstanceOf(Date);
  });

  it('oferta: não troca de curso, não muda de modalidade fora do rascunho e arquivada é terminal', async () => {
    const [one] = await rawCourse().returning();
    const [two] = await rawCourse().returning();
    const [created] = await tools.db
      .insert(schema.offer)
      .values({ courseId: one!.id, name: 'O', kind: 'free', priceCents: 0, accessMonths: 1 })
      .returning();
    await expectViolation(
      tools.db
        .update(schema.offer)
        .set({ courseId: two!.id })
        .where(eq(schema.offer.id, created!.id)),
      /offer_course_locked/,
    );
    // em rascunho a modalidade ainda pode mudar (com os termos coerentes)
    await tools.db
      .update(schema.offer)
      .set({ kind: 'paid', priceCents: 5000 })
      .where(eq(schema.offer.id, created!.id));
    await tools.db
      .update(schema.offer)
      .set({ status: 'active' })
      .where(eq(schema.offer.id, created!.id));
    await expectViolation(
      tools.db
        .update(schema.offer)
        .set({ kind: 'free', priceCents: 0 })
        .where(eq(schema.offer.id, created!.id)),
      /offer_kind_locked/,
    );
    await tools.db
      .update(schema.offer)
      .set({ status: 'archived' })
      .where(eq(schema.offer.id, created!.id));
    await expectViolation(
      tools.db
        .update(schema.offer)
        .set({ status: 'active' })
        .where(eq(schema.offer.id, created!.id)),
      /offer_archived/,
    );
    await expectViolation(
      tools.db
        .update(schema.offer)
        .set({ priceCents: 9999 })
        .where(eq(schema.offer.id, created!.id)),
      /offer_archived/,
    );
  });
});

describe('autorização por capability (direto pela API)', () => {
  it('anônimo 401; aluno 403; Suporte sem grant lê mas não escreve nada', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    const offerId = await offerVia(admin, courseId);
    const student = await newUser();
    const support = await newSupport();
    const writes: [string, string, unknown][] = [
      ['POST', '/courses', COURSE],
      ['PATCH', `/courses/${courseId}`, { title: 'Novo' }],
      ['POST', `/courses/${courseId}/status`, { status: 'published' }],
      ['POST', `/courses/${courseId}/offers`, PAID],
      ['PATCH', `/courses/${courseId}/offers/${offerId}`, { priceCents: 100 }],
      ['POST', `/courses/${courseId}/offers/${offerId}/status`, { status: 'active' }],
    ];
    for (const [method, path, body] of writes) {
      expect((await call(method, path, undefined, body)).status, `anônimo ${path}`).toBe(401);
      expect((await call(method, path, student.headers, body)).status, `aluno ${path}`).toBe(403);
      const denied = await call(method, path, support.headers, body);
      expect(denied.status, `suporte ${method} ${path}`).toBe(403);
      expect(await json(denied)).toEqual({ error: { code: 'forbidden' } });
    }
    expect((await call('GET', '/courses', undefined)).status).toBe(401);
    expect((await call('GET', '/courses', student.headers)).status).toBe(403);
    expect((await call('GET', '/courses', support.headers)).status).toBe(200);
    expect((await call('GET', `/courses/${courseId}`, support.headers)).status).toBe(200);
  });

  it('Suporte com course.edit edita o curso e muda a visibilidade, mas NÃO mexe em oferta', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    const offerId = await offerVia(admin, courseId);
    const support = await newSupport(['course.edit']);
    expect(
      (await call('PATCH', `/courses/${courseId}`, support.headers, { title: 'Novo título' }))
        .status,
    ).toBe(200);
    expect((await courseStatus(support, courseId, 'published')).status).toBe(200);
    expect(
      (await call('POST', '/courses', support.headers, { ...COURSE, slug: 'outro-curso' })).status,
    ).toBe(403);
    expect((await call('POST', `/courses/${courseId}/offers`, support.headers, FREE)).status).toBe(
      403,
    );
    expect(
      (
        await call('PATCH', `/courses/${courseId}/offers/${offerId}`, support.headers, {
          priceCents: 1,
        })
      ).status,
    ).toBe(403);
    expect((await offerStatus(support, courseId, offerId, 'active')).status).toBe(403);
    const [row] = await tools.db.select().from(schema.offer).where(eq(schema.offer.id, offerId));
    expect(row).toMatchObject({ priceCents: 19_700, status: 'draft' });
  });
});

describe('comandos do Admin', () => {
  it('criar curso: 201, slug duplicado 409, corpo inválido 400 (sequência obrigatória, sem padrão)', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    const [row] = await tools.db.select().from(schema.course).where(eq(schema.course.id, courseId));
    expect(row).toMatchObject({ status: 'draft', createdBy: admin.id, sequenceMode: 'guided' });
    const duplicate = await call('POST', '/courses', admin.headers, COURSE);
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toEqual({ error: { code: 'slug_taken' } });
    for (const body of [
      { slug: 'Mau Slug', title: 'T', sequenceMode: 'free' },
      { slug: 'sem-sequencia', title: 'T' },
      { slug: 'sem-titulo', title: '  ', sequenceMode: 'free' },
      { ...COURSE, slug: 'extra', status: 'published' },
    ]) {
      expect(
        (await call('POST', '/courses', admin.headers, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect((await call('POST', '/courses', admin.headers, null)).status).toBe(400);
    expect(await auditFor(courseId)).toHaveLength(1);
  });

  it('criar oferta paga e gratuita; termos inválidos são 400 com os campos; curso arquivado não ganha oferta', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    const paid = await offerVia(admin, courseId, PAID);
    const free = await offerVia(admin, courseId, FREE);
    const rows = await tools.db
      .select()
      .from(schema.offer)
      .where(eq(schema.offer.courseId, courseId));
    expect(rows.find((r) => r.id === paid)).toMatchObject({
      kind: 'paid',
      priceCents: 19_700,
      currency: 'BRL',
      status: 'draft',
    });
    expect(rows.find((r) => r.id === free)).toMatchObject({
      kind: 'free',
      priceCents: 0,
      maxInstallments: 1,
      accessMonths: 3,
    });

    const invalid: [object, string[]][] = [
      [{ ...PAID, priceCents: -5 }, ['priceCents']],
      [{ ...PAID, priceCents: 0 }, ['priceCents']],
      [{ ...FREE, priceCents: 100 }, ['priceCents']],
      [{ ...PAID, accessMonths: 0 }, ['accessMonths']],
      [{ ...PAID, maxInstallments: 13 }, ['maxInstallments']],
      [{ ...FREE, maxInstallments: 3 }, ['maxInstallments']],
    ];
    for (const [body, fields] of invalid) {
      const response = await call('POST', `/courses/${courseId}/offers`, admin.headers, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await json(response)).error.fields).toEqual(fields);
    }
    expect(
      (
        await call('POST', `/courses/${courseId}/offers`, admin.headers, {
          ...FREE,
          status: 'active',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/courses/${courseId}/offers`, admin.headers, {
          ...PAID,
          currency: 'USD',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          `/courses/00000000-0000-4000-8000-000000000000/offers`,
          admin.headers,
          PAID,
        )
      ).status,
    ).toBe(404);
    expect((await call('POST', `/courses/nao-uuid/offers`, admin.headers, PAID)).status).toBe(404);

    await courseStatus(admin, courseId, 'archived');
    const archived = await call('POST', `/courses/${courseId}/offers`, admin.headers, FREE);
    expect(archived.status).toBe(409);
    expect(await json(archived)).toEqual({ error: { code: 'course_archived' } });
  });

  it('editar oferta confere a combinação com a modalidade, audita antes e depois e recusa arquivada', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    const paid = await offerVia(admin, courseId, PAID);
    const free = await offerVia(admin, courseId, FREE);
    const edit = (id: string, body: unknown) =>
      call('PATCH', `/courses/${courseId}/offers/${id}`, admin.headers, body);

    expect(
      (await edit(paid, { priceCents: 24_900, maxInstallments: 6, name: 'Anual 2026' })).status,
    ).toBe(200);
    const [row] = await tools.db.select().from(schema.offer).where(eq(schema.offer.id, paid));
    expect(row).toMatchObject({
      name: 'Anual 2026',
      priceCents: 24_900,
      maxInstallments: 6,
      accessMonths: 12,
    });
    const entry = (await auditFor(paid)).find((r) => r.action === 'offer.update')!;
    expect(entry.actorId).toBe(admin.id);
    expect(entry.details).toMatchObject({
      before: { priceCents: 19_700, maxInstallments: 12 },
      after: { priceCents: 24_900, maxInstallments: 6 },
    });

    for (const [id, body] of [
      [paid, { priceCents: 0 }],
      [free, { priceCents: 100 }],
      [free, { maxInstallments: 2 }],
      [paid, { accessMonths: 0 }],
      [paid, { kind: 'free' }],
      [paid, {}],
    ] as [string, object][]) {
      expect((await edit(id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await edit('00000000-0000-4000-8000-000000000000', { priceCents: 1 })).status).toBe(
      404,
    );
    await offerStatus(admin, courseId, paid, 'archived');
    const archived = await edit(paid, { priceCents: 100 });
    expect(archived.status).toBe(409);
    expect(await json(archived)).toEqual({ error: { code: 'offer_archived' } });
  });

  it('estados da oferta: ativar, pausar e reativar; transições inválidas 409; arquivada é terminal', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    const offerId = await offerVia(admin, courseId);
    const to = (status: string) => offerStatus(admin, courseId, offerId, status);
    expect((await to('paused')).status).toBe(409);
    expect((await to('draft')).status).toBe(409);
    expect((await to('active')).status).toBe(200);
    expect((await to('paused')).status).toBe(200);
    expect((await to('active')).status).toBe(200);
    expect((await to('archived')).status).toBe(200);
    for (const status of ['draft', 'active', 'paused', 'archived']) {
      const response = await to(status);
      expect(response.status, status).toBe(409);
      expect(await json(response)).toEqual({ error: { code: 'invalid_transition' } });
    }
    expect((await to('inexistente')).status).toBe(400);
    const actions = (await auditFor(offerId)).map((r) => r.action);
    expect(actions.filter((a) => a === 'offer.status')).toHaveLength(4);
    expect(actions).toContain('offer.create');
  });

  it('estados do curso e slug: editável antes da primeira publicação, congelado depois', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    expect(
      (await call('PATCH', `/courses/${courseId}`, admin.headers, { slug: 'novo-antes' })).status,
    ).toBe(200);
    expect((await call('PATCH', `/courses/${courseId}`, admin.headers, {})).status).toBe(400);
    const other = await courseVia(admin, { ...COURSE, slug: 'outro-curso' });
    const taken = await call('PATCH', `/courses/${other}`, admin.headers, { slug: 'novo-antes' });
    expect(taken.status).toBe(409);
    expect(await json(taken)).toEqual({ error: { code: 'slug_taken' } });

    expect((await courseStatus(admin, courseId, 'published')).status).toBe(200);
    const locked = await call('PATCH', `/courses/${courseId}`, admin.headers, {
      slug: 'depois-de-publicar',
    });
    expect(locked.status).toBe(409);
    expect(await json(locked)).toEqual({ error: { code: 'slug_locked' } });
    expect(
      (await call('PATCH', `/courses/${courseId}`, admin.headers, { title: 'Só o título' })).status,
    ).toBe(200);
    expect((await courseStatus(admin, courseId, 'draft')).status).toBe(409);
    expect((await courseStatus(admin, courseId, 'archived')).status).toBe(200);
    expect((await courseStatus(admin, courseId, 'published')).status).toBe(200);
    const detail = await json(await call('GET', `/courses/${courseId}`, admin.headers));
    expect(detail).toMatchObject({ slug: 'novo-antes', title: 'Só o título', status: 'published' });
    expect(detail.firstPublishedAt).toBeTruthy();
  });
});

describe('disponibilidade x visibilidade e DTOs', () => {
  it('só oferta ativa de curso publicado é adquirível; o curso aparece mesmo sem oferta ativa', async () => {
    const admin = await newAdmin();
    // rascunho com oferta ativa: invisível
    const draft = await courseVia(admin, { ...COURSE, slug: 'curso-rascunho' });
    const draftOffer = await offerVia(admin, draft);
    await offerStatus(admin, draft, draftOffer, 'active');
    // publicado, sem oferta ativa (rascunho e pausada): visível, não adquirível
    const quiet = await courseVia(admin, { ...COURSE, slug: 'curso-sem-oferta' });
    await offerVia(admin, quiet);
    const paused = await offerVia(admin, quiet, FREE);
    await offerStatus(admin, quiet, paused, 'active');
    await offerStatus(admin, quiet, paused, 'paused');
    await courseStatus(admin, quiet, 'published');
    // publicado e com oferta ativa: adquirível (as demais ofertas ficam de fora)
    const open = await courseVia(admin, { ...COURSE, slug: 'curso-aberto', sequenceMode: 'free' });
    const active = await offerVia(admin, open, PAID);
    await offerStatus(admin, open, active, 'active');
    const hidden = await offerVia(admin, open, FREE);
    await offerStatus(admin, open, hidden, 'archived');
    await courseStatus(admin, open, 'published');
    await withCurriculum(admin, open);
    // publicado, com oferta ativa, mas SEM currículo publicado: visível e NÃO adquirível
    const bare = await courseVia(admin, { ...COURSE, slug: 'curso-sem-curriculo' });
    const bareOffer = await offerVia(admin, bare);
    await offerStatus(admin, bare, bareOffer, 'active');
    await courseStatus(admin, bare, 'published');
    // arquivado: some
    const gone = await courseVia(admin, { ...COURSE, slug: 'curso-arquivado' });
    const goneOffer = await offerVia(admin, gone);
    await offerStatus(admin, gone, goneOffer, 'active');
    await courseStatus(admin, gone, 'published');
    await courseStatus(admin, gone, 'archived');

    const list = await listPublicCourses(tools.db);
    expect(list.map((c) => c.slug)).toEqual([
      'curso-aberto',
      'curso-sem-curriculo',
      'curso-sem-oferta',
    ]);
    expect(list[0]).toMatchObject({ acquirable: true, sequenceMode: 'free' });
    expect(list[0]!.offers).toEqual([
      {
        id: active,
        name: 'Anual',
        kind: 'paid',
        priceCents: 19_700,
        accessMonths: 12,
        maxInstallments: 12,
      },
    ]);
    expect(list[0]!.content).toEqual({
      title: 'Título público',
      description: 'Descrição pública',
      workloadHours: 10,
    });
    expect(list[1]).toMatchObject({ acquirable: false, offers: [], content: null });
    expect(list[2]).toMatchObject({ acquirable: false, offers: [], content: null });
    expect(await getPublicCourse(tools.db, 'curso-rascunho')).toBeNull();
    expect(await getPublicCourse(tools.db, 'curso-arquivado')).toBeNull();
    expect((await getPublicCourse(tools.db, 'curso-aberto'))!.acquirable).toBe(true);

    // pausar a única oferta ativa tira a disponibilidade sem tirar o curso do catálogo
    await offerStatus(admin, open, active, 'paused');
    expect(await getPublicCourse(tools.db, 'curso-aberto')).toMatchObject({
      acquirable: false,
      offers: [],
    });
  }, 240_000);

  it('o DTO público não traz campos internos; o da Staff traz tudo', async () => {
    const admin = await newAdmin();
    const courseId = await courseVia(admin);
    const offerId = await offerVia(admin, courseId);
    await offerStatus(admin, courseId, offerId, 'active');
    await courseStatus(admin, courseId, 'published');
    await withCurriculum(admin, courseId);

    const publicDto = (await getPublicCourse(tools.db, 'protea-r'))!;
    expect(Object.keys(publicDto).sort()).toEqual([
      'acquirable',
      'content',
      'offers',
      'sequenceMode',
      'slug',
    ]);
    expect(Object.keys(publicDto.offers[0]!).sort()).toEqual(
      ['accessMonths', 'id', 'kind', 'maxInstallments', 'name', 'priceCents'].sort(),
    );
    const serialized = JSON.stringify(publicDto);
    for (const internal of [
      'interno',
      admin.id,
      'createdBy',
      'status',
      'draft',
      'firstPublishedAt',
      'currency',
    ]) {
      expect(serialized, internal).not.toContain(internal);
    }

    const staff = await json(await call('GET', `/courses/${courseId}`, admin.headers));
    expect(staff).toMatchObject({ id: courseId, title: 'PROTEA-R (interno)', status: 'published' });
    expect(staff.offers[0]).toMatchObject({
      status: 'active',
      currency: 'BRL',
      priceCents: 19_700,
    });
    const list = await json(await call('GET', '/courses', admin.headers));
    expect(list.courses).toHaveLength(1);
  });
});
