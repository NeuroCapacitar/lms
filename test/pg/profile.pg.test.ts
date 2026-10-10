import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/** M1-02 em Postgres 18 real: perfil criado com o usuário, leitura, edição, isolamento e limites. */
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

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;
const app = apiApp();

async function newUser(name?: string) {
  seq += 1;
  const user = tools.test.createUser({
    email: `perfil${seq}@example.test`,
    ...(name !== undefined ? { name } : {}),
  });
  await tools.test.saveUser(user);
  const login = await tools.test.login({ userId: user.id });
  return {
    user,
    headers: login.headers,
    login: async () => (await tools.test.login({ userId: user.id })).headers,
  };
}

const get = (headers?: Headers) => app.request('/api/me/profile', { headers }, env());
const patch = (body: unknown, headers: Headers, origin: string | null = BASE_URL) => {
  const withOrigin = new Headers(headers);
  if (origin) withOrigin.set('origin', origin);
  withOrigin.set('content-type', 'application/json');
  return app.request(
    '/api/me/profile',
    { method: 'PATCH', headers: withOrigin, body: JSON.stringify(body) },
    env(),
  );
};
const rowOf = async (userId: string) =>
  (await tools.db.select().from(schema.profile).where(eq(schema.profile.userId, userId)))[0];

describe('criação junto do usuário', () => {
  it('todo usuário nasce com perfil, com os padrões: tema "system", autoavanço desligado, sem nome de certificado', async () => {
    const { user } = await newUser('Maria Souza');
    const row = await rowOf(user.id);
    expect(row).toBeDefined();
    expect(row?.displayName).toBe('Maria Souza');
    expect(row?.theme).toBe('system');
    expect(row?.autoAdvance).toBe(false);
    expect(row?.certificateName).toBeNull();
    expect(row?.certificateNameConfirmedAt).toBeNull();
  });

  it('o gatilho cria o perfil na mesma transação: com rollback, nenhum dos dois existe', async () => {
    const client = await database.client();
    await client.query('begin');
    await client.query(
      `insert into "user" (id, name, email) values ('tx-1', 'Na Transação', 'tx1@example.test')`,
    );
    expect(
      (await client.query(`select count(*)::int n from profile where user_id = 'tx-1'`)).rows[0].n,
    ).toBe(1);
    await client.query('rollback');
    expect(
      (await client.query(`select count(*)::int n from profile where user_id = 'tx-1'`)).rows[0].n,
    ).toBe(0);
    expect(
      (await client.query(`select count(*)::int n from "user" where id = 'tx-1'`)).rows[0].n,
    ).toBe(0);
  });

  it('nome vazio usa a parte local do e-mail como nome de exibição', async () => {
    const client = await database.client();
    await client.query(
      `insert into "user" (id, name, email) values ('sem-nome', '  ', 'quem.e@example.test')`,
    );
    const row = await rowOf('sem-nome');
    expect(row?.displayName).toBe('quem.e');
  });

  it('o banco recusa tema inválido e o perfil some junto do usuário (cascade)', async () => {
    const { user } = await newUser();
    const client = await database.client();
    await expect(
      client.query(`update profile set theme = 'neon' where user_id = $1`, [user.id]),
    ).rejects.toThrow(/profile_theme_check/);
    await client.query(`delete from "user" where id = $1`, [user.id]);
    expect(await rowOf(user.id)).toBeUndefined();
  });
});

describe('GET /api/me/profile', () => {
  it('sem sessão: 401; com sessão: só os campos do perfil, sem e-mail, ID nem dados de autenticação', async () => {
    expect((await get()).status).toBe(401);
    const { headers } = await newUser('Ana Lima');
    const response = await get(headers);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      displayName: 'Ana Lima',
      certificateName: null,
      certificateNameConfirmed: false,
      theme: 'system',
      autoAdvance: false,
    });
  });
});

describe('PATCH /api/me/profile', () => {
  it('atualiza só os campos informados e as preferências persistem em outra sessão', async () => {
    const person = await newUser('Pessoa Padrão');
    const done = await patch(
      { theme: 'dark', autoAdvance: true, displayName: 'Nome Novo' },
      person.headers,
    );
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({
      theme: 'dark',
      autoAdvance: true,
      displayName: 'Nome Novo',
    });
    // outra sessão (outro login) da mesma pessoa enxerga o que foi salvo
    const later = await get(await person.login());
    expect(await later.json()).toMatchObject({
      theme: 'dark',
      autoAdvance: true,
      displayName: 'Nome Novo',
    });
    // campo não enviado não muda
    await patch({ theme: 'light' }, person.headers);
    expect(await (await get(person.headers)).json()).toMatchObject({
      theme: 'light',
      autoAdvance: true,
      displayName: 'Nome Novo',
    });
  });

  it('campos extras (e-mail, papel, userId, id) são rejeitados e nada muda no banco', async () => {
    const { user, headers } = await newUser('Sem Mudança');
    const before = await rowOf(user.id);
    for (const extra of [
      { email: 'outra@example.test' },
      { role: 'admin' },
      { userId: 'outro' },
      { id: 'x' },
    ]) {
      const response = await patch({ displayName: 'Mudou', ...extra }, headers);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'invalid_request' } });
    }
    expect(await rowOf(user.id)).toEqual(before);
    const [account] = await tools.db.select().from(schema.user).where(eq(schema.user.id, user.id));
    expect(account?.email).toBe(user.email);
  });

  it('valores inválidos são rejeitados', async () => {
    const { headers } = await newUser();
    for (const bad of [
      {},
      { theme: 'neon' },
      { autoAdvance: 'sim' },
      { displayName: '' },
      { displayName: 'a'.repeat(81) },
      { displayName: 'Ana\nSilva' },
      { certificateName: 'ab' },
    ]) {
      expect((await patch(bad, headers)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await patch('texto solto', headers)).status).toBe(400);
  });

  it('cada pessoa altera só o próprio perfil: não há como apontar para o de outra', async () => {
    const a = await newUser('Pessoa A');
    const b = await newUser('Pessoa B');
    await patch({ displayName: 'A mudou', theme: 'dark' }, a.headers);
    expect((await rowOf(b.user.id))?.displayName).toBe('Pessoa B');
    expect((await rowOf(b.user.id))?.theme).toBe('system');
    // tentar nomear o alvo no corpo é rejeitado; o ID nunca é aceito
    expect((await patch({ userId: b.user.id, displayName: 'invadido' }, a.headers)).status).toBe(
      400,
    );
    expect((await rowOf(b.user.id))?.displayName).toBe('Pessoa B');
  });

  it('sem sessão: 401; origem errada ou ausente: 403, sem alterar nada', async () => {
    const { user, headers } = await newUser('Protegido');
    expect((await patch({ theme: 'dark' }, new Headers())).status).toBe(401);
    expect((await patch({ theme: 'dark' }, headers, 'https://evil.example')).status).toBe(403);
    expect((await patch({ theme: 'dark' }, headers, null)).status).toBe(403);
    expect((await rowOf(user.id))?.theme).toBe('system');
  });

  it('trocar o nome do certificado zera a confirmação; limpar com null ou texto vazio funciona', async () => {
    const { user, headers } = await newUser('Certificado');
    await patch({ certificateName: 'Maria Aparecida Souza' }, headers);
    await tools.db
      .update(schema.profile)
      .set({ certificateNameConfirmedAt: new Date() })
      .where(eq(schema.profile.userId, user.id));
    expect(await (await get(headers)).json()).toMatchObject({ certificateNameConfirmed: true });
    const changed = await patch({ certificateName: 'Maria A. Souza' }, headers);
    expect(await changed.json()).toMatchObject({
      certificateName: 'Maria A. Souza',
      certificateNameConfirmed: false,
    });
    const cleared = await patch({ certificateName: '' }, headers);
    expect(await cleared.json()).toMatchObject({ certificateName: null });
  });

  it('alterar o nome de exibição não muda a conta (e-mail e nome do usuário de autenticação ficam como estão)', async () => {
    const { user, headers } = await newUser('Nome Original');
    await patch({ displayName: 'Apelido' }, headers);
    const [account] = await tools.db.select().from(schema.user).where(eq(schema.user.id, user.id));
    expect(account?.name).toBe('Nome Original');
    expect(account?.email).toBe(user.email);
  });
});
