import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-05 em Postgres 18 real: discussões mínimas por aula. Só lê e escreve quem tem a aula ABERTA (acesso,
 * expiração, drip e sequência, a cada chamada); texto simples com um nível de resposta; o autor edita e exclui o
 * próprio post; denúncia única por pessoa; moderação só com o grant, com motivo e auditoria; nome exibido é o do
 * perfil (nunca o e-mail); aula retirada esconde a conversa sem apagar os posts; a Staff em prévia não escreve.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
/** Todos os módulos do demonstrativo (D+0, D+7, D+14) já liberados pelo drip. */
const LATE = new Date('2026-10-30T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;
let clockNow = LATE;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  clockNow = LATE;
  await tools.db.execute(
    sql`truncate table discussion_report, discussion_post, quiz_attempt, video_progress, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.profile);
  await tools.db.delete(schema.user);
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;
const app = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    clock: () => clockNow,
  });

interface Person {
  id: string;
  email: string;
  name: string;
  headers: Headers;
}
async function newPerson(
  options: { role?: 'support' | 'admin'; grants?: string[]; name?: string } = {},
): Promise<Person> {
  seq += 1;
  const email = `pessoa${seq}@example.test`;
  const name = options.name ?? `Pessoa ${seq}`;
  const user = tools.test.createUser({ email, name });
  await tools.test.saveUser(user);
  // O perfil nasce com o usuário (gancho do cadastro): só acerta o nome de exibição.
  await tools.db
    .insert(schema.profile)
    .values({ userId: user.id, displayName: name })
    .onConflictDoUpdate({ target: schema.profile.userId, set: { displayName: name } });
  if (options.role) {
    await grantRole(tools.db, { actorId: null, targetId: user.id, role: options.role });
  }
  for (const capability of options.grants ?? []) {
    await tools.db
      .insert(schema.staffGrant)
      .values({ userId: user.id, capability, grantedBy: user.id });
  }
  const session = await tools.test.login({ userId: user.id });
  return { id: user.id, email, name, headers: session.headers };
}
function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function course() {
  const fixture = await createDemoCourse(tools.db);
  const rows = await tools.db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  const lesson = Object.fromEntries(rows.map((row) => [row.title, row.id])) as Record<
    string,
    string
  >;
  return { ...fixture, lesson, first: lesson['Boas-vindas']! };
}
async function enroll(person: Person, fixture: { courseId: string; offerId: string }, months = 12) {
  await grantEntitlement(tools.db, {
    userId: person.id,
    courseId: fixture.courseId,
    offerId: fixture.offerId,
    source: 'free_offer',
    sourceRef: `free:${person.id}:${fixture.offerId}:0`,
    accessMonths: months,
    startsAt: T0,
    grantedBy: person.id,
  });
}
async function student(fixture: { courseId: string; offerId: string }, name?: string) {
  const person = await newPerson({ name });
  await enroll(person, fixture);
  return person;
}

/** Sequência livre: todas as aulas abrem (para testar uma aula diferente da primeira). */
async function freeSequence(courseId: string) {
  await tools.db
    .update(schema.course)
    .set({ sequenceMode: 'free' })
    .where(eq(schema.course.id, courseId));
}

const post = (who: Person, lessonId: string, body: string, parentId?: string) =>
  call('POST', `/lessons/${lessonId}/discussion/posts`, who.headers, {
    body,
    ...(parentId ? { parentId } : {}),
  });
const read = (who: Person | undefined, lessonId: string) =>
  call('GET', `/lessons/${lessonId}/discussion`, who?.headers);
const postsInDb = () => tools.db.select().from(schema.discussionPost);
const audit = () => tools.db.select().from(schema.auditLog);

/** Insere um post direto no banco (para montar cenários sem passar pelo limite de frequência). */
async function seedPost(
  fixture: { courseId: string },
  lessonId: string,
  authorId: string,
  body: string,
  extra: Partial<typeof schema.discussionPost.$inferInsert> = {},
) {
  const [row] = await tools.db
    .insert(schema.discussionPost)
    .values({ courseId: fixture.courseId, lessonId, authorId, body, ...extra })
    .returning();
  return row!;
}

describe('ler e escrever (só com a aula aberta)', () => {
  it('pergunta e resposta aparecem na conversa com o NOME de exibição e nunca o e-mail', async () => {
    const fixture = await course();
    const ana = await student(fixture, 'Ana Souza');
    const bia = await student(fixture, 'Bia Lima');
    const created = await post(ana, fixture.first, 'Como funciona a liberação?');
    expect(created.status).toBe(201);
    const question = (await json(created)).post;
    expect(question).toMatchObject({
      authorName: 'Ana Souza',
      authorRole: 'student',
      body: 'Como funciona a liberação?',
      mine: true,
      editedAt: null,
    });
    const reply = await post(bia, fixture.first, 'Por módulo, em D+N.', question.id);
    expect(reply.status).toBe(201);

    const view = await read(ana, fixture.first);
    expect(view.status).toBe(200);
    const text = await view.clone().text();
    expect(text).not.toContain('@example.test');
    const body = await json(view);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].post).toMatchObject({ authorName: 'Ana Souza', mine: true });
    expect(body.threads[0].replies).toEqual([
      expect.objectContaining({ authorName: 'Bia Lima', body: 'Por módulo, em D+N.', mine: false }),
    ]);
    // quem lê como Bia vê `mine` na resposta dela
    const asBia = await json(await read(bia, fixture.first));
    expect(asBia.threads[0].post.mine).toBe(false);
    expect(asBia.threads[0].replies[0].mine).toBe(true);
  });

  it('texto simples: HTML e Markdown ficam como texto; controle e bidi são removidos; limite de 2000', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    const xss = '<img src=x onerror=alert(1)> **negrito** [x](javascript:alert(1))';
    expect((await post(ana, fixture.first, xss)).status).toBe(201);
    expect((await post(ana, fixture.first, 'a\u0000b‮c\r\n\r\n\r\n\r\nd')).status).toBe(201);
    const bodies = (await postsInDb()).map((row) => row.body).sort();
    expect(bodies).toContain(xss);
    expect(bodies).toContain('abc\n\nd');
    for (const body of ['', '   ', 'x'.repeat(2001)]) {
      expect((await post(ana, fixture.first, body)).status, body.slice(0, 5)).toBe(400);
    }
    expect(
      (
        await call('POST', `/lessons/${fixture.first}/discussion/posts`, ana.headers, {
          body: 'ok',
          extra: 1,
        })
      ).status,
    ).toBe(400);
  });

  it('um nível só: resposta de resposta, pai inexistente, pai de outra aula e pai oculto são recusados', async () => {
    const fixture = await course();
    await freeSequence(fixture.courseId);
    const ana = await student(fixture);
    const root = (await json(await post(ana, fixture.first, 'Pergunta'))).post;
    const reply = (await json(await post(ana, fixture.first, 'Resposta', root.id))).post;
    const nested = await post(ana, fixture.first, 'Resposta da resposta', reply.id);
    expect(nested.status).toBe(400);
    expect((await json(nested)).error.code).toBe('reply_to_reply');
    const missing = await post(ana, fixture.first, 'x', crypto.randomUUID());
    expect(missing.status).toBe(404);
    expect((await json(missing)).error.code).toBe('parent_unavailable');
    const other = await post(ana, fixture.lesson['Como estudar aqui']!, 'Outra aula', root.id);
    expect(other.status).toBe(404);
    await tools.db
      .update(schema.discussionPost)
      .set({ state: 'hidden' })
      .where(eq(schema.discussionPost.id, root.id));
    expect((await post(ana, fixture.first, 'Para o oculto', root.id)).status).toBe(404);
    expect(await postsInDb()).toHaveLength(2);
  });

  it('o limite de frequência (5 por 10 minutos) vale por pessoa e solta depois da janela', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    const bia = await student(fixture);
    for (let index = 0; index < 5; index += 1) {
      expect((await post(ana, fixture.first, `Mensagem ${index}`)).status).toBe(201);
    }
    const blocked = await post(ana, fixture.first, 'Sexta');
    expect(blocked.status).toBe(429);
    expect((await json(blocked)).error.code).toBe('rate_limited');
    expect((await post(bia, fixture.first, 'Outra pessoa pode')).status).toBe(201);
    clockNow = new Date(LATE.getTime() + 11 * 60_000);
    expect((await post(ana, fixture.first, 'Depois da janela')).status).toBe(201);
  });

  it('mensagens SIMULTÂNEAS da mesma pessoa respeitam o limite (a matrícula é travada)', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    const responses = await Promise.all(
      Array.from({ length: 9 }, (_, index) => post(ana, fixture.first, `Simultânea ${index}`)),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(4);
    expect(await postsInDb()).toHaveLength(5);
  });
});

describe('acesso cruzado, direto pela API', () => {
  it('sem sessão 401; sem matrícula 403 (ler e escrever); ids malformados 404; aula inexistente 404', async () => {
    const fixture = await course();
    const outsider = await newPerson();
    expect((await read(undefined, fixture.first)).status).toBe(401);
    expect((await post(outsider, fixture.first, 'oi')).status).toBe(403);
    const denied = await read(outsider, fixture.first);
    expect(denied.status).toBe(403);
    expect((await json(denied)).error).toMatchObject({ code: 'access_denied' });
    expect((await read(outsider, 'xyz')).status).toBe(404);
    expect((await read(outsider, crypto.randomUUID())).status).toBe(404);
    expect((await post(outsider, crypto.randomUUID(), 'oi')).status).toBe(404);
    expect(await postsInDb()).toHaveLength(0);
  });

  it('o aluno de OUTRO curso não lê nem escreve na conversa desta aula', async () => {
    const one = await course();
    const ana = await student(one);
    await post(ana, one.first, 'Segredo do curso um');
    const [other] = await tools.db
      .insert(schema.course)
      .values({ slug: 'outro', title: 'Outro', sequenceMode: 'guided' })
      .returning();
    const bia = await newPerson();
    expect(other).toBeDefined();
    expect((await read(bia, one.first)).status).toBe(403);
    expect((await post(bia, one.first, 'invasão')).status).toBe(403);
  });

  it('acesso EXPIRADO: nega ler e escrever; os posts anteriores ficam intactos', async () => {
    const fixture = await course();
    const ana = await newPerson();
    await enroll(ana, fixture, 1);
    clockNow = new Date('2026-10-20T12:00:00.000Z');
    expect((await post(ana, fixture.first, 'Dentro do prazo')).status).toBe(201);
    clockNow = new Date('2026-12-30T12:00:00.000Z');
    const response = await read(ana, fixture.first);
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({
      code: 'access_denied',
      reason: 'expired',
    });
    expect((await post(ana, fixture.first, 'Depois')).status).toBe(403);
    expect(await postsInDb()).toHaveLength(1);
  });

  it('aula de módulo AINDA NÃO liberado pelo drip e aula bloqueada pela sequência: 403 lesson_locked', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    clockNow = new Date(T0.getTime() + 60_000); // só o módulo 1 está liberado
    const later = fixture.lesson['Conceito central']!;
    const drip = await read(ana, later);
    expect(drip.status).toBe(403);
    expect((await json(drip)).error).toMatchObject({ code: 'lesson_locked' });
    expect((await post(ana, later, 'cedo')).status).toBe(403);
    // sequência guiada: a 2ª aula do módulo 1 só abre depois de concluir a 1ª
    const second = fixture.lesson['Como estudar aqui']!;
    const sequence = await read(ana, second);
    expect(sequence.status).toBe(403);
    expect((await post(ana, second, 'cedo')).status).toBe(403);
    expect(await postsInDb()).toHaveLength(0);
  });

  it('aula RETIRADA do currículo: a conversa some (404) e os posts ficam guardados', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    await post(ana, fixture.first, 'Antes da retirada');
    await tools.db
      .update(schema.lesson)
      .set({ retiredAt: new Date() })
      .where(eq(schema.lesson.id, fixture.first));
    expect((await read(ana, fixture.first)).status).toBe(404);
    expect((await post(ana, fixture.first, 'depois')).status).toBe(404);
    expect(await postsInDb()).toHaveLength(1);
  });

  it('a Staff na PRÉVIA não cria post: sem matrícula é 403 e nada é gravado', async () => {
    const fixture = await course();
    const admin = await newPerson({ role: 'admin' });
    expect((await post(admin, fixture.first, 'Staff tentando')).status).toBe(403);
    expect((await read(admin, fixture.first)).status).toBe(403);
    expect(await postsInDb()).toHaveLength(0);
  });
});

describe('editar, excluir e denunciar', () => {
  it('o autor edita o próprio post (marca a edição); outra pessoa recebe 403 e nada muda', async () => {
    const fixture = await course();
    await freeSequence(fixture.courseId);
    const ana = await student(fixture);
    const bia = await student(fixture);
    const created = (await json(await post(ana, fixture.first, 'Texto original'))).post;
    const path = `/lessons/${fixture.first}/discussion/posts/${created.id}`;
    const edited = await call('PATCH', path, ana.headers, { body: '  Texto editado  ' });
    expect(edited.status).toBe(200);
    const body = (await json(edited)).post;
    expect(body).toMatchObject({ body: 'Texto editado', mine: true });
    expect(body.editedAt).not.toBeNull();
    const intruder = await call('PATCH', path, bia.headers, { body: 'Sequestrado' });
    expect(intruder.status).toBe(403);
    expect((await json(intruder)).error.code).toBe('not_author');
    expect((await call('POST', `${path}/delete`, bia.headers, {})).status).toBe(403);
    expect((await postsInDb())[0]!.body).toBe('Texto editado');
    // o post de uma aula não se edita pelo caminho de OUTRA aula: 404
    expect(
      (
        await call(
          'PATCH',
          `/lessons/${fixture.lesson['Como estudar aqui']}/discussion/posts/${created.id}`,
          ana.headers,
          { body: 'x' },
        )
      ).status,
    ).toBe(404);
  });

  it('o autor exclui o próprio post: sem resposta some; com resposta vira "mensagem removida"', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    const bia = await student(fixture);
    const alone = (await json(await post(ana, fixture.first, 'Sozinha'))).post;
    const withReply = (await json(await post(ana, fixture.first, 'Com resposta'))).post;
    await post(bia, fixture.first, 'Respondendo', withReply.id);
    for (const id of [alone.id, withReply.id]) {
      expect(
        (
          await call(
            'POST',
            `/lessons/${fixture.first}/discussion/posts/${id}/delete`,
            ana.headers,
            {},
          )
        ).status,
      ).toBe(200);
    }
    const view = await json(await read(bia, fixture.first));
    expect(view.threads).toHaveLength(1);
    expect(view.threads[0].post).toMatchObject({ body: null, placeholder: 'deleted' });
    expect(view.threads[0].replies).toHaveLength(1);
    // as linhas continuam no banco; o excluído não se edita mais
    expect(await postsInDb()).toHaveLength(3);
    const again = await call(
      'PATCH',
      `/lessons/${fixture.first}/discussion/posts/${withReply.id}`,
      ana.headers,
      { body: 'ressuscitar' },
    );
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe('post_not_editable');
  });

  it('denúncia: uma por pessoa e post; não denuncia o próprio nem post oculto; texto da denúncia só vai à Staff', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    const bia = await student(fixture);
    const created = (await json(await post(ana, fixture.first, 'Conteúdo discutível'))).post;
    const path = `/lessons/${fixture.first}/discussion/posts/${created.id}/report`;
    expect((await call('POST', path, ana.headers, {})).status).toBe(400); // o próprio
    expect((await call('POST', path, bia.headers, { reason: 'ofensivo' })).status).toBe(201);
    const duplicate = await call('POST', path, bia.headers, {});
    expect(duplicate.status).toBe(409);
    expect((await json(duplicate)).error.code).toBe('already_reported');
    expect(await tools.db.select().from(schema.discussionReport)).toHaveLength(1);
    expect((await call('POST', path, bia.headers, { reason: 'x'.repeat(301) })).status).toBe(400);
    await tools.db
      .update(schema.discussionPost)
      .set({ state: 'hidden' })
      .where(eq(schema.discussionPost.id, created.id));
    const carol = await student(fixture);
    expect((await call('POST', path, carol.headers, {})).status).toBe(404);
  });

  it('o limite de denúncias (10 por hora) vale por pessoa', async () => {
    const fixture = await course();
    const ana = await student(fixture);
    const bia = await student(fixture);
    const posts = [];
    for (let index = 0; index < 11; index += 1) {
      posts.push(await seedPost(fixture, fixture.first, ana.id, `Post ${index}`));
    }
    for (const item of posts.slice(0, 10)) {
      expect(
        (
          await call(
            'POST',
            `/lessons/${fixture.first}/discussion/posts/${item.id}/report`,
            bia.headers,
            {},
          )
        ).status,
      ).toBe(201);
    }
    const blocked = await call(
      'POST',
      `/lessons/${fixture.first}/discussion/posts/${posts[10]!.id}/report`,
      bia.headers,
      {},
    );
    expect(blocked.status).toBe(429);
  });
});

describe('moderação e resposta da equipe', () => {
  async function setup() {
    const fixture = await course();
    const ana = await student(fixture, 'Ana Souza');
    const bia = await student(fixture, 'Bia Lima');
    const admin = await newPerson({ role: 'admin', name: 'Dra. Admin' });
    const moderator = await newPerson({ role: 'support', grants: ['discussion.moderate'] });
    const plain = await newPerson({ role: 'support' });
    const question = (await json(await post(ana, fixture.first, 'Pergunta da Ana'))).post;
    return { fixture, ana, bia, admin, moderator, plain, question };
  }
  const report = (who: Person, lessonId: string, postId: string) =>
    call('POST', `/lessons/${lessonId}/discussion/posts/${postId}/report`, who.headers, {
      reason: 'fora do tema',
    });

  it('a fila exige o grant: aluno e Suporte sem grant recebem 403; Admin e Suporte com o grant leem', async () => {
    const { fixture, ana, bia, admin, moderator, plain, question } = await setup();
    await report(bia, fixture.first, question.id);
    expect((await call('GET', '/staff/discussions', undefined)).status).toBe(401);
    for (const who of [ana, plain]) {
      expect((await call('GET', '/staff/discussions', who.headers)).status).toBe(403);
      expect(
        (
          await call('POST', `/staff/discussions/posts/${question.id}/moderate`, who.headers, {
            action: 'hide',
            reason: 'sem permissão',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('POST', `/staff/discussions/posts/${question.id}/reply`, who.headers, {
            body: 'sem permissão',
          })
        ).status,
      ).toBe(403);
    }
    for (const who of [admin, moderator]) {
      const response = await call('GET', '/staff/discussions?view=reported', who.headers);
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(JSON.stringify(body)).not.toContain('@example.test');
      expect(body.items).toEqual([
        expect.objectContaining({
          id: question.id,
          lessonTitle: 'Boas-vindas',
          authorName: 'Ana Souza',
          state: 'visible',
          isReply: false,
          body: 'Pergunta da Ana',
          openReports: 1,
          staffReplies: 0,
        }),
      ]);
    }
    expect((await postsInDb()).find((row) => row.id === question.id)!.state).toBe('visible');
  });

  it('ocultar exige MOTIVO, fecha as denúncias, some para o aluno e fica auditado sem o texto do post', async () => {
    const { fixture, ana, bia, moderator, question } = await setup();
    await report(bia, fixture.first, question.id);
    const path = `/staff/discussions/posts/${question.id}/moderate`;
    for (const bad of [
      { action: 'hide' },
      { action: 'hide', reason: 'ab' },
      { action: 'apagar', reason: 'motivo' },
    ]) {
      expect((await call('POST', path, moderator.headers, bad)).status).toBe(400);
    }
    const hidden = await call('POST', path, moderator.headers, {
      action: 'hide',
      reason: 'Contém dado de paciente',
    });
    expect(hidden.status).toBe(200);
    expect(await json(hidden)).toEqual({ state: 'hidden' });
    const [reportRow] = await tools.db.select().from(schema.discussionReport);
    expect(reportRow!.resolvedAt).not.toBeNull();
    // o aluno não vê mais (sem resposta visível, a conversa some)
    expect((await json(await read(bia, fixture.first))).threads).toEqual([]);
    const events = (await audit()).filter((row) => row.targetId === question.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'discussion.hide', actorId: moderator.id });
    expect(events[0]!.details).toEqual({
      lessonId: fixture.first,
      from: 'visible',
      to: 'hidden',
      reason: 'Contém dado de paciente',
    });
    expect(JSON.stringify(events)).not.toContain('Pergunta da Ana');
    // a autora não consegue editar o post oculto
    expect(
      (
        await call(
          'PATCH',
          `/lessons/${fixture.first}/discussion/posts/${question.id}`,
          ana.headers,
          {
            body: 'tentando',
          },
        )
      ).status,
    ).toBe(409);
  });

  it('restaurar só o oculto; excluir é definitivo; o que o autor excluiu não volta', async () => {
    const { fixture, ana, bia, moderator, question } = await setup();
    const moderate = (action: string, id = question.id) =>
      call('POST', `/staff/discussions/posts/${id}/moderate`, moderator.headers, {
        action,
        reason: 'motivo de teste',
      });
    expect((await moderate('restore')).status).toBe(409); // já visível
    expect((await moderate('hide')).status).toBe(200);
    expect((await moderate('hide')).status).toBe(409);
    expect((await moderate('restore')).status).toBe(200);
    expect((await json(await read(bia, fixture.first))).threads).toHaveLength(1);
    expect((await moderate('delete')).status).toBe(200);
    expect((await moderate('restore')).status).toBe(409);
    expect((await moderate('delete')).status).toBe(409);
    // excluído pelo próprio autor: a Staff não restaura
    const own = (await json(await post(ana, fixture.first, 'Vou excluir'))).post;
    await call(
      'POST',
      `/lessons/${fixture.first}/discussion/posts/${own.id}/delete`,
      ana.headers,
      {},
    );
    const restore = await moderate('restore', own.id);
    expect(restore.status).toBe(409);
    expect((await json(restore)).error.code).toBe('invalid_transition');
    expect((await moderate('hide', crypto.randomUUID())).status).toBe(404);
    expect(
      (await call('POST', '/staff/discussions/posts/xyz/moderate', moderator.headers, {})).status,
    ).toBe(404);
  });

  it('descartar denúncias não muda o post, audita e some da fila; sem denúncia aberta é 409', async () => {
    const { fixture, bia, moderator, question } = await setup();
    const path = `/staff/discussions/posts/${question.id}/dismiss`;
    expect((await call('POST', path, moderator.headers, {})).status).toBe(409);
    await report(bia, fixture.first, question.id);
    const done = await call('POST', path, moderator.headers, { reason: 'Sem infração' });
    expect(done.status).toBe(200);
    expect(await json(done)).toEqual({ dismissed: 1 });
    expect((await postsInDb()).find((row) => row.id === question.id)!.state).toBe('visible');
    const queue = await json(
      await call('GET', '/staff/discussions?view=reported', moderator.headers),
    );
    expect(queue.items).toEqual([]);
    const events = (await audit()).filter((row) => row.action === 'discussion.dismiss_reports');
    expect(events).toHaveLength(1);
    expect(events[0]!.details).toEqual({ dismissed: 1, reason: 'Sem infração' });
  });

  it('a equipe responde com o papel staff, marcada para o aluno, e a pergunta sai da fila de sem resposta', async () => {
    const { fixture, ana, admin, question } = await setup();
    let unanswered = await json(
      await call('GET', '/staff/discussions?view=unanswered', admin.headers),
    );
    expect(unanswered.items.map((item: { id: string }) => item.id)).toEqual([question.id]);
    expect(unanswered.items[0]).toMatchObject({
      courseTitle: expect.any(String),
      lessonTitle: 'Boas-vindas',
    });

    const reply = await call(
      'POST',
      `/staff/discussions/posts/${question.id}/reply`,
      admin.headers,
      {
        body: '  Veja o módulo 1.  ',
      },
    );
    expect(reply.status).toBe(201);
    const replyBody = await json(reply);
    expect(replyBody.post).toMatchObject({
      authorRole: 'staff',
      authorName: 'Dra. Admin',
      body: 'Veja o módulo 1.',
    });
    const view = await json(await read(ana, fixture.first));
    expect(view.threads[0].replies).toEqual([
      expect.objectContaining({ authorRole: 'staff', authorName: 'Dra. Admin', mine: false }),
    ]);
    unanswered = await json(await call('GET', '/staff/discussions?view=unanswered', admin.headers));
    expect(unanswered.items).toEqual([]);
    const events = (await audit()).filter((row) => row.action === 'discussion.staff_reply');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('Veja o módulo');
    // não responde a resposta, nem a post inexistente
    const nested = replyBody.post.id as string;
    expect(
      (await call('POST', `/staff/discussions/posts/${nested}/reply`, admin.headers, { body: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (
        await call('POST', `/staff/discussions/posts/${crypto.randomUUID()}/reply`, admin.headers, {
          body: 'x',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('POST', `/staff/discussions/posts/${question.id}/reply`, admin.headers, {
          body: '',
        })
      ).status,
    ).toBe(400);
  });

  it('a Staff vê o texto COMPLETO do post oculto na fila de denúncias; aula retirada sai da fila de sem resposta', async () => {
    const { fixture, bia, admin, moderator, question } = await setup();
    await report(bia, fixture.first, question.id);
    await call('POST', `/staff/discussions/posts/${question.id}/moderate`, admin.headers, {
      action: 'hide',
      reason: 'teste de visibilidade',
    });
    await tools.db.insert(schema.discussionReport).values({
      postId: question.id,
      reporterId: moderator.id,
      reason: 'outra denúncia',
    });
    const queue = await json(await call('GET', '/staff/discussions?view=reported', admin.headers));
    expect(queue.items[0]).toMatchObject({
      state: 'hidden',
      body: 'Pergunta da Ana',
      openReports: 1,
    });
    await tools.db
      .update(schema.discussionPost)
      .set({ state: 'visible' })
      .where(eq(schema.discussionPost.id, question.id));
    await tools.db
      .update(schema.lesson)
      .set({ retiredAt: new Date() })
      .where(eq(schema.lesson.id, fixture.first));
    const unanswered = await json(
      await call('GET', '/staff/discussions?view=unanswered', admin.headers),
    );
    expect(unanswered.items).toEqual([]);
  });
});

describe('o banco guarda as regras', () => {
  async function base() {
    const fixture = await course();
    const ana = await student(fixture);
    const root = await seedPost(fixture, fixture.first, ana.id, 'Raiz');
    return { fixture, ana, root };
  }
  /** Erros do Drizzle trazem a mensagem do Postgres em `cause`: confere nas duas. */
  async function violation(work: PromiseLike<unknown>, pattern: RegExp) {
    let caught: unknown;
    try {
      await work;
    } catch (error) {
      caught = error;
    }
    expect(caught, 'esperava uma violação').toBeDefined();
    const text = [caught, (caught as { cause?: unknown }).cause]
      .map((item) => (item as Error | undefined)?.message ?? '')
      .join(' | ');
    expect(text).toMatch(pattern);
  }

  it('resposta de resposta, pai de outra aula e pai de si mesmo são recusados', async () => {
    const { fixture, ana, root } = await base();
    const reply = await seedPost(fixture, fixture.first, ana.id, 'Resposta', { parentId: root.id });
    await violation(
      seedPost(fixture, fixture.first, ana.id, 'Aninhada', { parentId: reply.id }),
      /discussion_reply_to_reply/,
    );
    await violation(
      seedPost(fixture, fixture.lesson['Como estudar aqui']!, ana.id, 'Outra aula', {
        parentId: root.id,
      }),
      /discussion_post_parent_fk/,
    );
    await violation(
      tools.db.execute(sql`update discussion_post set parent_id = id where id = ${root.id}`),
      /discussion_post_not_own_parent_check|discussion_post_immutable_fields/,
    );
  });

  it('aula, autor, papel, pai e criação nunca mudam; só texto e estado', async () => {
    const { fixture, ana, root } = await base();
    const other = await student(fixture);
    for (const change of [
      sql`lesson_id = ${fixture.lesson['Como estudar aqui']}`,
      sql`author_id = ${other.id}`,
      sql`author_role = 'staff'`,
      sql`created_at = now() - interval '1 day'`,
    ]) {
      await violation(
        tools.db.execute(sql`update discussion_post set ${change} where id = ${root.id}`),
        /discussion_post_immutable_fields|violates|discussion_post_lesson_fk/,
      );
    }
    await tools.db.execute(
      sql`update discussion_post set body = 'Editado', state = 'hidden' where id = ${root.id}`,
    );
    expect(ana.id).toBeTruthy();
  });

  it('texto vazio, com espaço nas pontas ou acima de 2000, e estado ou papel desconhecidos, são recusados', async () => {
    const { fixture, ana } = await base();
    for (const [body, pattern] of [
      ['', /discussion_post_body_check/],
      [' com espaço', /discussion_post_body_check/],
      ['x'.repeat(2001), /discussion_post_body_check/],
    ] as const) {
      await violation(seedPost(fixture, fixture.first, ana.id, body), pattern);
    }
    await violation(
      seedPost(fixture, fixture.first, ana.id, 'ok', { state: 'sumido' }),
      /discussion_post_state_check/,
    );
    await violation(
      seedPost(fixture, fixture.first, ana.id, 'ok', { authorRole: 'dono' }),
      /discussion_post_role_check/,
    );
  });

  it('o post não é apagado enquanto há denúncia ou resposta, e a aula não é apagada com posts', async () => {
    const { fixture, ana, root } = await base();
    await seedPost(fixture, fixture.first, ana.id, 'Resposta', { parentId: root.id });
    await violation(
      tools.db.execute(sql`delete from discussion_post where id = ${root.id}`),
      /violates|restrict/i,
    );
    await violation(
      tools.db.execute(sql`delete from lesson where id = ${fixture.first}`),
      /published_not_deletable|violates|restrict|foreign key/i,
    );
  });
});
