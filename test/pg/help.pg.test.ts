import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { richTextFromParagraph } from '../../src/features/content/rich-text.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createEmailHandler, type EmailHandlerDeps } from '../../src/server/email/send-handler.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import type { MailRequest, MailResult, Mailer } from '../../src/server/email/mailer.ts';
import { createQuotaGate } from '../../src/server/email/quota-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-14 em Postgres 18 real: FAQ editável (só com o grant `help.edit`; rascunho invisível ao aluno; ordem por
 * botões) e pedido de suporte (limite de 3 por 10 min, texto guardado no banco, e-mail ao suporte só com id e
 * categoria, `Reply-To` da conta de quem pediu e à prova de injeção de cabeçalho; falha do e-mail nunca perde o
 * pedido).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;
let clockNow = T0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  clockNow = T0;
  await tools.db.execute(
    sql`truncate table support_request, help_faq_item, email_message, outbox_message cascade`,
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
  return { id: user.id, email, headers: (await tools.test.login({ userId: user.id })).headers };
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

const answer = (text: string) => richTextFromParagraph(text);
const faq = (who: Person, overrides: Record<string, unknown> = {}) =>
  call('POST', '/staff/help/faq', who.headers, {
    category: 'conta',
    question: 'Como entro na plataforma?',
    answer: answer('Use o link enviado ao seu e-mail.'),
    ...overrides,
  });

describe('FAQ: quem edita', () => {
  it('só com o grant help.edit: aluno e Suporte sem o grant recebem 403 em tudo; Admin e Suporte com o grant editam', async () => {
    const student = await newPerson();
    const plain = await newPerson({ role: 'support' });
    const editor = await newPerson({ role: 'support', grants: ['help.edit'] });
    const admin = await newPerson({ role: 'admin' });
    const created = await json(await faq(editor));
    const id = created.item.id as string;
    expect((await call('GET', '/staff/help/faq', undefined)).status).toBe(401);
    for (const who of [student, plain]) {
      expect((await call('GET', '/staff/help/faq', who.headers)).status).toBe(403);
      expect((await faq(who)).status).toBe(403);
      expect(
        (
          await call('PUT', `/staff/help/faq/${id}`, who.headers, {
            category: 'conta',
            question: 'x',
            answer: answer('x'),
          })
        ).status,
      ).toBe(403);
      for (const path of ['state', 'move', 'delete']) {
        expect((await call('POST', `/staff/help/faq/${id}/${path}`, who.headers, {})).status).toBe(
          403,
        );
      }
    }
    expect((await call('GET', '/staff/help/faq', admin.headers)).status).toBe(200);
    expect(await tools.db.select().from(schema.helpFaqItem)).toHaveLength(1);
  });

  it('corpo inválido: resposta com HTML cru ou tipo fora da allowlist, pergunta vazia, categoria desconhecida e campo a mais são 400', async () => {
    const editor = await newPerson({ role: 'support', grants: ['help.edit'] });
    for (const overrides of [
      { answer: '<script>alert(1)</script>' },
      { answer: { type: 'doc', content: [{ type: 'script' }] } },
      { question: '   ' },
      { category: 'inexistente' },
      { extra: true },
    ]) {
      expect((await faq(editor, overrides)).status, JSON.stringify(overrides)).toBe(400);
    }
    expect(await tools.db.select().from(schema.helpFaqItem)).toHaveLength(0);
  });

  it('criar, editar, publicar, ordenar e excluir; o aluno só vê o PUBLICADO, na ordem da Staff', async () => {
    const editor = await newPerson({ role: 'support', grants: ['help.edit'] });
    const student = await newPerson();
    const first = (await json(await faq(editor, { question: 'Primeira' }))).item;
    const second = (await json(await faq(editor, { question: 'Segunda' }))).item;
    const third = (await json(await faq(editor, { question: 'Terceira' }))).item;
    expect([first, second, third].map((item) => item.state)).toEqual(['draft', 'draft', 'draft']);
    const visible = async () =>
      (await json(await call('GET', '/me/help/faq', student.headers))).items.map(
        (item: { question: string }) => item.question,
      );
    expect(await visible()).toEqual([]); // rascunho não aparece
    for (const item of [first, second, third]) {
      expect(
        (
          await call('POST', `/staff/help/faq/${item.id}/state`, editor.headers, {
            state: 'published',
          })
        ).status,
      ).toBe(200);
    }
    expect(await visible()).toEqual(['Primeira', 'Segunda', 'Terceira']);

    // subir a terceira, descer a primeira; ponta não faz nada
    expect(
      (await call('POST', `/staff/help/faq/${third.id}/move`, editor.headers, { direction: 'up' }))
        .status,
    ).toBe(200);
    expect(await visible()).toEqual(['Primeira', 'Terceira', 'Segunda']);
    await call('POST', `/staff/help/faq/${first.id}/move`, editor.headers, { direction: 'up' });
    await call('POST', `/staff/help/faq/${second.id}/move`, editor.headers, { direction: 'down' });
    expect(await visible()).toEqual(['Primeira', 'Terceira', 'Segunda']);
    const positions = (await tools.db.select().from(schema.helpFaqItem))
      .map((row) => row.position)
      .sort();
    expect(positions).toEqual([0, 1, 2]);

    // despublicar some; editar vale; excluir remove
    await call('POST', `/staff/help/faq/${second.id}/state`, editor.headers, { state: 'draft' });
    expect(await visible()).toEqual(['Primeira', 'Terceira']);
    const edited = await call('PUT', `/staff/help/faq/${first.id}`, editor.headers, {
      category: 'acesso',
      question: 'Primeira revisada',
      answer: answer('Nova resposta.'),
    });
    expect(edited.status).toBe(200);
    expect((await json(edited)).item).toMatchObject({
      category: 'acesso',
      question: 'Primeira revisada',
    });
    expect(
      (await call('POST', `/staff/help/faq/${third.id}/delete`, editor.headers, {})).status,
    ).toBe(200);
    expect(await visible()).toEqual(['Primeira revisada']);
    // inexistente e malformado
    for (const [action, body] of [
      ['state', { state: 'published' }],
      ['move', { direction: 'up' }],
      ['delete', {}],
    ] as const) {
      expect(
        (
          await call(
            'POST',
            `/staff/help/faq/${crypto.randomUUID()}/${action}`,
            editor.headers,
            body,
          )
        ).status,
        action,
      ).toBe(404);
    }
    expect((await call('POST', '/staff/help/faq/xyz/delete', editor.headers, {})).status).toBe(404);
    expect((await call('GET', '/me/help/faq', undefined)).status).toBe(401);
  });

  it('criações SIMULTÂNEAS recebem posições distintas e contíguas', async () => {
    const editor = await newPerson({ role: 'support', grants: ['help.edit'] });
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) => faq(editor, { question: `Pergunta ${index}` })),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(201));
    const positions = (await tools.db.select().from(schema.helpFaqItem))
      .map((row) => row.position)
      .sort();
    expect(positions).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('XSS no texto da pergunta fica como TEXTO e a resposta passa pela allowlist (nada de HTML cru)', async () => {
    const editor = await newPerson({ role: 'support', grants: ['help.edit'] });
    const student = await newPerson();
    const xss = '<img src=x onerror=alert(1)>';
    const created = await json(await faq(editor, { question: xss }));
    await call('POST', `/staff/help/faq/${created.item.id}/state`, editor.headers, {
      state: 'published',
    });
    const items = (await json(await call('GET', '/me/help/faq', student.headers))).items;
    expect(items[0].question).toBe(xss); // texto; a tela escapa
    expect(JSON.stringify(items[0].answer)).not.toContain('<script');
  });
});

describe('pedido de suporte', () => {
  const request = (who: Person | undefined, body: Record<string, unknown> = {}) =>
    call('POST', '/me/help/requests', who?.headers, {
      category: 'acesso',
      message: 'Não consigo abrir a primeira aula.',
      ...body,
    });

  it('grava o pedido e a intenção do e-mail na MESMA transação; o e-mail leva só id e categoria', async () => {
    const ana = await newPerson({ name: 'Ana Souza' });
    const response = await request(ana, { message: '  Meu CPF 123.456.789-00 não entra.  ' });
    expect(response.status).toBe(201);
    const { id } = await json(response);
    const [row] = await tools.db.select().from(schema.supportRequest);
    expect(row).toMatchObject({
      id,
      userId: ana.id,
      category: 'acesso',
      message: 'Meu CPF 123.456.789-00 não entra.',
      courseId: null,
    });
    const [mail] = await tools.db.select().from(schema.emailMessage);
    expect(mail).toMatchObject({
      template: 'support-request',
      recipientKind: 'support_inbox',
      recipientUserId: null,
      dedupeKey: `support-request:${id}`,
      variables: { REQUEST_ID: id, CATEGORY: 'Acesso aos cursos' },
    });
    // nem o texto do pedido nem o e-mail da pessoa entram no e-mail ou na outbox
    const stored = JSON.stringify([
      await tools.db.select().from(schema.emailMessage),
      await tools.db.select().from(schema.outboxMessage),
    ]);
    expect(stored).not.toContain('CPF');
    expect(stored).not.toContain(ana.email);
    expect((await tools.db.select().from(schema.outboxMessage)).map((r) => r.kind)).toEqual([
      'email.send',
    ]);
  });

  it('exige login (401); categoria, texto e contexto inválidos são 400; o corpo não aceita userId nem Reply-To', async () => {
    const ana = await newPerson();
    expect((await request(undefined)).status).toBe(401);
    for (const body of [
      { category: 'financeiro' },
      { message: '   ' },
      { message: 'x'.repeat(2001) },
      { courseId: 'nao-uuid' },
      { replyTo: 'outro@exemplo.com' },
      { userId: 'outra-pessoa' },
    ]) {
      expect((await request(ana, body)).status, JSON.stringify(body)).toBe(400);
    }
    const unknown = await request(ana, { courseId: crypto.randomUUID() });
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error.code).toBe('invalid_context');
    expect(await tools.db.select().from(schema.supportRequest)).toHaveLength(0);
    expect(await tools.db.select().from(schema.emailMessage)).toHaveLength(0);
  });

  it('o contexto de curso é guardado quando existe', async () => {
    const ana = await newPerson();
    const [course] = await tools.db
      .insert(schema.course)
      .values({ slug: 'curso-de-ajuda', title: 'Curso de Ajuda', sequenceMode: 'guided' })
      .returning();
    expect((await request(ana, { courseId: course!.id })).status).toBe(201);
    expect((await tools.db.select().from(schema.supportRequest))[0]!.courseId).toBe(course!.id);
  });

  it('limite de 3 pedidos por 10 minutos por pessoa (429); outra pessoa não é afetada; a janela solta', async () => {
    const ana = await newPerson();
    const bia = await newPerson();
    for (let index = 0; index < 3; index += 1) {
      expect((await request(ana, { message: `Pedido ${index}` })).status).toBe(201);
    }
    const blocked = await request(ana, { message: 'Quarto' });
    expect(blocked.status).toBe(429);
    expect((await json(blocked)).error.code).toBe('rate_limited');
    expect((await request(bia)).status).toBe(201);
    clockNow = new Date(T0.getTime() + 11 * 60_000);
    expect((await request(ana, { message: 'Depois da janela' })).status).toBe(201);
    expect(await tools.db.select().from(schema.supportRequest)).toHaveLength(5);
  });

  it('pedidos SIMULTÂNEOS da mesma pessoa respeitam o limite', async () => {
    const ana = await newPerson();
    const responses = await Promise.all(
      Array.from({ length: 7 }, (_, index) => request(ana, { message: `Simultâneo ${index}` })),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(4);
    expect(await tools.db.select().from(schema.supportRequest)).toHaveLength(3);
  });

  it('a Staff lê os pedidos (staff.read) com o nome de exibição, nunca o e-mail; o aluno não', async () => {
    const ana = await newPerson({ name: 'Ana Souza' });
    const support = await newPerson({ role: 'support' });
    await request(ana, { message: 'Preciso de ajuda com o acesso.' });
    expect((await call('GET', '/staff/help/requests', undefined)).status).toBe(401);
    expect((await call('GET', '/staff/help/requests', ana.headers)).status).toBe(403);
    const response = await call('GET', '/staff/help/requests', support.headers);
    expect(response.status).toBe(200);
    const text = await response.clone().text();
    expect(text).not.toContain('@example.test');
    expect((await json(response)).requests).toEqual([
      expect.objectContaining({
        authorName: 'Ana Souza',
        category: 'acesso',
        message: 'Preciso de ajuda com o acesso.',
        courseTitle: null,
      }),
    ]);
  });
});

describe('o e-mail ao suporte leva o Reply-To de quem pediu', () => {
  class ScriptedMailer implements Mailer {
    plan: MailResult[] = [];
    readonly calls: MailRequest[] = [];
    async send(request: MailRequest): Promise<MailResult> {
      this.calls.push(request);
      return this.plan.shift() ?? { ok: true, providerMessageId: `re_${this.calls.length}` };
    }
  }
  const deps = (mailer: Mailer): EmailHandlerDeps => ({
    getMailer: () => mailer,
    quota: createQuotaGate(),
    from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
    appUrl: 'https://hub.example',
    allowlist: [],
    supportInbox: 'suporte@neurocapacitar.example',
  });
  async function send(mailer: Mailer, mailId: string) {
    return createEmailHandler(deps(mailer))({
      db: tools.db,
      payload: { emailMessageId: mailId },
      intentId: crypto.randomUUID(),
      correlationId: 'teste',
      idempotencyKey: `email:support-request:${mailId}`,
      attempt: 1,
    });
  }
  async function requestFor(ana: Person) {
    const response = await call('POST', '/me/help/requests', ana.headers, {
      category: 'conta',
      message: 'Não recebi o link de acesso.',
    });
    expect(response.status).toBe(201);
    const [mail] = await tools.db.select().from(schema.emailMessage);
    return { id: (await json(response)).id as string, mailId: mail!.id };
  }

  it('o envio vai para a caixa de suporte com Reply-To = a conta da pessoa, e o texto do pedido NÃO vai no e-mail', async () => {
    const ana = await newPerson({ name: 'Ana Souza' });
    const { id, mailId } = await requestFor(ana);
    const mailer = new ScriptedMailer();
    await send(mailer, mailId);
    expect(mailer.calls).toHaveLength(1);
    expect(mailer.calls[0]).toMatchObject({
      to: 'suporte@neurocapacitar.example',
      templateAlias: 'vnext-support-request',
      replyTo: ana.email,
      variables: { REQUEST_ID: id, CATEGORY: 'Minha conta e login' },
    });
    expect(JSON.stringify(mailer.calls)).not.toContain('Não recebi');
    expect((await tools.db.select().from(schema.emailMessage))[0]!.state).toBe('accepted');
  });

  it('endereço com quebra de linha ou vários destinatários NUNCA chega ao cabeçalho: falha permanente sem enviar', async () => {
    const ana = await newPerson();
    const { mailId } = await requestFor(ana);
    for (const hostile of ['ana@exemplo.com\r\nBcc: x@y.com', 'a@b.com, c@d.com']) {
      await tools.db.update(schema.user).set({ email: hostile }).where(eq(schema.user.id, ana.id));
      await tools.db
        .update(schema.emailMessage)
        .set({ state: 'queued' })
        .where(eq(schema.emailMessage.id, mailId));
      const mailer = new ScriptedMailer();
      await expect(send(mailer, mailId)).rejects.toMatchObject({ code: 'reply_to_invalid' });
      expect(mailer.calls).toHaveLength(0);
      expect((await tools.db.select().from(schema.emailMessage))[0]).toMatchObject({
        state: 'failed',
        lastErrorCode: 'reply_to_invalid',
      });
    }
  });

  it('falha do Resend não perde o pedido: o texto continua no banco e a Staff o lê', async () => {
    const ana = await newPerson();
    const { mailId } = await requestFor(ana);
    const mailer = new ScriptedMailer();
    mailer.plan = [{ ok: false, kind: 'rejected', status: 422 }];
    await expect(send(mailer, mailId)).rejects.toMatchObject({ code: 'provider_422' });
    expect(await tools.db.select().from(schema.supportRequest)).toHaveLength(1);
    const support = await newPerson({ role: 'support' });
    const list = await json(await call('GET', '/staff/help/requests', support.headers));
    expect(list.requests).toHaveLength(1);
  });
});

describe('o banco guarda as regras', () => {
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

  it('categoria, estado, texto aparado e tamanho', async () => {
    const ana = await newPerson();
    const base = { category: 'conta', question: 'ok', answer: answer('ok'), position: 0 };
    await violation(
      tools.db.insert(schema.helpFaqItem).values({ ...base, category: 'xx' }),
      /help_faq_item_category_check/,
    );
    await violation(
      tools.db.insert(schema.helpFaqItem).values({ ...base, state: 'oculto' }),
      /help_faq_item_state_check/,
    );
    await violation(
      tools.db.insert(schema.helpFaqItem).values({ ...base, question: ' com espaço' }),
      /help_faq_item_question_check/,
    );
    await violation(
      tools.db.insert(schema.helpFaqItem).values({ ...base, position: -1 }),
      /help_faq_item_position_check/,
    );
    await violation(
      tools.db
        .insert(schema.supportRequest)
        .values({ userId: ana.id, category: 'xx', message: 'ok' }),
      /support_request_category_check/,
    );
    for (const message of ['', ' espaço', 'x'.repeat(2001)]) {
      await violation(
        tools.db
          .insert(schema.supportRequest)
          .values({ userId: ana.id, category: 'conta', message }),
        /support_request_message_check/,
      );
    }
  });
});
