import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import {
  grantCapability,
  grantRole,
  loadAccess,
  revokeRole,
  suspendUser,
} from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-10 em Postgres 18 real, o lado do servidor: lista da equipe (`staff.manage`) e mudança de
 * grants e do papel de Suporte (`staff.manage` + reautenticação recente), com auditoria, efeito
 * imediato e acesso direto pela API barrado para quem não é Admin.
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
  await tools.db.delete(schema.authThrottle);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.staffGrant);
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

const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => false });

async function newUser(name?: string) {
  seq += 1;
  const user = tools.test.createUser({
    email: `pessoa${seq}@example.test`,
    name: name ?? `Pessoa ${seq}`,
  });
  await tools.test.saveUser(user);
  const login = async () => {
    const result = await tools.test.login({ userId: user.id });
    return { headers: result.headers, sessionId: result.session.id };
  };
  return { id: user.id, email: user.email, name: user.name, login };
}

async function withProof(person: Awaited<ReturnType<typeof newUser>>) {
  const session = await person.login();
  await tools.db
    .insert(schema.reauthProof)
    .values({ sessionId: session.sessionId, verifiedAt: new Date() });
  return session;
}

async function newAdmin(options: { reauth?: boolean } = {}) {
  const person = await newUser('Admin Teste');
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'admin' });
  return {
    ...person,
    ...(options.reauth === false ? await person.login() : await withProof(person)),
  };
}
async function newSupport(grants: string[] = []) {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'support' });
  for (const capability of grants) {
    await grantCapability(tools.db, { actorId: null, targetId: person.id, capability });
  }
  return { ...person, ...(await withProof(person)) };
}

function call(method: string, path: string, headers: Headers | undefined, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api/staff${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
const team = async (headers: Headers) =>
  (
    (await (await call('GET', '/team', headers)).json()) as {
      members: {
        id: string;
        name: string;
        email: string;
        roles: string[];
        grants: string[];
        suspended: boolean;
      }[];
    }
  ).members;
const grant = (id: string, headers: Headers | undefined, capability: unknown) =>
  call('POST', `/users/${id}/grants`, headers, { capability });
const revokeGrant = (id: string, headers: Headers | undefined, capability: unknown) =>
  call('POST', `/users/${id}/grants/revoke`, headers, { capability });
const removeSupport = (id: string, headers: Headers | undefined) =>
  call('POST', `/users/${id}/support/revoke`, headers, {});
const sessionsOf = (userId: string) =>
  tools.db.select().from(schema.session).where(eq(schema.session.userId, userId));
/** O audit_log é append-only (não se limpa entre testes): sempre filtrar pelo alvo. */
const auditFor = async (targetId: string) =>
  (await tools.db.select().from(schema.auditLog)).filter((row) => row.targetId === targetId);
const auditActions = async (targetId: string) =>
  (await auditFor(targetId)).map((row) => row.action);

describe('GET /api/staff/team', () => {
  it('só o Admin vê a equipe; Suporte (mesmo com grants), aluno e anônimo não', async () => {
    const admin = await newAdmin({ reauth: false });
    const support = await newSupport(['audit.view', 'finance.view']);
    const student = await newUser();
    const studentSession = await student.login();
    expect((await call('GET', '/team', undefined)).status).toBe(401);
    for (const who of [support, studentSession]) {
      const denied = await call('GET', '/team', who.headers);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: { code: 'forbidden' } });
    }
    // listar não exige reautenticação recente
    expect((await call('GET', '/team', admin.headers)).status).toBe(200);
  });

  it('lista só quem tem papel ativo, com papéis, grants e suspensão', async () => {
    const admin = await newAdmin();
    const support = await newSupport(['help.edit', 'audit.view']);
    const suspended = await newSupport();
    await suspendUser(tools.db, { actorId: admin.id, targetId: suspended.id });
    const former = await newSupport(['ops.queue']);
    await revokeRole(tools.db, { actorId: admin.id, targetId: former.id, role: 'support' });
    await newUser();
    const both = await newSupport();
    await grantRole(tools.db, { actorId: null, targetId: both.id, role: 'admin' });

    const members = await team(admin.headers);
    expect(members.map((m) => m.id).sort()).toEqual(
      [admin.id, support.id, suspended.id, both.id].sort(),
    );
    const find = (id: string) => members.find((m) => m.id === id)!;
    expect(find(admin.id)).toMatchObject({ roles: ['admin'], grants: [], suspended: false });
    expect(find(support.id)).toMatchObject({
      roles: ['support'],
      grants: ['audit.view', 'help.edit'],
      suspended: false,
      email: support.email,
    });
    expect(find(suspended.id).suspended).toBe(true);
    expect(find(both.id).roles.sort()).toEqual(['admin', 'support']);
  });
});

describe('conceder e retirar grants', () => {
  it('exigem sessão, Admin e reautenticação recente; Suporte não concede nem a si mesmo', async () => {
    const admin = await newAdmin({ reauth: false });
    const support = await newSupport();
    for (const act of [
      (headers: Headers | undefined) => grant(support.id, headers, 'course.edit'),
      (headers: Headers | undefined) => revokeGrant(support.id, headers, 'course.edit'),
      (headers: Headers | undefined) => removeSupport(support.id, headers),
    ]) {
      expect((await act(undefined)).status).toBe(401);
      expect(await (await act(support.headers)).json()).toEqual({ error: { code: 'forbidden' } });
      const needsReauth = await act(admin.headers);
      expect(needsReauth.status).toBe(403);
      expect(await needsReauth.json()).toEqual({ error: { code: 'reauth_required' } });
    }
    expect((await grant(support.id, support.headers, 'course.edit')).status).toBe(403);
    expect((await loadAccess(tools.db, support.id)).grants.size).toBe(0);
  });

  it('conceder grava, audita, encerra as sessões da pessoa e vale já na requisição seguinte', async () => {
    const admin = await newAdmin();
    const support = await newSupport();
    expect(await sessionsOf(support.id)).toHaveLength(1);

    const response = await grant(support.id, admin.headers, 'finance.view');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', changed: true });
    expect([...(await loadAccess(tools.db, support.id)).grants]).toEqual(['finance.view']);
    expect(await sessionsOf(support.id)).toHaveLength(0);
    const entry = (await auditFor(support.id)).find((row) => row.action === 'grant.add');
    expect(entry).toMatchObject({ actorId: admin.id, targetId: support.id });
    expect(entry!.details).toMatchObject({ capability: 'finance.view' });
    expect(JSON.stringify(entry)).not.toContain(support.email);
    expect(await (await grant(support.id, admin.headers, 'finance.view')).json()).toEqual({
      status: 'ok',
      changed: false,
    });
  });

  it('retirar o grant tira o acesso já na requisição seguinte; repetir não muda nada', async () => {
    const admin = await newAdmin();
    const support = await newSupport(['audit.view']);
    const response = await revokeGrant(support.id, admin.headers, 'audit.view');
    expect(await response.json()).toEqual({ status: 'ok', changed: true });
    expect((await loadAccess(tools.db, support.id)).grants.size).toBe(0);
    expect(await auditActions(support.id)).toContain('grant.revoke');
    expect(await (await revokeGrant(support.id, admin.headers, 'audit.view')).json()).toEqual({
      status: 'ok',
      changed: false,
    });
  });

  it('recusa capability só-Admin ou inexistente, campo extra, id desconhecido e quem não é Suporte', async () => {
    const admin = await newAdmin();
    const support = await newSupport();
    const student = await newUser();
    for (const capability of ['staff.manage', 'course.create', 'inventada', undefined]) {
      expect((await grant(support.id, admin.headers, capability)).status, String(capability)).toBe(
        400,
      );
      expect((await revokeGrant(support.id, admin.headers, capability)).status).toBe(400);
    }
    expect(
      (
        await call('POST', `/users/${support.id}/grants`, admin.headers, {
          capability: 'course.edit',
          x: 1,
        })
      ).status,
    ).toBe(400);
    expect((await grant('id-que-nao-existe', admin.headers, 'course.edit')).status).toBe(404);
    expect((await grant('../etc', admin.headers, 'course.edit')).status).toBe(404);
    const notSupport = await grant(student.id, admin.headers, 'course.edit');
    expect(notSupport.status).toBe(409);
    expect(await notSupport.json()).toEqual({ error: { code: 'not_support' } });
    expect((await loadAccess(tools.db, support.id)).grants.size).toBe(0);
  });
});

describe('tirar a pessoa do Suporte', () => {
  it('perde o papel e os grants, sai da lista, é auditado e fica sem sessão', async () => {
    const admin = await newAdmin();
    const support = await newSupport(['help.edit', 'ops.queue']);
    const response = await removeSupport(support.id, admin.headers);
    expect(await response.json()).toEqual({ status: 'ok', changed: true });
    const access = await loadAccess(tools.db, support.id);
    expect(access.roles.size).toBe(0);
    expect(access.grants.size).toBe(0);
    expect((await team(admin.headers)).map((m) => m.id)).toEqual([admin.id]);
    expect(await sessionsOf(support.id)).toHaveLength(0);
    expect(await auditActions(support.id)).toEqual(
      expect.arrayContaining(['role.revoke', 'grant.revoke']),
    );
    expect(await (await removeSupport(support.id, admin.headers)).json()).toEqual({
      status: 'ok',
      changed: false,
    });
    expect((await removeSupport('id-que-nao-existe', admin.headers)).status).toBe(404);
  });
});
