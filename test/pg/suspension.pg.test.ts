import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { grantRole, loadAccess, suspendUser } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-08 em Postgres 18 real: suspensão e reativação pelas rotas reais (`staff.manage` +
 * reautenticação recente), efeito imediato, login recusado com resposta genérica e a corrida entre
 * login e suspensão (nenhuma sessão sobrevive).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const HUMAN = 'token-humano';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let sender: ReturnType<typeof createFakeEmailSender>;
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
  sender = createFakeEmailSender();
  await tools.db.delete(schema.authThrottle);
  await tools.db.delete(schema.verification);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.userSuspension);
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

const turnstileFetch = (async (_url: unknown, init?: RequestInit) => {
  const response = new URLSearchParams(String(init?.body)).get('response');
  return Response.json({ success: response === HUMAN });
}) as unknown as typeof fetch;

const app = () => apiApp({ emailSender: sender, isStaffEmail: async () => false, turnstileFetch });

async function newUser(email?: string) {
  seq += 1;
  const user = tools.test.createUser({
    email: email ?? `pessoa${seq}@example.test`,
    name: `Pessoa ${seq}`,
  });
  await tools.test.saveUser(user);
  await tools.db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, user.id));
  const login = async () => {
    const result = await tools.test.login({ userId: user.id });
    return { headers: result.headers, sessionId: result.session.id };
  };
  return { id: user.id, email: user.email, login };
}

async function newAdmin(options: { reauth?: boolean } = {}) {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'admin' });
  const session = await person.login();
  if (options.reauth ?? true) {
    await tools.db
      .insert(schema.reauthProof)
      .values({ sessionId: session.sessionId, verifiedAt: new Date() });
  }
  return { ...person, ...session };
}

async function newSupport() {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'support' });
  const session = await person.login();
  await tools.db
    .insert(schema.reauthProof)
    .values({ sessionId: session.sessionId, verifiedAt: new Date() });
  return { ...person, ...session };
}

function post(path: string, headers: Headers | undefined, body?: unknown, extra: HeadersInit = {}) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  for (const [key, value] of new Headers(extra)) merged.set(key, value);
  return app().request(
    path,
    {
      method: 'POST',
      headers: merged,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
}
const suspend = (id: string, headers: Headers | undefined, body?: unknown) =>
  post(`/api/staff/users/${id}/suspend`, headers, body);
const reactivate = (id: string, headers: Headers | undefined) =>
  post(`/api/staff/users/${id}/reactivate`, headers, {});

const sessionsOf = (userId: string) =>
  tools.db.select().from(schema.session).where(eq(schema.session.userId, userId));
const activeSuspensions = (userId: string) =>
  tools.db
    .select()
    .from(schema.userSuspension)
    .where(and(eq(schema.userSuspension.userId, userId), isNull(schema.userSuspension.liftedAt)));

describe('rotas de suspender e reativar', () => {
  it('exigem sessão, capability de Admin e reautenticação recente; sem isso nada muda', async () => {
    const target = await newUser();
    const targetSession = await target.login();
    const withoutReauth = await newAdmin({ reauth: false });
    const support = await newSupport();
    const student = await newUser();
    const studentSession = await student.login();

    for (const action of [suspend, reactivate]) {
      expect((await action(target.id, undefined)).status).toBe(401);
      for (const who of [support, studentSession]) {
        const denied = await action(target.id, who.headers);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({ error: { code: 'forbidden' } });
      }
      const needsReauth = await action(target.id, withoutReauth.headers);
      expect(needsReauth.status).toBe(403);
      expect(await needsReauth.json()).toEqual({ error: { code: 'reauth_required' } });
    }
    expect(await activeSuspensions(target.id)).toHaveLength(0);
    expect(await sessionsOf(target.id)).toHaveLength(1);
    expect(targetSession.sessionId).toBeTruthy();
  });

  it('suspender apaga as sessões, nega o acesso na requisição seguinte e audita, sem e-mail', async () => {
    const admin = await newAdmin();
    const target = await newUser();
    const first = await target.login();
    await target.login();
    expect(await sessionsOf(target.id)).toHaveLength(2);

    const response = await suspend(target.id, admin.headers, { reason: 'abuso confirmado' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', changed: true });
    expect(await sessionsOf(target.id)).toHaveLength(0);
    // a sessão antiga não vale mais na requisição seguinte
    expect((await app().request('/api/me', { headers: first.headers }, env())).status).toBe(401);
    expect((await loadAccess(tools.db, target.id)).suspended).toBe(true);

    const audit = (await tools.db.select().from(schema.auditLog)).find(
      (entry) => entry.action === 'account.suspend',
    );
    expect(audit).toMatchObject({ actorId: admin.id, targetType: 'user', targetId: target.id });
    expect(audit!.details).toEqual({ reason: 'abuso confirmado' });
    expect(JSON.stringify(audit)).not.toContain(target.email);

    // repetir não muda nada
    const again = await suspend(target.id, admin.headers, {});
    expect(await again.json()).toEqual({ status: 'ok', changed: false });
    expect(await activeSuspensions(target.id)).toHaveLength(1);
  });

  it('suspender um Suporte tira o acesso dele já na requisição seguinte', async () => {
    const admin = await newAdmin();
    const support = await newSupport();
    expect((await loadAccess(tools.db, support.id)).roles.has('support')).toBe(true);
    await suspend(support.id, admin.headers);
    const access = await loadAccess(tools.db, support.id);
    expect(access.suspended).toBe(true);
    expect((await sessionsOf(support.id)).length).toBe(0);
  });

  it('valida o pedido: id malformado ou desconhecido é 404; motivo longo ou campo extra é 400', async () => {
    const admin = await newAdmin();
    const target = await newUser();
    expect((await suspend('../etc', admin.headers, {})).status).toBe(404);
    expect((await suspend('id-que-nao-existe', admin.headers, {})).status).toBe(404);
    expect((await reactivate('id-que-nao-existe', admin.headers)).status).toBe(404);
    expect((await suspend(target.id, admin.headers, { reason: 'x'.repeat(201) })).status).toBe(400);
    expect((await suspend(target.id, admin.headers, { reason: '   ' })).status).toBe(400);
    expect((await suspend(target.id, admin.headers, { reason: 'ok', extra: 1 })).status).toBe(400);
    expect((await suspend(target.id, admin.headers, null)).status).toBe(400);
    expect(await activeSuspensions(target.id)).toHaveLength(0);
    // sem corpo também é válido (motivo é opcional)
    const noBody = await post(`/api/staff/users/${target.id}/suspend`, admin.headers);
    expect(noBody.status).toBe(200);
  });

  it('não suspende o último Admin ativo (nem a si mesmo); com dois, suspende um e o outro fica protegido', async () => {
    const only = await newAdmin();
    const blocked = await suspend(only.id, only.headers, {});
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: { code: 'last_admin' } });
    expect(await activeSuspensions(only.id)).toHaveLength(0);
    expect(await sessionsOf(only.id)).toHaveLength(1);

    const other = await newAdmin();
    expect((await suspend(other.id, only.headers, {})).status).toBe(200);
    const again = await suspend(only.id, only.headers, {});
    expect(again.status).toBe(409);
    expect(await activeSuspensions(only.id)).toHaveLength(0);
  });

  it('reativar levanta a suspensão, audita e a pessoa volta a ganhar sessão; repetir não muda nada', async () => {
    const admin = await newAdmin();
    const target = await newUser();
    await suspend(target.id, admin.headers, { reason: 'teste' });
    const response = await reactivate(target.id, admin.headers);
    expect(await response.json()).toEqual({ status: 'ok', changed: true });
    expect((await loadAccess(tools.db, target.id)).suspended).toBe(false);
    const session = await target.login();
    expect((await app().request('/api/me', { headers: session.headers }, env())).status).toBe(200);
    const actions = (await tools.db.select().from(schema.auditLog)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['account.suspend', 'account.reactivate']));
    expect(await (await reactivate(target.id, admin.headers)).json()).toEqual({
      status: 'ok',
      changed: false,
    });
  });
});

describe('conta suspensa não entra', () => {
  const requestLink = (email: string) =>
    post(
      '/api/auth/link/request',
      undefined,
      { email, captchaToken: HUMAN },
      {
        'cf-connecting-ip': `203.0.113.${(seq += 1)}`,
      },
    );
  const confirm = (token: string) => post('/api/auth/link/confirm', undefined, { token });
  const tokenOfLastEmail = () => {
    const message = sender.sent.at(-1);
    expect(message, 'um e-mail foi enviado').toBeDefined();
    return decodeURIComponent(new URL(message!.variables.LINK_URL!).hash.replace('#token=', ''));
  };

  it('um link emitido ANTES da suspensão não vale depois, com a mesma resposta de link inválido', async () => {
    const admin = await newAdmin();
    const target = await newUser('suspenso@example.test');
    expect((await requestLink(target.email)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const token = tokenOfLastEmail();
    await suspend(target.id, admin.headers, {});

    const refused = await confirm(token);
    const garbage = await confirm('token-inventado-com-mais-de-16-caracteres');
    expect(refused.status).toBe(400);
    expect(refused.headers.get('set-cookie')).toBeNull();
    expect(await refused.json()).toEqual(await garbage.json());
    expect(await sessionsOf(target.id)).toHaveLength(0);
  });

  it('pedir link para conta suspensa responde igual e NÃO envia e-mail; reativada, envia', async () => {
    const admin = await newAdmin();
    const target = await newUser('bloqueada@example.test');
    await suspend(target.id, admin.headers, {});
    const response = await requestLink(target.email);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sender.sent).toHaveLength(0);

    await reactivate(target.id, admin.headers);
    await requestLink(target.email);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sender.sent).toHaveLength(1);
  });
});

describe('suspensão x login em andamento (nenhuma sessão sobrevive)', () => {
  const insertSession = (db: Awaited<ReturnType<typeof openDatabase>>['db'], userId: string) =>
    db.insert(schema.session).values({
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    });

  it('o banco recusa sessão nova para conta suspensa (última barreira)', async () => {
    const target = await newUser();
    await suspendUser(tools.db, { actorId: null, targetId: target.id });
    const error = await Promise.resolve(insertSession(tools.db, target.id)).then(
      () => null,
      (caught: { cause?: { code?: string; message?: string } }) => caught,
    );
    expect(error?.cause?.code).toBe('23001');
    expect(error?.cause?.message).toBe('account_suspended');
    expect(await sessionsOf(target.id)).toHaveLength(0);
  });

  it('suspensão em andamento: o login espera e é recusado; nada sobrevive', async () => {
    const target = await newUser();
    const c1 = await database.client();
    const c2 = await database.client();
    try {
      await c1.query('begin');
      await c1.query('select 1 from "user" where id = $1 for update', [target.id]);
      await c1.query('insert into user_suspension (user_id) values ($1)', [target.id]);
      let settled = false;
      const login = c2
        .query(
          `insert into session (id, expires_at, token, user_id) values ($1, now() + interval '1 minute', $2, $3)`,
          [crypto.randomUUID(), crypto.randomUUID(), target.id],
        )
        .then(
          () => ({ ok: true as const, code: '' }),
          (error: { code?: string }) => ({ ok: false as const, code: error.code ?? '' }),
        )
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled, 'o login espera a suspensão terminar').toBe(false);
      await c1.query('delete from session where user_id = $1', [target.id]);
      await c1.query('commit');
      expect(await login).toEqual({ ok: false, code: '23001' });
    } finally {
      await c1.end();
      await c2.end();
    }
    expect(await sessionsOf(target.id)).toHaveLength(0);
  });

  it('login em andamento: a suspensão espera e apaga a sessão recém-criada', async () => {
    const target = await newUser();
    const c2 = await database.client();
    const other = await openDatabase(database.connectionString);
    try {
      await c2.query('begin');
      await c2.query(
        `insert into session (id, expires_at, token, user_id) values ($1, now() + interval '1 minute', $2, $3)`,
        [crypto.randomUUID(), crypto.randomUUID(), target.id],
      );
      let settled = false;
      const suspension = suspendUser(other.db, { actorId: null, targetId: target.id }).finally(
        () => {
          settled = true;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled, 'a suspensão espera o login terminar').toBe(false);
      await c2.query('commit');
      expect(await suspension).toBe(true);
    } finally {
      await c2.end();
      await other.close();
    }
    expect(await activeSuspensions(target.id)).toHaveLength(1);
    expect(await sessionsOf(target.id)).toHaveLength(0);
  });

  it('corrida repetida (conexões separadas): suspensa, nunca com sessão', async () => {
    const [a, b] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    try {
      for (let round = 0; round < 15; round += 1) {
        const target = await newUser();
        await Promise.allSettled([
          suspendUser(a.db, { actorId: null, targetId: target.id }),
          insertSession(b.db, target.id),
        ]);
        expect(await activeSuspensions(target.id), `rodada ${round}: suspensa`).toHaveLength(1);
        expect(await sessionsOf(target.id), `rodada ${round}: sem sessão`).toHaveLength(0);
      }
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});
