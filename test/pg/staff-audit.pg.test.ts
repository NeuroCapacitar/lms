import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import type { AuditPageDto } from '../../src/features/staff/audit.ts';
import { auditEvent, grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-01 (passo 3) em Postgres 18 real: a leitura da auditoria. Paginação por CURSOR (sem repetir nem pular linha, mesmo com gravações
 * novas entre uma página e outra), filtros por ação e alvo, validação da consulta, só quem tem `audit.view`, só IDs na resposta e
 * nenhum caminho de escrita.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const PAGE_ACTION = 'teste.pagina';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let viewer: Headers;
let seq = 0;

const application = () =>
  apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

async function person(role: 'support' | 'admin', grant?: 'audit.view') {
  seq += 1;
  const user = tools.test.createUser({
    email: `audit${seq}@auditoria.example.test`,
    name: `Audit ${seq}`,
  });
  await tools.test.saveUser(user);
  await grantRole(tools.db, { actorId: null, targetId: user.id, role });
  if (grant) {
    await tools.db
      .insert(schema.staffGrant)
      .values({ userId: user.id, capability: grant, grantedBy: user.id });
  }
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}

async function read(query: string, headers: Headers = viewer) {
  return application().request(`/api/staff/audit${query}`, { headers }, env());
}

async function write(count: number, action = PAGE_ACTION) {
  for (let index = 0; index < count; index += 1) {
    seq += 1;
    await auditEvent(tools.db, {
      actorId: null,
      action,
      targetType: 'teste',
      targetId: `alvo-${seq}`,
      details: { n: seq },
    });
  }
}

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  viewer = (await person('support', 'audit.view')).headers;
  await write(60);
  await write(5, 'teste.outra');
}, 240_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

describe('paginação por cursor', () => {
  it('25 + 25 + 10, do mais novo para o mais antigo, sem repetir nem pular nenhuma linha', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const response = await read(`?action=${PAGE_ACTION}${cursor ? `&cursor=${cursor}` : ''}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const page = (await response.json()) as AuditPageDto;
      sizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([25, 25, 10]);
    expect(new Set(seen).size).toBe(60);
    const numbers = seen.map(Number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  it('gravações novas entre uma página e outra não repetem nem derrubam linhas da página seguinte', async () => {
    const first = (await (await read(`?action=${PAGE_ACTION}&limit=10`)).json()) as AuditPageDto;
    await write(3); // entram no topo, depois da primeira página ter sido lida
    const second = (await (
      await read(`?action=${PAGE_ACTION}&limit=10&cursor=${first.nextCursor}`)
    ).json()) as AuditPageDto;
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.every((item) => !firstIds.has(item.id))).toBe(true);
    expect(Number(second.items[0]!.id)).toBe(Number(first.items.at(-1)!.id) - 1);
  });

  it('a última página não tem próximo cursor', async () => {
    const page = (await (await read('?action=teste.outra&limit=50')).json()) as AuditPageDto;
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });
});

describe('filtros e conteúdo', () => {
  it('filtra por ação, por tipo do alvo e por identificador do alvo', async () => {
    const byAction = (await (await read('?action=teste.outra')).json()) as AuditPageDto;
    expect(byAction.items.every((item) => item.action === 'teste.outra')).toBe(true);

    const target = byAction.items[0]!;
    const byTarget = (await (
      await read(`?targetType=teste&targetId=${encodeURIComponent(target.targetId)}`)
    ).json()) as AuditPageDto;
    expect(byTarget.items).toHaveLength(1);
    expect(byTarget.items[0]).toMatchObject({
      id: target.id,
      actorId: null,
      targetType: 'teste',
      targetId: target.targetId,
    });

    const none = (await (await read('?action=nao.existe')).json()) as AuditPageDto;
    expect(none).toEqual({ items: [], nextCursor: null });
  });

  it('traz só identificadores e os detalhes gravados (nada de nome nem e-mail)', async () => {
    const page = (await (await read('?limit=50')).json()) as AuditPageDto;
    const text = JSON.stringify(page);
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/Audit \d/);
    const entry = page.items.find((item) => item.action === PAGE_ACTION)!;
    expect(entry.details).toHaveProperty('n');
    expect(new Date(entry.at).getTime()).not.toBeNaN();
  });

  it('as ações reais da própria Staff aparecem (a concessão de papel feita nos testes)', async () => {
    const page = (await (await read('?action=role.grant&limit=50')).json()) as AuditPageDto;
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]!.targetType.length).toBeGreaterThan(0);
  });
});

describe('validação e acesso', () => {
  it('consulta inválida dá 400 sem consultar o banco: limite, cursor, campo desconhecido, texto longo', async () => {
    for (const query of [
      '?limit=0',
      '?limit=51',
      '?limit=abc',
      '?cursor=abc',
      '?cursor=-1',
      '?foo=bar',
      `?action=${'a'.repeat(65)}`,
      `?targetId=${'a'.repeat(201)}`,
    ]) {
      const response = await read(query);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'invalid_request' } });
    }
  });

  it('Admin lê; Suporte sem audit.view e sem sessão não leem', async () => {
    const admin = await person('admin');
    expect((await read('', admin.headers)).status).toBe(200);
    const bare = await person('support');
    expect((await read('', bare.headers)).status).toBe(403);
    expect((await application().request('/api/staff/audit', {}, env())).status).toBe(401);
  });

  it('não há caminho de escrita: POST, PUT, PATCH e DELETE em /api/staff/audit não existem', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const headers = new Headers(viewer);
      headers.set('origin', BASE_URL);
      headers.set('content-type', 'application/json');
      const response = await application().request(
        '/api/staff/audit',
        { method, headers, body: '{}' },
        env(),
      );
      expect([404, 405], method).toContain(response.status);
    }
  });
});
