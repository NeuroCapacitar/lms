import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { richTextFromParagraph } from '../../src/features/content/rich-text.ts';
import {
  createCourse,
  createOffer,
  setCourseStatus,
  setOfferStatus,
} from '../../src/server/catalog/catalog-store.ts';
import { publishCurriculum, saveDraft } from '../../src/server/catalog/curriculum-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M2-04 em Postgres 18 real: `GET /api/catalog/courses`. Só com sessão e termos aceitos, só cursos
 * publicados com currículo publicado, oferta pausada ou arquivada vira "encerrado" e a resposta não
 * traz campo interno (título interno, autoria, estado, id de oferta).
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

async function newStudent() {
  seq += 1;
  const user = tools.test.createUser({ email: `aluno${seq}@example.test`, name: `Aluno ${seq}` });
  await tools.test.saveUser(user);
  return (await tools.test.login({ userId: user.id })).headers;
}
const catalog = (headers?: Headers) => app().request('/api/catalog/courses', { headers }, env());
const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** Curso com título interno marcado, currículo publicado e, opcionalmente, oferta no estado pedido. */
async function makeCourse(options: {
  slug: string;
  internalTitle?: string;
  curriculum?: boolean;
  visibility?: 'draft' | 'published' | 'archived';
  offer?: { kind?: 'paid' | 'free'; status: 'draft' | 'active' | 'paused' | 'archived' };
}) {
  const db = tools.db;
  const id = await createCourse(db, {
    actorId: null,
    slug: options.slug,
    title: options.internalTitle ?? 'TÍTULO INTERNO SECRETO',
    sequenceMode: 'guided',
  });
  if (options.curriculum ?? true) {
    await saveDraft(db, {
      courseId: id,
      expectedRev: 0,
      details: {
        displayTitle: `Público ${options.slug}`,
        description: richTextFromParagraph(`Resumo de ${options.slug}`),
        workloadHours: 4,
      },
      modules: [
        { title: 'M1', dripDays: 0, lessons: [{ title: 'A1', isOptional: false, body: null }] },
      ],
    });
    await publishCurriculum(db, { actorId: null, courseId: id });
  }
  if (options.offer) {
    const kind = options.offer.kind ?? 'paid';
    const offerId = await createOffer(db, {
      actorId: null,
      courseId: id,
      name: 'Oferta interna',
      kind,
      priceCents: kind === 'free' ? 0 : 19_700,
      accessMonths: 12,
      maxInstallments: kind === 'free' ? 1 : 12,
    });
    const { status } = options.offer;
    if (status !== 'draft') {
      await setOfferStatus(db, { actorId: null, courseId: id, offerId, status: 'active' });
      if (status !== 'active') {
        await setOfferStatus(db, { actorId: null, courseId: id, offerId, status });
      }
    }
  }
  const visibility = options.visibility ?? 'published';
  if (visibility !== 'draft') {
    await setCourseStatus(db, { actorId: null, id, status: 'published' });
    if (visibility === 'archived') {
      await setCourseStatus(db, { actorId: null, id, status: 'archived' });
    }
  }
  return id;
}

describe('autorização', () => {
  it('sem sessão: 401 e nada de curso na resposta', async () => {
    await makeCourse({ slug: 'qualquer', offer: { status: 'active' } });
    const response = await catalog();
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: { code: 'unauthenticated' } });
  });

  it('com versão vigente dos termos não aceita: 403 terms_required; depois de aceitar: 200', async () => {
    await makeCourse({ slug: 'aberto', offer: { status: 'active' } });
    const headers = await newStudent();
    const [version] = await tools.db
      .insert(schema.legalDocumentVersion)
      .values({
        kind: 'terms',
        version: 'teste-m2-04',
        body: 'TEXTO PROVISÓRIO de teste',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      })
      .returning();
    try {
      const blocked = await catalog(headers);
      expect(blocked.status).toBe(403);
      expect(await json(blocked)).toEqual({ error: { code: 'terms_required' } });
    } finally {
      await tools.db.delete(schema.legalDocumentVersion);
    }
    expect(version).toBeDefined();
    expect((await catalog(headers)).status).toBe(200);
  });

  it('a resposta não é guardada em cache compartilhado', async () => {
    const response = await catalog(await newStudent());
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('o que aparece', () => {
  it('só publicado com currículo publicado; rascunho, arquivado e nunca publicado somem', async () => {
    await makeCourse({ slug: 'a-rascunho', visibility: 'draft', offer: { status: 'active' } });
    await makeCourse({ slug: 'b-arquivado', visibility: 'archived', offer: { status: 'active' } });
    await makeCourse({ slug: 'c-sem-curriculo', curriculum: false, offer: { status: 'active' } });
    await makeCourse({ slug: 'd-aberto', offer: { status: 'active' } });
    const body = await json(await catalog(await newStudent()));
    expect(body.courses.map((course: { slug: string }) => course.slug)).toEqual(['d-aberto']);
  });

  it('oferta pausada, arquivada, em rascunho ou ausente: "encerrado" e sem oferta', async () => {
    await makeCourse({ slug: 'e-pausada', offer: { status: 'paused' } });
    await makeCourse({ slug: 'f-arquivada', offer: { status: 'archived' } });
    await makeCourse({ slug: 'g-rascunho', offer: { status: 'draft' } });
    await makeCourse({ slug: 'h-sem-oferta' });
    const body = await json(await catalog(await newStudent()));
    expect(body.courses).toHaveLength(4);
    for (const course of body.courses) {
      expect(course).toMatchObject({ availability: 'closed', offer: null });
    }
  });

  it('curso aberto mostra título e resumo PUBLICADOS e o resumo da oferta', async () => {
    await makeCourse({ slug: 'i-pago', offer: { status: 'active' } });
    await makeCourse({ slug: 'j-gratis', offer: { kind: 'free', status: 'active' } });
    const body = await json(await catalog(await newStudent()));
    const [paid, free] = body.courses;
    expect(paid).toEqual({
      id: expect.any(String),
      slug: 'i-pago',
      title: 'Público i-pago',
      summary: 'Resumo de i-pago',
      workloadHours: 4,
      sequenceMode: 'guided',
      availability: 'open',
      offer: {
        id: expect.any(String),
        kind: 'paid',
        priceCents: 19_700,
        accessMonths: 12,
        maxInstallments: 12,
      },
      access: { hasAccess: false, reason: 'no_access', expiresAt: null },
      interested: false,
    });
    expect(free.offer).toEqual({
      id: expect.any(String),
      kind: 'free',
      priceCents: 0,
      accessMonths: 12,
      maxInstallments: 1,
    });
  });

  it('não vaza campo interno: título interno, autoria, estado, datas, ids e nome da oferta', async () => {
    await makeCourse({ slug: 'k-aberto', offer: { status: 'active' } });
    const response = await catalog(await newStudent());
    const text = await response.text();
    for (const forbidden of [
      'TÍTULO INTERNO SECRETO',
      'Oferta interna',
      'createdBy',
      'createdAt',
      'updatedAt',
      'firstPublishedAt',
      'status',
      'draft',
      'acquirable',
    ]) {
      expect(text, `a resposta não deve conter "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('o curso demonstrativo do seed aparece aberto, gratuito e por 3 meses', async () => {
    await seedDemoCourse(tools.db);
    const body = await json(await catalog(await newStudent()));
    expect(body.courses).toHaveLength(1);
    expect(body.courses[0]).toMatchObject({
      slug: 'curso-demonstrativo',
      title: 'Curso Demonstrativo',
      availability: 'open',
      offer: { kind: 'free', priceCents: 0, accessMonths: 3, maxInstallments: 1 },
    });
  });

  it('lista vazia quando nada é visível', async () => {
    const body = await json(await catalog(await newStudent()));
    expect(body).toEqual({ courses: [] });
  });
});
