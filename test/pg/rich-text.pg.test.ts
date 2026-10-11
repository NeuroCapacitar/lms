import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { richTextFromParagraph } from '../../src/features/content/rich-text.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { getDraft, getPublishedCurriculum } from '../../src/server/catalog/curriculum-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M2-05 em Postgres 18 real: nenhuma rota grava conteúdo rico sem passar pela allowlist. Corpo de
 * aula e descrição do curso são validados no servidor; o publicado revalida; o banco limita o tamanho.
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

async function admin() {
  seq += 1;
  const user = tools.test.createUser({ email: `admin${seq}@example.test`, name: `Admin ${seq}` });
  await tools.test.saveUser(user);
  await grantRole(tools.db, { actorId: null, targetId: user.id, role: 'admin' });
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}
async function newCourse() {
  const [row] = await tools.db
    .insert(schema.course)
    .values({ slug: `curso-${(seq += 1)}`, title: 'Interno', sequenceMode: 'free' })
    .returning();
  return row!.id;
}
function put(courseId: string, headers: Headers, body: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => false }).request(
    `/api/staff/courses/${courseId}/draft`,
    { method: 'PUT', headers: merged, body: JSON.stringify(body) },
    env(),
  );
}
function publish(courseId: string, headers: Headers) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => false }).request(
    `/api/staff/courses/${courseId}/publish`,
    { method: 'POST', headers: merged, body: '{}' },
    env(),
  );
}

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const body = (rich: unknown) => ({
  expectedRev: 0,
  details: { displayTitle: 'Título', description: null, workloadHours: null },
  modules: [{ title: 'M', dripDays: 0, lessons: [{ title: 'A', isOptional: false, body: rich }] }],
});
const withDescription = (rich: unknown) => ({
  expectedRev: 0,
  details: { displayTitle: 'Título', description: rich, workloadHours: null },
  modules: [],
});

describe('o servidor recusa conteúdo fora da allowlist e não grava nada', () => {
  const evil: [string, unknown][] = [
    [
      'nó desconhecido (imagem)',
      doc({ type: 'image', attrs: { src: 'https://example.com/x.png' } }),
    ],
    ['bloco de código', doc({ type: 'codeBlock', content: [text('x')] })],
    [
      'link javascript:',
      doc(paragraph(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
    ],
    [
      'link data:',
      doc(
        paragraph(
          text('x', [
            { type: 'link', attrs: { href: 'data:text/html,<script>alert(1)</script>' } },
          ]),
        ),
      ),
    ],
    [
      'atributo extra (onclick)',
      doc(
        paragraph(
          text('x', [
            { type: 'link', attrs: { href: 'https://example.com', onclick: 'alert(1)' } },
          ]),
        ),
      ),
    ],
    ['marca desconhecida', doc(paragraph(text('x', [{ type: 'underline' }])))],
    ['HTML em string no lugar do documento', '<p onclick="alert(1)">x</p>'],
    ['documento enorme (mais de 100 KB)', doc(paragraph(text('x'.repeat(100_001))))],
  ];

  for (const [name, rich] of evil) {
    it(`corpo de aula: ${name}`, async () => {
      const person = await admin();
      const courseId = await newCourse();
      const response = await put(courseId, person.headers, body(rich));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'invalid_request' } });
      const draft = (await getDraft(tools.db, courseId))!;
      expect(draft.rev).toBe(0);
      expect(draft.modules).toHaveLength(0);
      expect(await tools.db.select().from(schema.lessonDraft)).toHaveLength(0);
    });
  }

  it('descrição do curso passa pela mesma validação', async () => {
    const person = await admin();
    const courseId = await newCourse();
    for (const rich of [
      doc({ type: 'image' }),
      '<b>x</b>',
      doc(paragraph(text('x', [{ type: 'link', attrs: { href: 'javascript:1' } }]))),
    ]) {
      expect((await put(courseId, person.headers, withDescription(rich))).status).toBe(400);
    }
    expect((await getDraft(tools.db, courseId))!.rev).toBe(0);
    expect(await tools.db.select().from(schema.courseDraft)).toHaveLength(0);
  });
});

describe('conteúdo válido', () => {
  it('é gravado como veio, sobrevive à publicação e HTML como TEXTO não é alterado nem executado', async () => {
    const person = await admin();
    const courseId = await newCourse();
    const lessonBody = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Título da aula')] },
      paragraph(
        text('Texto com <script>alert(1)</script> e <img src=x onerror=alert(1)>', [
          { type: 'bold' },
        ]),
        { type: 'hardBreak' },
        text('site', [
          {
            type: 'link',
            attrs: { href: 'https://example.com/pagina', target: null, rel: null, class: null },
          },
        ]),
      ),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('item'))] }] },
    );
    const description = richTextFromParagraph('Descrição do curso');
    const saved = await put(courseId, person.headers, {
      expectedRev: 0,
      details: { displayTitle: 'Título', description, workloadHours: 8 },
      modules: [
        { title: 'M', dripDays: 0, lessons: [{ title: 'A', isOptional: false, body: lessonBody }] },
      ],
    });
    expect(saved.status).toBe(200);
    const draft = (await getDraft(tools.db, courseId))!;
    expect(draft.modules[0]!.lessons[0]!.body).toEqual(lessonBody);
    expect(draft.details.description).toEqual(description);

    expect((await publish(courseId, person.headers)).status).toBe(200);
    const published = (await getPublishedCurriculum(tools.db, courseId))!;
    expect(published.modules[0]!.lessons[0]!.body).toEqual(lessonBody);
    expect(published.details.description).toEqual(description);
  });
});

describe('defesa em profundidade', () => {
  it('a publicação revalida o corpo mesmo que algo tenha entrado por fora da API', async () => {
    const person = await admin();
    const courseId = await newCourse();
    await put(courseId, person.headers, body(doc(paragraph(text('ok')))));
    // grava direto no banco, contornando a API (o que a rota nunca deixaria)
    await tools.db
      .update(schema.lessonDraft)
      .set({ body: doc({ type: 'image', attrs: { src: 'https://example.com/x.png' } }) })
      .where(eq(schema.lessonDraft.title, 'A'));
    const response = await publish(courseId, person.headers);
    expect(response.status).toBe(422);
    const problems = (
      (await response.json()) as { error: { problems: { code: string; path: string }[] } }
    ).error.problems;
    expect(problems).toEqual([{ code: 'body_invalid', path: 'modules[0].lessons[0].body' }]);
    expect(await getPublishedCurriculum(tools.db, courseId)).toBeNull();
    expect(await tools.db.select().from(schema.lesson)).toHaveLength(0);
  });

  it('o banco limita em 100 KB o conteúdo rico (CHECK) mesmo fora da API', async () => {
    const courseId = await newCourse();
    const [moduleRow] = await tools.db
      .insert(schema.moduleDraft)
      .values({ courseId, title: 'M', position: 0 })
      .returning();
    const huge = doc(paragraph(text('x'.repeat(100_100))));
    for (const work of [
      tools.db
        .insert(schema.lessonDraft)
        .values({ courseId, moduleId: moduleRow!.id, title: 'x', position: 0, body: huge }),
      tools.db
        .insert(schema.courseDraft)
        .values({ courseId, displayTitle: 'x', description: huge }),
    ]) {
      const error = (await work.then(
        () => null,
        (reason: unknown) => reason,
      )) as { message?: string; cause?: { message?: string } } | null;
      expect(error, 'deveria ser recusado').not.toBeNull();
      expect(`${error?.message} ${error?.cause?.message}`).toMatch(/_size_check/);
    }
  });

  it('a conversão da migration 0011 preserva um texto antigo como documento de um parágrafo e vazio vira nulo', async () => {
    // contrato do USING da migration, exercitado numa tabela de rascunho (a migration em si rodou vazia)
    await tools.db.execute(
      sql`create temporary table legado (description text not null default '')`,
    );
    await tools.db.execute(sql`insert into legado values ('Texto antigo'), ('')`);
    await tools.db.execute(
      sql`alter table legado alter column description drop default, alter column description drop not null`,
    );
    await tools.db
      .execute(sql`alter table legado alter column description set data type jsonb using (
      case when description = '' then null else jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', description))))) end)`);
    const rows = (await tools.db.execute(
      sql`select description from legado order by description nulls last`,
    )) as unknown as {
      rows: { description: unknown }[];
    };
    expect(rows.rows.map((row) => row.description)).toEqual([
      richTextFromParagraph('Texto antigo'),
      null,
    ]);
  });
});
