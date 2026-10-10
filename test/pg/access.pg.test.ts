import { eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import {
  ALL_CAPABILITIES,
  DELEGABLE_CAPABILITIES,
  ROLES,
  type Capability,
} from '../../src/features/identity/capabilities.ts';
import {
  LastAdminError,
  NotDelegableError,
  TargetNotSupportError,
  grantCapability,
  grantRole,
  isStaffEmail,
  liftSuspension,
  loadAccess,
  revokeCapability,
  revokeRole,
  suspendUser,
} from '../../src/server/auth/access-store.ts';
import { createAuth } from '../../src/server/auth/create-auth.ts';
import { requireCapability } from '../../src/server/auth/authorization.ts';
import { apiApp } from '../helpers/api-app.ts';
import type { AuthVars } from '../../src/server/auth/types.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/** M1-03 em Postgres 18 real: papéis, grants, suspensão, auditoria e o invariante do Admin. */
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

/** App de teste: uma rota protegida por capability, para CADA capability do catálogo. */
function protectedApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  app.use(
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
  for (const capability of ALL_CAPABILITIES) {
    app.get(`/cap/${capability}`, requireCapability(capability), (c) => c.json({ ok: true }));
  }
  return app;
}
const protectedRoutes = protectedApp();
const callCapability = (capability: Capability, headers?: Headers) =>
  protectedRoutes.request(`/cap/${capability}`, { headers }, env());

async function newUser(label = 'pessoa') {
  seq += 1;
  const user = tools.test.createUser({
    email: `${label}${seq}@example.test`,
    name: `${label} ${seq}`,
  });
  await tools.test.saveUser(user);
  const login = async () => (await tools.test.login({ userId: user.id })).headers;
  return { id: user.id, email: user.email, login, headers: await login() };
}

async function makeAdmin(actorId: string | null = null) {
  const person = await newUser('admin');
  await grantRole(tools.db, { actorId, targetId: person.id, role: 'admin' });
  return { ...person, headers: await person.login() };
}
/** Admin sem sessão: mais rápido, para os testes de concorrência com muitas rodadas. */
async function makeBareAdmin() {
  seq += 1;
  const user = tools.test.createUser({ email: `bare${seq}@example.test`, name: `bare ${seq}` });
  await tools.test.saveUser(user);
  await grantRole(tools.db, { actorId: null, targetId: user.id, role: 'admin' });
  return { id: user.id };
}
async function makeSupport(grants: string[] = []) {
  const admin = await makeAdmin();
  const person = await newUser('suporte');
  await grantRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
  for (const capability of grants) {
    await grantCapability(tools.db, { actorId: admin.id, targetId: person.id, capability });
  }
  return { ...person, headers: await person.login(), admin };
}

const activeAdmins = async () =>
  (
    await tools.db
      .select({ userId: schema.userRole.userId })
      .from(schema.userRole)
      .where(eq(schema.userRole.role, 'admin'))
  ).filter(Boolean).length;

describe('matriz de acesso por requisição direta (nunca pela interface)', () => {
  it('sem sessão, toda rota protegida responde 401', async () => {
    for (const capability of ALL_CAPABILITIES) {
      expect((await callCapability(capability)).status, capability).toBe(401);
    }
  });

  it('student (sem papel): 403 em todas, inclusive na leitura básica da Staff', async () => {
    const student = await newUser('aluno');
    for (const capability of ALL_CAPABILITIES) {
      expect((await callCapability(capability, student.headers)).status, capability).toBe(403);
    }
  });

  it('suporte sem grant: só a leitura básica (staff.read)', async () => {
    const support = await makeSupport();
    for (const capability of ALL_CAPABILITIES) {
      const expected = capability === 'staff.read' ? 200 : 403;
      expect((await callCapability(capability, support.headers)).status, capability).toBe(expected);
    }
  });

  it('suporte com grant: a leitura básica mais exatamente os grants, e nada exclusivo do Admin', async () => {
    const support = await makeSupport(['course.edit', 'audit.view']);
    const allowed = new Set<Capability>(['staff.read', 'course.edit', 'audit.view']);
    for (const capability of ALL_CAPABILITIES) {
      const expected = allowed.has(capability) ? 200 : 403;
      expect((await callCapability(capability, support.headers)).status, capability).toBe(expected);
    }
  });

  it('admin: todas as capabilities', async () => {
    const admin = await makeAdmin();
    for (const capability of ALL_CAPABILITIES) {
      expect((await callCapability(capability, admin.headers)).status, capability).toBe(200);
    }
  });

  it('GET /api/me/access devolve os papéis e as capabilities efetivas da própria pessoa', async () => {
    const app = apiApp();
    const support = await makeSupport(['course.edit']);
    const response = await app.request('/api/me/access', { headers: support.headers }, env());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      roles: ['student', 'support'],
      capabilities: ['course.edit', 'staff.read'],
      recentAuth: false,
    });
    expect((await app.request('/api/me/access', {}, env())).status).toBe(401);
  });
});

describe('o banco recusa o que o catálogo não permite', () => {
  it('grant de capability exclusiva do Admin é recusado no código e no banco', async () => {
    const support = await makeSupport();
    await expect(
      grantCapability(tools.db, {
        actorId: support.admin.id,
        targetId: support.id,
        capability: 'course.create',
      }),
    ).rejects.toBeInstanceOf(NotDelegableError);
    const client = await database.client();
    await expect(
      client.query(`insert into staff_grant (user_id, capability) values ($1, 'staff.manage')`, [
        support.id,
      ]),
    ).rejects.toThrow(/staff_grant_capability_check/);
    await expect(
      client.query(`insert into user_role (user_id, role) values ($1, 'owner')`, [support.id]),
    ).rejects.toThrow(/user_role_role_check/);
  });

  it('só o Suporte recebe grant: para quem não tem o papel é recusado', async () => {
    const admin = await makeAdmin();
    const student = await newUser('aluno');
    await expect(
      grantCapability(tools.db, {
        actorId: admin.id,
        targetId: student.id,
        capability: 'course.edit',
      }),
    ).rejects.toBeInstanceOf(TargetNotSupportError);
  });

  it('as listas do CHECK do banco são iguais ao catálogo do código (sem deriva)', async () => {
    const client = await database.client();
    const names = async (constraint: string) => {
      const row = await client.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and connamespace = current_schema()::regnamespace`,
        [constraint],
      );
      return new Set([...(row.rows[0]?.def ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]));
    };
    expect(await names('staff_grant_capability_check')).toEqual(new Set(DELEGABLE_CAPABILITIES));
    expect(await names('user_role_role_check')).toEqual(new Set(ROLES));
  });

  it('conceder duas vezes é idempotente: uma linha ativa e uma entrada de auditoria', async () => {
    const support = await makeSupport();
    expect(
      await grantCapability(tools.db, {
        actorId: support.admin.id,
        targetId: support.id,
        capability: 'finance.view',
      }),
    ).toBe(true);
    expect(
      await grantCapability(tools.db, {
        actorId: support.admin.id,
        targetId: support.id,
        capability: 'finance.view',
      }),
    ).toBe(false);
    const rows = await tools.db
      .select()
      .from(schema.staffGrant)
      .where(eq(schema.staffGrant.userId, support.id));
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });
});

describe('revogação vale na requisição seguinte', () => {
  it('revogar o grant pelo código derruba o acesso na hora (e encerra as sessões da pessoa)', async () => {
    const support = await makeSupport(['course.edit']);
    expect((await callCapability('course.edit', support.headers)).status).toBe(200);
    await revokeCapability(tools.db, {
      actorId: support.admin.id,
      targetId: support.id,
      capability: 'course.edit',
    });
    expect((await callCapability('course.edit', support.headers)).status).not.toBe(200);
    // mesmo com uma sessão NOVA, o grant não existe mais
    expect((await callCapability('course.edit', await support.login())).status).toBe(403);
  });

  it('sem cache: alterar o banco por fora (sem logout) vale na requisição seguinte', async () => {
    const support = await makeSupport(['audit.view']);
    expect((await callCapability('audit.view', support.headers)).status).toBe(200);
    await tools.db
      .update(schema.staffGrant)
      .set({ revokedAt: new Date() })
      .where(eq(schema.staffGrant.userId, support.id));
    expect((await callCapability('audit.view', support.headers)).status).toBe(403);
    expect((await callCapability('staff.read', support.headers)).status).toBe(200);
  });

  it('retirar o papel de Suporte encerra os grants (não voltam sozinhos se o papel voltar)', async () => {
    const support = await makeSupport(['course.edit', 'help.edit']);
    await revokeRole(tools.db, {
      actorId: support.admin.id,
      targetId: support.id,
      role: 'support',
    });
    expect((await loadAccess(tools.db, support.id)).grants.size).toBe(0);
    await grantRole(tools.db, { actorId: support.admin.id, targetId: support.id, role: 'support' });
    expect((await callCapability('course.edit', await support.login())).status).toBe(403);
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, support.id));
    expect(audits.filter((row) => row.action === 'grant.revoke')).toHaveLength(2);
  });

  it('mudança de papel ou grant encerra as sessões da pessoa', async () => {
    const person = await newUser('aluno');
    const admin = await makeAdmin();
    expect(
      (await tools.db.select().from(schema.session).where(eq(schema.session.userId, person.id)))
        .length,
    ).toBeGreaterThan(0);
    await grantRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
    expect(
      await tools.db.select().from(schema.session).where(eq(schema.session.userId, person.id)),
    ).toHaveLength(0);
  });
});

describe('suspensão', () => {
  it('conta suspensa perde toda capability e as sessões; reativar devolve o que tinha', async () => {
    const support = await makeSupport(['course.edit']);
    await suspendUser(tools.db, {
      actorId: support.admin.id,
      targetId: support.id,
      reason: 'teste',
    });
    for (const capability of ['staff.read', 'course.edit'] as const) {
      expect((await callCapability(capability, support.headers)).status).not.toBe(200);
    }
    // sessão nova (criada à força) continua sem acesso: 403 account_suspended
    expect((await loadAccess(tools.db, support.id)).suspended).toBe(true);
    await liftSuspension(tools.db, { actorId: support.admin.id, targetId: support.id });
    expect((await callCapability('course.edit', await support.login())).status).toBe(200);
  });

  it('conta suspensa não ganha sessão nova (gancho de criação de sessão)', async () => {
    const person = await newUser('aluno');
    const admin = await makeAdmin();
    await suspendUser(tools.db, { actorId: admin.id, targetId: person.id });
    const strict = await createTestAuth(
      database.connectionString,
      { baseUrl: BASE_URL, secret: SECRET },
      {
        emailSender: createFakeEmailSender(),
        isStaffEmail: async () => false,
        isSuspended: async (userId) => (await loadAccess(tools.db, userId)).suspended,
      },
    );
    try {
      const context = await strict.auth.$context;
      await expect(context.internalAdapter.createSession(person.id)).rejects.toThrow();
      expect(
        await tools.db.select().from(schema.session).where(eq(schema.session.userId, person.id)),
      ).toHaveLength(0);
    } finally {
      await strict.close();
    }
  });
});

describe('pelo menos um Admin ativo', () => {
  it('rebaixar ou suspender o único Admin é recusado', async () => {
    await tools.db.delete(schema.userRole);
    const only = await makeAdmin();
    await expect(
      revokeRole(tools.db, { actorId: only.id, targetId: only.id, role: 'admin' }),
    ).rejects.toBeInstanceOf(LastAdminError);
    await expect(
      suspendUser(tools.db, { actorId: only.id, targetId: only.id }),
    ).rejects.toBeInstanceOf(LastAdminError);
    expect((await loadAccess(tools.db, only.id)).roles.has('admin')).toBe(true);
  });

  it(
    'duas remoções simultâneas dos dois últimos Admins: exatamente uma passa (10 rodadas)',
    { timeout: 180_000 },
    async () => {
      for (let round = 0; round < 10; round += 1) {
        await tools.db.delete(schema.userRole);
        const a = await makeBareAdmin();
        const b = await makeBareAdmin();
        const outcomes = await Promise.allSettled(
          [a, b].map(async (target) => {
            const connection = await openDatabase(database.connectionString);
            try {
              return await revokeRole(connection.db, {
                actorId: null,
                targetId: target.id,
                role: 'admin',
              });
            } finally {
              await connection.close();
            }
          }),
        );
        expect(
          outcomes.filter((o) => o.status === 'fulfilled'),
          `rodada ${round}`,
        ).toHaveLength(1);
        const rejected = outcomes.find((o) => o.status === 'rejected');
        expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(LastAdminError);
        const remaining = await tools.db
          .select()
          .from(schema.userRole)
          .where(isNull(schema.userRole.revokedAt));
        expect(
          remaining.filter((row) => row.role === 'admin'),
          `rodada ${round}`,
        ).toHaveLength(1);
      }
    },
  );

  it(
    'remoção de um Admin e suspensão do outro ao mesmo tempo também deixam um Admin ativo',
    { timeout: 180_000 },
    async () => {
      for (let round = 0; round < 10; round += 1) {
        await tools.db.delete(schema.userSuspension);
        await tools.db.delete(schema.userRole);
        const a = await makeBareAdmin();
        const b = await makeBareAdmin();
        const runs = await Promise.allSettled([
          (async () => {
            const c = await openDatabase(database.connectionString);
            try {
              return await revokeRole(c.db, { actorId: null, targetId: a.id, role: 'admin' });
            } finally {
              await c.close();
            }
          })(),
          (async () => {
            const c = await openDatabase(database.connectionString);
            try {
              return await suspendUser(c.db, { actorId: null, targetId: b.id });
            } finally {
              await c.close();
            }
          })(),
        ]);
        expect(
          runs.filter((r) => r.status === 'fulfilled'),
          `rodada ${round}`,
        ).toHaveLength(1);
        const [accessA, accessB] = await Promise.all([
          loadAccess(tools.db, a.id),
          loadAccess(tools.db, b.id),
        ]);
        const active = [accessA, accessB].filter((who) => who.roles.has('admin') && !who.suspended);
        expect(active, `rodada ${round}`).toHaveLength(1);
      }
    },
  );

  it('com três Admins, remover dois ao mesmo tempo é permitido (não bloqueia à toa)', async () => {
    await tools.db.delete(schema.userRole);
    const [a, b, c] = [await makeBareAdmin(), await makeBareAdmin(), await makeBareAdmin()];
    const results = await Promise.allSettled(
      [a, b].map(async (target) => {
        const connection = await openDatabase(database.connectionString);
        try {
          return await revokeRole(connection.db, {
            actorId: null,
            targetId: target.id,
            role: 'admin',
          });
        } finally {
          await connection.close();
        }
      }),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect((await loadAccess(tools.db, c.id)).roles.has('admin')).toBe(true);
    expect(await activeAdmins()).toBeGreaterThanOrEqual(1);
  });
});

describe('auditoria', () => {
  it('cada mudança grava quem, o quê, em quem e quando, sem e-mail nem segredo', async () => {
    const admin = await makeAdmin();
    const person = await newUser('aluno');
    await grantRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
    await grantCapability(tools.db, {
      actorId: admin.id,
      targetId: person.id,
      capability: 'course.edit',
    });
    await suspendUser(tools.db, { actorId: admin.id, targetId: person.id, reason: 'motivo curto' });
    await liftSuspension(tools.db, { actorId: admin.id, targetId: person.id });
    await revokeCapability(tools.db, {
      actorId: admin.id,
      targetId: person.id,
      capability: 'course.edit',
    });
    await revokeRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
    const rows = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, person.id));
    expect(rows.map((row) => row.action)).toEqual([
      'role.grant',
      'grant.add',
      'account.suspend',
      'account.reactivate',
      'grant.revoke',
      'role.revoke',
    ]);
    for (const row of rows) {
      expect(row.actorId).toBe(admin.id);
      expect(row.targetType).toBe('user');
      expect(row.at).toBeInstanceOf(Date);
    }
    expect(JSON.stringify(rows)).not.toContain('@example.test');
    expect(rows[2]?.details).toEqual({ reason: 'motivo curto' });
  });

  it('operação sem efeito (já era assim) não grava auditoria', async () => {
    const admin = await makeAdmin();
    const person = await newUser('aluno');
    expect(
      await revokeRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' }),
    ).toBe(false);
    expect(await liftSuspension(tools.db, { actorId: admin.id, targetId: person.id })).toBe(false);
    expect(
      await tools.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, person.id)),
    ).toHaveLength(0);
  });

  it('é append-only: UPDATE, DELETE e TRUNCATE são recusados pelo banco', async () => {
    const admin = await makeAdmin();
    const person = await newUser('aluno');
    await grantRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
    const client = await database.client();
    await expect(client.query(`update audit_log set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(client.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
    await expect(client.query(`truncate audit_log`)).rejects.toThrow(/append-only/);
    expect((await client.query('select count(*)::int n from audit_log')).rows[0].n).toBeGreaterThan(
      0,
    );
  });

  it('o registro sobrevive à remoção da pessoa (sem chave estrangeira)', async () => {
    const admin = await makeAdmin();
    const person = await newUser('aluno');
    await grantRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
    const client = await database.client();
    await client.query(`delete from "user" where id = $1`, [person.id]);
    expect(
      await tools.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, person.id)),
    ).not.toHaveLength(0);
  });
});

describe('e-mail de Staff', () => {
  it('é reconhecido enquanto o papel está ativo, e deixa de ser depois', async () => {
    const admin = await makeAdmin();
    const person = await newUser('equipe');
    expect(await isStaffEmail(tools.db, person.email)).toBe(false);
    await grantRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
    expect(await isStaffEmail(tools.db, person.email)).toBe(true);
    await revokeRole(tools.db, { actorId: admin.id, targetId: person.id, role: 'support' });
    expect(await isStaffEmail(tools.db, person.email)).toBe(false);
    expect(await isStaffEmail(tools.db, 'ninguem@example.test')).toBe(false);
  });
});
