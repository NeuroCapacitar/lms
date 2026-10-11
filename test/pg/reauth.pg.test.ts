import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { LINK_LIMITS } from '../../src/features/identity/link-policy.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { requireCapability } from '../../src/server/auth/authorization.ts';
import { createAuth } from '../../src/server/auth/create-auth.ts';
import { requireRecentAuth } from '../../src/server/auth/reauth.ts';
import type { AuthVars } from '../../src/server/auth/types.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { sha256Hex } from '../../src/server/crypto.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-05 em Postgres 18 real: reautenticação recente. O desafio nasce de uma sessão, vale só nela,
 * é de uso único e expira; entrar há pouco NÃO conta como prova; o guard devolve um código próprio.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

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

const app = () => apiApp({ emailSender: sender, isStaffEmail: async () => false });

/** Uma pessoa com `login()` que abre uma NOVA sessão a cada chamada. */
async function newUser() {
  seq += 1;
  const user = tools.test.createUser({
    email: `pessoa${seq}@example.test`,
    name: `Pessoa ${seq}`,
  });
  await tools.test.saveUser(user);
  const login = async () => {
    const result = await tools.test.login({ userId: user.id });
    return { headers: result.headers, sessionId: result.session.id };
  };
  return { id: user.id, email: user.email, login };
}

function post(path: string, body: unknown, headers: Headers | undefined) {
  const merged = new Headers(headers);
  merged.set('content-type', 'application/json');
  merged.set('origin', BASE_URL);
  return app().request(
    `/api${path}`,
    { method: 'POST', headers: merged, body: JSON.stringify(body) },
    env(),
  );
}
const requestReauth = (headers: Headers | undefined) => post('/auth/reauth/request', {}, headers);
const confirm = (token: string, headers: Headers | undefined) =>
  post('/auth/reauth/confirm', { token }, headers);

async function tokenOfLastEmail(): Promise<string> {
  await Promise.resolve();
  const message = sender.sent.at(-1);
  expect(message, 'um e-mail foi enviado').toBeDefined();
  const url = new URL(message!.variables.LINK_URL!);
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  expect(params.get('purpose')).toBe('reauth');
  return params.get('token')!;
}

async function recentAuth(headers: Headers) {
  const response = await app().request('/api/me/access', { headers }, env());
  expect(response.status).toBe(200);
  return ((await response.json()) as { recentAuth: boolean }).recentAuth;
}

/** App de teste com o guard, depois de `requireCapability` (como será nas ações de Staff). */
function guardedApp() {
  const guarded = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  guarded.use(
    '*',
    createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
      const opened = await openDatabase(c.env.HYPERDRIVE.connectionString);
      try {
        c.set('db', opened.db);
        c.set(
          'auth',
          createAuth(
            opened.db,
            { baseUrl: BASE_URL, secret: SECRET },
            {
              emailSender: createFakeEmailSender(),
              isStaffEmail: async () => false,
              isStaffUser: async () => false,
              isSuspended: async () => false,
            },
          ),
        );
        await next();
      } finally {
        await opened.close();
      }
    }),
  );
  guarded.get('/sensitive', requireRecentAuth(), (c) => c.json({ ok: true }));
  guarded.get('/staff-sensitive', requireCapability('staff.read'), requireRecentAuth(), (c) =>
    c.json({ ok: true }),
  );
  return guarded;
}
const callGuarded = (path: string, headers?: Headers) =>
  guardedApp().request(path, { headers }, env());

describe('pedido do link de reautenticação', () => {
  it('exige sessão e manda o link SÓ para o e-mail da própria sessão, com a finalidade no fragmento', async () => {
    const person = await newUser();
    expect((await post('/auth/reauth/request', {}, undefined)).status).toBe(401);
    expect(sender.sent).toHaveLength(0);

    const { headers } = await person.login();
    const response = await requestReauth(headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    const message = sender.sent.at(-1)!;
    expect(message.to).toBe(person.email);
    expect(message.template).toBe('reauth-link');
    expect(message.variables.LINK_URL).toMatch(
      /^https:\/\/app\.example\.test\/entrar\/confirmar#token=[^&]+&purpose=reauth$/,
    );
  });

  it('o corpo não escolhe o destinatário: qualquer campo extra é recusado', async () => {
    const person = await newUser();
    const { headers } = await person.login();
    const response = await post('/auth/reauth/request', { email: 'outra@example.test' }, headers);
    expect(response.status).toBe(400);
    expect(sender.sent).toHaveLength(0);
  });

  it('o token é guardado só como hash (SHA-256), nunca em texto', async () => {
    const person = await newUser();
    const { headers, sessionId } = await person.login();
    await requestReauth(headers);
    const token = await tokenOfLastEmail();
    const rows = await tools.db
      .select()
      .from(schema.reauthChallenge)
      .where(eq(schema.reauthChallenge.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(await sha256Hex(token));
    expect(rows[0]!.tokenHash).not.toBe(token);
  });

  it('tem limite por pessoa: a quarta tentativa na janela recebe 429 e não envia e-mail', async () => {
    const person = await newUser();
    const { headers } = await person.login();
    for (let i = 0; i < LINK_LIMITS.perEmail.max; i += 1) {
      expect((await requestReauth(headers)).status).toBe(200);
    }
    const sentBefore = sender.sent.length;
    const blocked = await requestReauth(headers);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: { code: 'rate_limited' } });
    expect(sender.sent).toHaveLength(sentBefore);
  });
});

describe('confirmação', () => {
  it('confirma na mesma sessão, uma única vez, e passa a valer como prova recente', async () => {
    const person = await newUser();
    const { headers } = await person.login();
    expect(await recentAuth(headers), 'entrar não é reautenticar').toBe(false);
    await requestReauth(headers);
    const token = await tokenOfLastEmail();

    const ok = await confirm(token, headers);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'ok' });
    expect(await recentAuth(headers)).toBe(true);

    const reuse = await confirm(token, headers);
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toEqual({ error: { code: 'invalid_or_expired_link' } });
  });

  it('o token de uma sessão não vale em OUTRA sessão da mesma pessoa, e não a gasta', async () => {
    const person = await newUser();
    const first = await person.login();
    const second = await person.login();
    await requestReauth(first.headers);
    const token = await tokenOfLastEmail();

    expect((await confirm(token, second.headers)).status).toBe(400);
    expect(await recentAuth(second.headers)).toBe(false);
    // a tentativa na sessão errada não consumiu o desafio
    expect((await confirm(token, first.headers)).status).toBe(200);
    expect(await recentAuth(first.headers)).toBe(true);
    expect(await recentAuth(second.headers), 'a prova é só da sessão que confirmou').toBe(false);
  });

  it('o token de outra pessoa não vale', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const aliceSession = await alice.login();
    const bobSession = await bob.login();
    await requestReauth(aliceSession.headers);
    const token = await tokenOfLastEmail();
    expect((await confirm(token, bobSession.headers)).status).toBe(400);
    expect(await recentAuth(bobSession.headers)).toBe(false);
  });

  it('sem sessão é 401; corpo inválido é 400; token inventado é 400', async () => {
    const person = await newUser();
    const { headers } = await person.login();
    expect((await confirm('token-qualquer-com-mais-de-16-caracteres', undefined)).status).toBe(401);
    expect((await post('/auth/reauth/confirm', {}, headers)).status).toBe(400);
    expect((await confirm('token-inventado-com-mais-de-16-caracteres', headers)).status).toBe(400);
  });

  it('o desafio expirado não vale', async () => {
    const person = await newUser();
    const { headers, sessionId } = await person.login();
    await requestReauth(headers);
    const token = await tokenOfLastEmail();
    await tools.db
      .update(schema.reauthChallenge)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.reauthChallenge.sessionId, sessionId));
    expect((await confirm(token, headers)).status).toBe(400);
    expect(await recentAuth(headers)).toBe(false);
  });

  it('a prova vence depois da janela de 10 minutos', async () => {
    const person = await newUser();
    const { headers, sessionId } = await person.login();
    await requestReauth(headers);
    expect((await confirm(await tokenOfLastEmail(), headers)).status).toBe(200);
    expect(await recentAuth(headers)).toBe(true);
    await tools.db
      .update(schema.reauthProof)
      .set({ verifiedAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(schema.reauthProof.sessionId, sessionId));
    expect(await recentAuth(headers)).toBe(false);
  });

  it('encerrar a sessão apaga desafios e prova (cascata)', async () => {
    const person = await newUser();
    const { headers, sessionId } = await person.login();
    await requestReauth(headers);
    await confirm(await tokenOfLastEmail(), headers);
    await tools.db.delete(schema.session).where(eq(schema.session.id, sessionId));
    expect(
      await tools.db
        .select()
        .from(schema.reauthProof)
        .where(eq(schema.reauthProof.sessionId, sessionId)),
    ).toHaveLength(0);
    expect(
      await tools.db
        .select()
        .from(schema.reauthChallenge)
        .where(eq(schema.reauthChallenge.sessionId, sessionId)),
    ).toHaveLength(0);
  });
});

describe('guard requireRecentAuth', () => {
  it('sem sessão 401; sem prova 403 reauth_required; com prova passa', async () => {
    const person = await newUser();
    expect((await callGuarded('/sensitive')).status).toBe(401);

    const { headers } = await person.login();
    const denied = await callGuarded('/sensitive', headers);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: 'reauth_required' } });

    await requestReauth(headers);
    await confirm(await tokenOfLastEmail(), headers);
    expect((await callGuarded('/sensitive', headers)).status).toBe(200);
  });

  it('a prova de uma sessão não libera outra sessão da mesma pessoa', async () => {
    const person = await newUser();
    const first = await person.login();
    const second = await person.login();
    await requestReauth(first.headers);
    await confirm(await tokenOfLastEmail(), first.headers);
    expect((await callGuarded('/sensitive', first.headers)).status).toBe(200);
    expect((await callGuarded('/sensitive', second.headers)).status).toBe(403);
  });

  it('com a capability: `forbidden` e `reauth_required` são respostas diferentes', async () => {
    const admin = await newUser();
    await grantRole(tools.db, { actorId: null, targetId: admin.id, role: 'admin' });
    const student = await newUser();

    const studentSession = await student.login();
    const adminSession = await admin.login();

    // sem capability: 403 forbidden, mesmo que a reautenticação estivesse em dia
    const forbidden = await callGuarded('/staff-sensitive', studentSession.headers);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: { code: 'forbidden' } });

    // com capability e sem prova: o código muda, para a interface pedir o link
    const needsReauth = await callGuarded('/staff-sensitive', adminSession.headers);
    expect(needsReauth.status).toBe(403);
    expect(await needsReauth.json()).toEqual({ error: { code: 'reauth_required' } });

    await requestReauth(adminSession.headers);
    await confirm(await tokenOfLastEmail(), adminSession.headers);
    expect((await callGuarded('/staff-sensitive', adminSession.headers)).status).toBe(200);
  });
});
