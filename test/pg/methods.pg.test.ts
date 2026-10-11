import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { PASSWORD_LIMITS, PASSWORD_MIN_LENGTH } from '../../src/features/identity/credentials.ts';
import { grantRole, suspendUser } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-07 em Postgres 18 real: senha e Google OPCIONAIS do aluno (só se adicionam depois de entrar
 * por link), Staff só por link, respostas de falha iguais e rotas nativas do Better Auth fechadas.
 * O Google é simulado só no endpoint de token (`oauth2.googleapis.com/token`), sem rede.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const HUMAN = 'token-humano';
const STRONG = 'uma-senha-bem-longa-123';
const GOOGLE = {
  clientId: 'cliente-de-teste.apps.example',
  clientSecret: 'segredo-google-de-teste',
};

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
  await tools.db.delete(schema.account);
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});
afterEach(() => vi.restoreAllMocks());

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

const app = (google: typeof GOOGLE | null = GOOGLE) =>
  apiApp({ emailSender: sender, turnstileFetch, google });

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

/** Sessão com prova de reautenticação recente (o fluxo do link já tem teste próprio). */
async function withReauth(person: Awaited<ReturnType<typeof newUser>>) {
  const session = await person.login();
  await tools.db
    .insert(schema.reauthProof)
    .values({ sessionId: session.sessionId, verifiedAt: new Date() });
  return session;
}

function send(
  method: string,
  path: string,
  options: { headers?: HeadersInit; body?: unknown; google?: typeof GOOGLE | null } = {},
) {
  const headers = new Headers(options.headers);
  headers.set('origin', BASE_URL);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  return app(options.google === undefined ? GOOGLE : options.google).request(
    `/api${path}`,
    {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    env(),
  );
}
const post = (path: string, headers: HeadersInit | undefined, body: unknown = {}) =>
  send('POST', path, { headers, body });

const signInWithPassword = (email: string, password: string, ip = `198.51.100.${(seq += 1)}`) =>
  send('POST', '/auth/password/sign-in', {
    headers: { 'cf-connecting-ip': ip },
    body: { email, password, captchaToken: HUMAN },
  });

const sessionsOf = (userId: string) =>
  tools.db.select().from(schema.session).where(eq(schema.session.userId, userId));
const accountsOf = (userId: string) =>
  tools.db.select().from(schema.account).where(eq(schema.account.userId, userId));
const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

async function meWith(cookie: string) {
  return send('GET', '/me', { headers: { cookie } });
}

describe('senha: definir, entrar e remover', () => {
  it('definir exige sessão, reautenticação recente e senha longa; guarda só o hash', async () => {
    const person = await newUser();
    expect((await post('/me/security/password', undefined, { password: STRONG })).status).toBe(401);

    const plain = await person.login();
    const needsReauth = await post('/me/security/password', plain.headers, { password: STRONG });
    expect(needsReauth.status).toBe(403);
    expect(await needsReauth.json()).toEqual({ error: { code: 'reauth_required' } });

    const session = await withReauth(person);
    const weak = await post('/me/security/password', session.headers, {
      password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
    });
    expect(weak.status).toBe(400);
    expect(
      (await post('/me/security/password', session.headers, { password: STRONG, x: 1 })).status,
    ).toBe(400);
    expect(await accountsOf(person.id)).toHaveLength(0);

    expect(
      (await post('/me/security/password', session.headers, { password: STRONG })).status,
    ).toBe(200);
    const [account] = await accountsOf(person.id);
    expect(account).toMatchObject({ providerId: 'credential' });
    expect(account!.password).toBeTruthy();
    expect(account!.password).not.toContain(STRONG);
  });

  it('entrar por senha: Turnstile, sessão em cookie HttpOnly e nenhum token no corpo', async () => {
    const person = await newUser('senha@example.test');
    await post('/me/security/password', (await withReauth(person)).headers, { password: STRONG });
    const before = (await sessionsOf(person.id)).length;

    const noHuman = await send('POST', '/auth/password/sign-in', {
      body: { email: person.email, password: STRONG, captchaToken: 'robo' },
    });
    expect(noHuman.status).toBe(403);
    expect(await noHuman.json()).toEqual({ error: { code: 'captcha_failed' } });

    const ok = await signInWithPassword(person.email.toUpperCase(), STRONG);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'ok' });
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.getSetCookie().join(';')).toMatch(/session_token=.*HttpOnly/i);
    expect((await sessionsOf(person.id)).length).toBe(before + 1);
    expect((await meWith(cookiesFrom(ok))).status).toBe(200);
  });

  it('senha errada, e-mail sem senha e e-mail desconhecido recebem a MESMA resposta', async () => {
    const person = await newUser('com@example.test');
    await post('/me/security/password', (await withReauth(person)).headers, { password: STRONG });
    const noPassword = await newUser('sem@example.test');
    const answers = await Promise.all([
      signInWithPassword(person.email, 'senha-errada-qualquer'),
      signInWithPassword(noPassword.email, STRONG),
      signInWithPassword('ninguem@example.test', STRONG),
    ]);
    for (const response of answers) {
      expect(response.status).toBe(401);
      expect(await response.clone().json()).toEqual({ error: { code: 'invalid_credentials' } });
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
  });

  it('Staff com a senha CERTA e conta suspensa recebem a mesma resposta; nenhuma sessão nasce', async () => {
    const staff = await newUser('equipe@example.test');
    await post('/me/security/password', (await withReauth(staff)).headers, { password: STRONG });
    await grantRole(tools.db, { actorId: null, targetId: staff.id, role: 'support' });
    expect(await sessionsOf(staff.id), 'conceder o papel encerra as sessões').toHaveLength(0);

    const suspended = await newUser('suspensa@example.test');
    await post('/me/security/password', (await withReauth(suspended)).headers, {
      password: STRONG,
    });
    await suspendUser(tools.db, { actorId: null, targetId: suspended.id });

    const wrong = await signInWithPassword('equipe@example.test', 'senha-errada-qualquer');
    for (const email of [staff.email, suspended.email]) {
      const response = await signInWithPassword(email, STRONG);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(await wrong.clone().json());
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
    expect(await sessionsOf(staff.id)).toHaveLength(0);
    expect(await sessionsOf(suspended.id)).toHaveLength(0);
    // a credencial fica inativa, não apagada
    expect(await accountsOf(staff.id)).toHaveLength(1);
  });

  it('Staff entra por link de acesso (o único caminho permitido) e não define senha', async () => {
    const staff = await newUser('equipe2@example.test');
    await grantRole(tools.db, { actorId: null, targetId: staff.id, role: 'support' });
    const link = await send('POST', '/auth/link/request', {
      headers: { 'cf-connecting-ip': '198.51.100.250' },
      body: { email: staff.email, captchaToken: HUMAN },
    });
    expect(link.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const message = sender.sent.at(-1);
    expect(message, 'a Staff recebe o link').toBeDefined();
    const token = decodeURIComponent(
      new URL(message!.variables.LINK_URL!).hash.replace('#token=', ''),
    );
    const confirm = await send('POST', '/auth/link/confirm', { body: { token } });
    expect(confirm.status).toBe(200);
    const cookie = cookiesFrom(confirm);
    expect((await meWith(cookie)).status).toBe(200);

    // com prova recente, ainda assim Staff não define senha nem liga Google
    const session = await withReauth(staff);
    expect(
      (await post('/me/security/password', session.headers, { password: STRONG })).status,
    ).toBe(403);
    expect((await post('/me/security/google/link', session.headers)).status).toBe(403);
    expect(await accountsOf(staff.id)).toHaveLength(0);
  });

  it('tem limite por e-mail (a 11ª tentativa recebe 429) e por IP', async () => {
    const person = await newUser('limite@example.test');
    let last = 0;
    for (let i = 0; i <= PASSWORD_LIMITS.perEmail.max; i += 1) {
      last = (await signInWithPassword(person.email, `errada-${i}`, `198.51.100.${200 + i}`))
        .status;
    }
    expect(last).toBe(429);
    await tools.db.delete(schema.authThrottle);
    let blockedByIp = 0;
    for (let i = 0; i <= PASSWORD_LIMITS.perIp.max; i += 1) {
      blockedByIp = (await signInWithPassword(`alvo${i}@example.test`, 'x', '203.0.113.99')).status;
    }
    expect(blockedByIp).toBe(429);
  });

  it('remover a senha exige reautenticação e o link de acesso continua entrando', async () => {
    const person = await newUser('remove@example.test');
    const session = await withReauth(person);
    await post('/me/security/password', session.headers, { password: STRONG });
    const fresh = await person.login();
    const denied = await post('/me/security/password/remove', fresh.headers);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: 'reauth_required' } });

    expect((await post('/me/security/password/remove', session.headers)).status).toBe(200);
    expect(await accountsOf(person.id)).toHaveLength(0);
    expect((await post('/me/security/password/remove', session.headers)).status).toBe(404);
    expect((await signInWithPassword(person.email, STRONG)).status).toBe(401);

    await send('POST', '/auth/link/request', {
      headers: { 'cf-connecting-ip': '198.51.100.240' },
      body: { email: person.email, captchaToken: HUMAN },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const token = decodeURIComponent(
      new URL(sender.sent.at(-1)!.variables.LINK_URL!).hash.replace('#token=', ''),
    );
    expect((await send('POST', '/auth/link/confirm', { body: { token } })).status).toBe(200);
  });

  it('GET /api/me/security mostra os métodos e se a conta pode mudá-los', async () => {
    const person = await newUser();
    const session = await withReauth(person);
    const before = await (await send('GET', '/me/security', { headers: session.headers })).json();
    expect(before).toEqual({
      methods: { password: false, google: false },
      googleAvailable: true,
      canManageMethods: true,
    });
    await post('/me/security/password', session.headers, { password: STRONG });
    const after = (await (
      await send('GET', '/me/security', { headers: session.headers })
    ).json()) as {
      methods: { password: boolean };
    };
    expect(after.methods.password).toBe(true);
    expect((await send('GET', '/me/security')).status).toBe(401);
    const off = await send('GET', '/me/security', { headers: session.headers, google: null });
    expect(((await off.json()) as { googleAvailable: boolean }).googleAvailable).toBe(false);
  });
});

describe('rotas nativas do Better Auth', () => {
  it('só o encerramento de sessão fica exposto; o resto é 404 (sem pular Turnstile, limites e reautenticação)', async () => {
    const person = await newUser();
    const session = await person.login();
    const closed: [string, string][] = [
      ['POST', '/auth/sign-in/email'],
      ['POST', '/auth/sign-up/email'],
      ['POST', '/auth/sign-in/social'],
      ['POST', '/auth/link-social'],
      ['POST', '/auth/unlink-account'],
      ['POST', '/auth/change-password'],
      ['POST', '/auth/set-password'],
      ['POST', '/auth/request-password-reset'],
      ['POST', '/auth/reset-password'],
      ['GET', '/auth/get-session'],
      ['GET', '/auth/list-sessions'],
      ['GET', '/auth/list-accounts'],
      ['POST', '/auth/update-user'],
      ['POST', '/auth/delete-user'],
      ['GET', '/auth/callback/github'],
    ];
    for (const [method, path] of closed) {
      const response = await send(method, path, {
        headers: session.headers,
        ...(method === 'POST' ? { body: {} } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect((await post('/auth/sign-out', session.headers)).status).toBe(200);
    expect(await sessionsOf(person.id)).toHaveLength(0);
  });
});

describe('/api/me renova o cookie da sessão rolling', () => {
  it('reenvia o cookie quando o Better Auth o renova', async () => {
    const person = await newUser();
    const { headers, sessionId } = await person.login();
    await tools.db
      .update(schema.session)
      .set({
        updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      })
      .where(eq(schema.session.id, sessionId));
    const response = await send('GET', '/me', { headers });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(';')).toMatch(/session_token=/);
  });
});

// ---- Google ----

function idToken(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', kid: 'teste' })}.${part(claims)}.assinatura`;
}

/** Simula só o endpoint de token do Google; o resto passa para o fetch real. */
function stubGoogle(claims: () => Record<string, unknown>) {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({
        access_token: 'acesso-de-teste',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
        id_token: idToken({
          iss: 'https://accounts.google.com',
          aud: GOOGLE.clientId,
          ...claims(),
        }),
      });
    }
    return real(input, init);
  });
}

/** Percorre o ciclo: gera o endereço do Google, "o usuário volta" com um código e devolve o retorno. */
async function viaGoogle(
  start: () => Response | Promise<Response>,
  options: { dropCookies?: boolean } = {},
) {
  const started = await start();
  expect(started.status).toBe(200);
  const { url } = (await started.json()) as { url: string };
  expect(new URL(url).origin).toBe('https://accounts.google.com');
  const state = new URL(url).searchParams.get('state')!;
  const cookie = options.dropCookies ? '' : cookiesFrom(started);
  return send('GET', `/auth/callback/google?code=codigo-de-teste&state=${state}`, {
    headers: cookie ? { cookie } : {},
  });
}

const googleLogin = () => viaGoogle(() => send('POST', '/auth/google/start', { body: {} }));
const googleLink = (headers: Headers) => viaGoogle(() => post('/me/security/google/link', headers));
const claimsFor =
  (email: string, extra: Record<string, unknown> = {}) =>
  () => ({
    sub: `google-${email}`,
    email,
    email_verified: true,
    name: 'Nome Google',
    ...extra,
  });

describe('Google: ligar, entrar e remover', () => {
  it('desligado sem credenciais: opções falsas e rotas 404', async () => {
    const options = await send('GET', '/auth/options', { google: null });
    expect(await options.json()).toEqual({ google: false });
    expect((await send('GET', '/auth/options')).status).toBe(200);
    expect(await (await send('GET', '/auth/options')).json()).toEqual({ google: true });
    expect((await send('POST', '/auth/google/start', { body: {}, google: null })).status).toBe(404);
    const person = await newUser();
    const session = await withReauth(person);
    expect(
      (
        await send('POST', '/me/security/google/link', {
          headers: session.headers,
          body: {},
          google: null,
        })
      ).status,
    ).toBe(404);
  });

  it('ligar exige reautenticação recente; com e-mail verificado e igual, liga a conta', async () => {
    const person = await newUser('liga@example.test');
    stubGoogle(claimsFor(person.email));
    const plain = await person.login();
    const denied = await post('/me/security/google/link', plain.headers);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: 'reauth_required' } });

    const session = await withReauth(person);
    const back = await googleLink(session.headers);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/conta/seguranca');
    const [account] = await accountsOf(person.id);
    expect(account).toMatchObject({ providerId: 'google', accountId: `google-${person.email}` });
  });

  it('depois de ligado, entra com Google (cookie de sessão) e o mesmo e-mail continua sendo a mesma pessoa', async () => {
    const person = await newUser('entra@example.test');
    stubGoogle(claimsFor(person.email));
    await googleLink((await withReauth(person)).headers);
    const before = (await tools.db.select().from(schema.user)).length;

    const back = await googleLogin();
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/');
    const me = await meWith(cookiesFrom(back));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(person.email);
    expect((await tools.db.select().from(schema.user)).length).toBe(before);
  });

  it('e-mail do Google NÃO verificado não liga a conta', async () => {
    const person = await newUser('naover@example.test');
    stubGoogle(claimsFor(person.email, { email_verified: false }));
    const back = await googleLink((await withReauth(person)).headers);
    expect(back.headers.get('location')).toBe('/conta/seguranca?erro=google');
    expect(await accountsOf(person.id)).toHaveLength(0);
  });

  it('e-mail do Google DIFERENTE não liga e não assume a conta', async () => {
    const person = await newUser('dono@example.test');
    stubGoogle(claimsFor('outro@example.test'));
    const back = await googleLink((await withReauth(person)).headers);
    expect(back.headers.get('location')).toBe('/conta/seguranca?erro=google');
    expect(await accountsOf(person.id)).toHaveLength(0);
  });

  it('Google nunca cria conta nem assume uma existente pelo e-mail igual (sem ligação implícita)', async () => {
    const person = await newUser('existente@example.test');
    const users = (await tools.db.select().from(schema.user)).length;

    stubGoogle(claimsFor(person.email));
    const sameEmail = await googleLogin();
    expect(sameEmail.headers.get('location')).toBe('/entrar?erro=google');
    expect(sameEmail.headers.getSetCookie().join(';')).not.toMatch(/session_token=[^;]+/);

    stubGoogle(claimsFor('desconhecida@example.test'));
    const unknown = await googleLogin();
    expect(unknown.headers.get('location')).toBe('/entrar?erro=google');

    expect(await sessionsOf(person.id)).toHaveLength(0);
    expect(await accountsOf(person.id)).toHaveLength(0);
    expect((await tools.db.select().from(schema.user)).length).toBe(users);
  });

  it('Staff e conta suspensa não entram com Google, mesmo ligado antes: mesmo redirecionamento genérico', async () => {
    const staff = await newUser('equipe-g@example.test');
    const suspended = await newUser('suspensa-g@example.test');
    for (const person of [staff, suspended]) {
      stubGoogle(claimsFor(person.email));
      await googleLink((await withReauth(person)).headers);
    }
    await grantRole(tools.db, { actorId: null, targetId: staff.id, role: 'support' });
    await suspendUser(tools.db, { actorId: null, targetId: suspended.id });

    for (const person of [staff, suspended]) {
      stubGoogle(claimsFor(person.email));
      const back = await googleLogin();
      expect(back.headers.get('location'), person.email).toBe('/entrar?erro=google');
      expect(back.headers.getSetCookie().join(';')).not.toMatch(/session_token=[^;]+/);
      expect(await sessionsOf(person.id)).toHaveLength(0);
    }
    expect(await accountsOf(staff.id), 'a credencial fica inativa, não apagada').toHaveLength(1);
  });

  it('o retorno sem os cookies do início (CSRF do OAuth) ou com erro do Google é o mesmo redirecionamento genérico', async () => {
    const person = await newUser('csrf@example.test');
    stubGoogle(claimsFor(person.email));
    await googleLink((await withReauth(person)).headers);
    const noCookies = await viaGoogle(() => send('POST', '/auth/google/start', { body: {} }), {
      dropCookies: true,
    });
    expect(noCookies.headers.get('location')).toBe('/entrar?erro=google');
    const denied = await send('GET', '/auth/callback/google?error=access_denied&state=qualquer');
    expect(denied.headers.get('location')).toBe('/entrar?erro=google');
    const noState = await send('GET', '/auth/callback/google?code=x');
    expect(noState.headers.get('location')).toBe('/entrar?erro=google');
  });

  it('remover o Google exige reautenticação; removido, o Google não entra mais e o link de acesso continua', async () => {
    const person = await newUser('desliga@example.test');
    stubGoogle(claimsFor(person.email));
    const session = await withReauth(person);
    await googleLink(session.headers);
    const fresh = await person.login();
    expect((await post('/me/security/google/unlink', fresh.headers)).status).toBe(403);

    expect((await post('/me/security/google/unlink', session.headers)).status).toBe(200);
    expect(await accountsOf(person.id)).toHaveLength(0);
    expect((await post('/me/security/google/unlink', session.headers)).status).toBe(404);
    const back = await googleLogin();
    expect(back.headers.get('location')).toBe('/entrar?erro=google');

    await send('POST', '/auth/link/request', {
      headers: { 'cf-connecting-ip': '198.51.100.230' },
      body: { email: person.email, captchaToken: HUMAN },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const token = decodeURIComponent(
      new URL(sender.sent.at(-1)!.variables.LINK_URL!).hash.replace('#token=', ''),
    );
    expect((await send('POST', '/auth/link/confirm', { body: { token } })).status).toBe(200);
  });

  it('o Google de OUTRA pessoa não pode ser ligado à conta de quem já tem aquele Google', async () => {
    const first = await newUser('primeira@example.test');
    const second = await newUser('segunda@example.test');
    stubGoogle(() => ({
      sub: 'mesma-conta-google',
      email: first.email,
      email_verified: true,
      name: 'X',
    }));
    await googleLink((await withReauth(first)).headers);
    stubGoogle(() => ({
      sub: 'mesma-conta-google',
      email: second.email,
      email_verified: true,
      name: 'X',
    }));
    const back = await googleLink((await withReauth(second)).headers);
    expect(back.headers.get('location')).toBe('/conta/seguranca?erro=google');
    expect(await accountsOf(second.id)).toHaveLength(0);
    expect(
      await tools.db
        .select()
        .from(schema.account)
        .where(and(eq(schema.account.providerId, 'google'), eq(schema.account.userId, first.id))),
    ).toHaveLength(1);
  });
});
