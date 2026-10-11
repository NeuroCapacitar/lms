import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-01 em Postgres 18 real: sessão (criação, renovação, expiração, logout), cookie, origem
 * confiável e `GET /api/me`, pela rota real (`authRoutes`) e pelo handler do Better Auth.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const DAY = 24 * 60 * 60 * 1000;

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
afterEach(() => vi.useRealTimers());

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
  }) as unknown as Env;

/** Cria uma pessoa e uma sessão sem passar por método de login. */
async function signedInUser() {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  const login = await tools.test.login({ userId: user.id });
  return { user, headers: login.headers };
}

// Monta as rotas em /api, como no Worker (o Better Auth confere o caminho base /api/auth).
const app = apiApp();
const call = (path: string, init: RequestInit = {}) => app.request(`/api${path}`, init, env());
const sessionOf = (userId: string) =>
  tools.db.select().from(schema.session).where(eq(schema.session.userId, userId));

describe('GET /api/me', () => {
  it('sem sessão responde 401, e com cookie forjado também', async () => {
    expect((await call('/me')).status).toBe(401);
    const forged = await call('/me', {
      headers: { cookie: '__Secure-better-auth.session_token=falso.falso' },
    });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: { code: 'unauthenticated' } });
  });

  it('com sessão válida devolve só o DTO mínimo e nunca é cacheável', async () => {
    const { user, headers } = await signedInUser();
    const response = await call('/me', { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: user.id, email: user.email, name: user.name });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('sessão de 7 dias rolling', () => {
  it('nasce com ~7 dias e é renovada depois de 1 dia de uso (updateAge)', async () => {
    const { user, headers } = await signedInUser();
    const [created] = await sessionOf(user.id);
    expect(created).toBeDefined();
    const days = (created!.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    // Sessão "usada pela última vez" há 2 dias, com 5 dias restantes.
    await tools.db
      .update(schema.session)
      .set({
        updatedAt: new Date(Date.now() - 2 * DAY),
        expiresAt: new Date(Date.now() + 5 * DAY),
      })
      .where(eq(schema.session.id, created!.id));
    const refreshed = await call('/me', { headers });
    expect(refreshed.status).toBe(200);
    const [after] = await sessionOf(user.id);
    expect((after!.expiresAt.getTime() - Date.now()) / DAY).toBeGreaterThan(6.9);
  });

  it('dentro do mesmo dia não reescreve a sessão (sem escrita a cada requisição)', async () => {
    const { user, headers } = await signedInUser();
    const [before] = await sessionOf(user.id);
    await call('/me', { headers });
    await call('/me', { headers });
    const [after] = await sessionOf(user.id);
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  it('expira depois de 7 dias sem uso (relógio controlado) e /api/me passa a responder 401', async () => {
    const { headers } = await signedInUser();
    expect((await call('/me', { headers })).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7 * DAY + 60_000 });
    expect((await call('/me', { headers })).status).toBe(401);
  });

  it('o cookie sai com HttpOnly, Secure, SameSite=Lax, 7 dias e prefixo __Secure- em https', async () => {
    const { user, headers } = await signedInUser();
    const [row] = await sessionOf(user.id);
    await tools.db
      .update(schema.session)
      .set({
        updatedAt: new Date(Date.now() - 2 * DAY),
        expiresAt: new Date(Date.now() + 5 * DAY),
      })
      .where(eq(schema.session.id, row!.id));
    const response = await call('/me', { headers });
    const cookie = response.headers.getSetCookie().find((value) => value.includes('session_token'));
    expect(cookie, 'a renovação reenvia o cookie').toBeDefined();
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=604800/);
    expect(cookie).toMatch(/Path=\//);
  });
});

describe('logout e origem confiável', () => {
  it('sign-out apaga a sessão no banco e invalida o cookie na hora', async () => {
    const { user, headers } = await signedInUser();
    const withOrigin = new Headers(headers);
    withOrigin.set('origin', BASE_URL);
    withOrigin.set('content-type', 'application/json');
    const out = await call('/auth/sign-out', { method: 'POST', headers: withOrigin, body: '{}' });
    expect(out.status).toBe(200);
    expect(await sessionOf(user.id)).toHaveLength(0);
    expect((await call('/me', { headers })).status).toBe(401);
  });

  it('POST de origem não confiável é recusado e a sessão permanece', async () => {
    const { user, headers } = await signedInUser();
    const evil = new Headers(headers);
    evil.set('origin', 'https://evil.example');
    const out = await call('/auth/sign-out', { method: 'POST', headers: evil });
    expect(out.status).toBe(403);
    expect(await sessionOf(user.id)).toHaveLength(1);
  });

  it('POST com cookie de sessão mas sem cabeçalho Origin é recusado (CSRF) e a sessão permanece', async () => {
    const { user, headers } = await signedInUser();
    const out = await call('/auth/sign-out', { method: 'POST', headers });
    expect(out.status).toBe(403);
    expect(await sessionOf(user.id)).toHaveLength(1);
  });
});

describe('isolamento entre pessoas', () => {
  it('o cookie de uma pessoa nunca devolve os dados de outra', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const meA = (await (await call('/me', { headers: a.headers })).json()) as { id: string };
    const meB = (await (await call('/me', { headers: b.headers })).json()) as { id: string };
    expect(meA.id).toBe(a.user.id);
    expect(meB.id).toBe(b.user.id);
    expect(meA.id).not.toBe(meB.id);
  });
});
