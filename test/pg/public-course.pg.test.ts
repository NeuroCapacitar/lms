import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { richTextFromParagraph } from '../../src/features/content/rich-text.ts';
import {
  createCourse,
  createOffer,
  setCourseStatus,
  setOfferStatus,
} from '../../src/server/catalog/catalog-store.ts';
import { serveCoursePage } from '../../src/server/catalog/course-page.ts';
import { publishCurriculum, saveDraft } from '../../src/server/catalog/curriculum-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { loadPublicCoursePage } from '../../src/server/catalog/public-page.ts';
import { publicCourseRoutes } from '../../src/server/catalog/public-routes.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M2-06 em Postgres 18 real: a página pública do curso. A API e a página respondem IGUAL para slug
 * inexistente, rascunho, arquivado e sem currículo publicado; a canônica vem da configuração e o
 * conteúdo é só o publicado, sem título interno nem aulas.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://hub.example.test';
const SHELL =
  '<!doctype html><html><head><title>Hub</title></head><body><div id="root"></div></body></html>';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;

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
});

async function makeCourse(options: {
  slug: string;
  curriculum?: boolean;
  visibility?: 'draft' | 'published' | 'archived';
  offer?: { kind?: 'paid' | 'free'; status: 'active' | 'paused' | 'archived' };
}) {
  const db = tools.db;
  const id = await createCourse(db, {
    actorId: null,
    slug: options.slug,
    title: 'TÍTULO INTERNO SECRETO',
    sequenceMode: 'guided',
  });
  if (options.curriculum ?? true) {
    await saveDraft(db, {
      courseId: id,
      expectedRev: 0,
      details: {
        displayTitle: `Curso "${options.slug}" <b>`,
        description: richTextFromParagraph('Descrição pública do curso.'),
        workloadHours: 5,
      },
      modules: [
        {
          title: 'Módulo Um',
          dripDays: 0,
          lessons: [
            {
              title: 'AULA SECRETA 1',
              isOptional: false,
              body: richTextFromParagraph('CONTEÚDO DA AULA'),
            },
          ],
        },
        {
          title: 'Módulo Dois',
          dripDays: 7,
          lessons: [{ title: 'AULA SECRETA 2', isOptional: false, body: null }],
        },
      ],
    });
    await publishCurriculum(db, { actorId: null, courseId: id });
  }
  if (options.offer) {
    const kind = options.offer.kind ?? 'free';
    const offerId = await createOffer(db, {
      actorId: null,
      courseId: id,
      name: 'Oferta interna',
      kind,
      priceCents: kind === 'free' ? 0 : 19_700,
      accessMonths: 3,
      maxInstallments: kind === 'free' ? 1 : 12,
    });
    await setOfferStatus(db, { actorId: null, courseId: id, offerId, status: 'active' });
    if (options.offer.status !== 'active') {
      await setOfferStatus(db, {
        actorId: null,
        courseId: id,
        offerId,
        status: options.offer.status,
      });
    }
  }
  const visibility = options.visibility ?? 'published';
  if (visibility !== 'draft') {
    await setCourseStatus(db, { actorId: null, id, status: 'published' });
    if (visibility === 'archived')
      await setCourseStatus(db, { actorId: null, id, status: 'archived' });
  }
  return id;
}

const apiGet = (slug: string) =>
  publicCourseRoutes().request(`/courses/${slug}`, {}, {
    HYPERDRIVE: { connectionString: database.connectionString },
  } as unknown as Env);

describe('GET /api/public/courses/:slug', () => {
  it('curso publicado: DTO público com ementa só de títulos, sem aulas nem campo interno', async () => {
    await makeCourse({ slug: 'curso-aberto', offer: { status: 'active' } });
    const response = await apiGet('curso-aberto');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      id: expect.any(String),
      slug: 'curso-aberto',
      title: 'Curso "curso-aberto" <b>',
      description: richTextFromParagraph('Descrição pública do curso.'),
      workloadHours: 5,
      sequenceMode: 'guided',
      availability: 'open',
      offer: {
        id: expect.any(String),
        kind: 'free',
        priceCents: 0,
        accessMonths: 3,
        maxInstallments: 1,
      },
      syllabus: ['Módulo Um', 'Módulo Dois'],
    });
    const text = JSON.stringify(body);
    for (const forbidden of [
      'TÍTULO INTERNO',
      'AULA SECRETA',
      'CONTEÚDO DA AULA',
      'Oferta interna',
      'createdBy',
      'status',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('oferta pausada ou ausente: encerrado, sem oferta', async () => {
    await makeCourse({ slug: 'curso-pausado', offer: { status: 'paused' } });
    await makeCourse({ slug: 'curso-sem-oferta' });
    for (const slug of ['curso-pausado', 'curso-sem-oferta']) {
      const body = await (await apiGet(slug)).json();
      expect(body).toMatchObject({ availability: 'closed', offer: null });
    }
  });

  it('inexistente, rascunho, arquivado, sem currículo e slug malformado: 404 com corpo idêntico', async () => {
    await makeCourse({ slug: 'curso-rascunho', visibility: 'draft', offer: { status: 'active' } });
    await makeCourse({
      slug: 'curso-arquivado',
      visibility: 'archived',
      offer: { status: 'active' },
    });
    await makeCourse({
      slug: 'curso-sem-curriculo',
      curriculum: false,
      offer: { status: 'active' },
    });
    const responses = await Promise.all(
      [
        'curso-inexistente',
        'curso-rascunho',
        'curso-arquivado',
        'curso-sem-curriculo',
        'Mau%20Slug',
        'x',
      ].map(apiGet),
    );
    const bodies = await Promise.all(responses.map((response) => response.text()));
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe('{"error":{"code":"not_found"}}');
  });

  it('o curso demonstrativo do seed tem página pública com 3 módulos', async () => {
    await seedDemoCourse(tools.db);
    const page = await loadPublicCoursePage(tools.db, 'curso-demonstrativo');
    expect(page).toMatchObject({ title: 'Curso Demonstrativo', availability: 'open' });
    expect(page!.syllabus).toHaveLength(3);
  });
});

describe('página /cursos/:slug (meta tags)', () => {
  const env = (base = BASE_URL) =>
    ({
      APP_BASE_URL: base,
      HYPERDRIVE: { connectionString: database.connectionString },
      ASSETS: {
        fetch: async () => new Response(SHELL, { headers: { 'content-type': 'text/html' } }),
      },
    }) as unknown as Env;

  /** O `inject` de teste devolve o que o Worker injetaria (no Node não há HTMLRewriter). */
  const deps = (overrides: Partial<Parameters<typeof serveCoursePage>[2]> = {}) => ({
    loadCourse: (_env: Env, slug: string) => loadPublicCoursePage(tools.db, slug),
    inject: (_shell: Response, meta: unknown, status: number) =>
      new Response(JSON.stringify({ meta }), { status }),
    onError: () => undefined,
    ...overrides,
  });
  const page = (path: string, host = 'hub.example.test', overrides = {}) =>
    serveCoursePage(new Request(`https://${host}${path}`), env(), deps(overrides));

  it('curso publicado: meta do curso com canônica da configuração', async () => {
    await makeCourse({ slug: 'curso-aberto', offer: { status: 'active' } });
    const response = await page('/cursos/curso-aberto');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      meta: {
        title: 'Curso "curso-aberto" <b> | NeuroCapacitar',
        description: 'Descrição pública do curso.',
        canonical: 'https://hub.example.test/cursos/curso-aberto',
        image: 'https://hub.example.test/og-default.png',
      },
    });
  });

  it('cabeçalho Host forjado não altera a canônica', async () => {
    await makeCourse({ slug: 'curso-aberto', offer: { status: 'active' } });
    const forged = (await (await page('/cursos/curso-aberto', 'evil.example')).json()) as {
      meta: { canonical: string };
    };
    expect(forged.meta.canonical).toBe('https://hub.example.test/cursos/curso-aberto');
    expect(JSON.stringify(forged)).not.toContain('evil.example');
  });

  it('slug inexistente, rascunho, arquivado e sem currículo: a MESMA resposta 404 e meta genérica', async () => {
    await makeCourse({ slug: 'curso-rascunho', visibility: 'draft', offer: { status: 'active' } });
    await makeCourse({
      slug: 'curso-arquivado',
      visibility: 'archived',
      offer: { status: 'active' },
    });
    await makeCourse({
      slug: 'curso-sem-curriculo',
      curriculum: false,
      offer: { status: 'active' },
    });
    const responses = await Promise.all(
      ['curso-inexistente', 'curso-rascunho', 'curso-arquivado', 'curso-sem-curriculo'].map(
        (slug) => page(`/cursos/${slug}`),
      ),
    );
    const bodies = await Promise.all(responses.map((response) => response.text()));
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('NeuroCapacitar Hub');
    expect(bodies[0]).not.toContain('curso-');
    expect(bodies[0]).not.toContain('SECRETO');
  });

  it('caminho que não é /cursos/:slug válido passa a SPA como está, sem consultar o banco', async () => {
    let queried = false;
    const guarded = deps({ loadCourse: async () => ((queried = true), null) });
    for (const path of ['/cursos/', '/cursos/a/b', '/cursos/Mau Slug', '/cursos/x']) {
      const response = await serveCoursePage(
        new Request(`https://hub.example.test${path}`),
        env(),
        guarded,
      );
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toBe(SHELL);
    }
    expect(queried).toBe(false);
  });

  it('falha no banco não derruba a página: SPA com meta genérica e status 200, erro registrado', async () => {
    const errors: unknown[] = [];
    const response = await page('/cursos/curso-aberto', 'hub.example.test', {
      loadCourse: async () => {
        throw new Error('banco fora');
      },
      onError: (error: unknown) => errors.push(error),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { meta: { title: string } }).meta.title).toBe(
      'NeuroCapacitar Hub',
    );
    expect(errors).toHaveLength(1);
  });
});
