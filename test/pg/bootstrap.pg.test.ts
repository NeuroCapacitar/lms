import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { loadAccess, isStaffEmail } from '../../src/server/auth/access-store.ts';
import {
  AdminAlreadyExistsError,
  adminExists,
  bootstrapAdmin,
} from '../../src/server/auth/bootstrap.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/** M1-04 em Postgres 18 real: o primeiro Admin nasce sem senha e só uma vez. */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, {
    baseUrl: 'https://app.example.test',
    secret: SECRET,
  });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

describe('bootstrapAdmin', () => {
  it('cria a pessoa (sem senha, e-mail ainda não verificado) e o papel de Admin, com auditoria do sistema', async () => {
    expect(await adminExists(tools.db)).toBe(false);
    const result = await bootstrapAdmin(tools.db, '  Dono@Example.TEST ');
    expect(result.createdUser).toBe(true);

    const [person] = await tools.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, result.userId));
    expect(person).toMatchObject({ email: 'dono@example.test', emailVerified: false });
    expect(await tools.db.select().from(schema.account)).toHaveLength(0);
    expect(
      await tools.db.select().from(schema.profile).where(eq(schema.profile.userId, result.userId)),
    ).toHaveLength(1);
    expect([...(await loadAccess(tools.db, result.userId)).roles]).toEqual(['admin']);
    expect(await isStaffEmail(tools.db, 'dono@example.test')).toBe(true);
    const audit = (await tools.db.select().from(schema.auditLog)).filter(
      (entry) => entry.targetId === result.userId,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: null, action: 'role.grant' });
    expect(audit[0]!.details).toEqual({ role: 'admin', via: 'bootstrap' });
  });

  it('reaproveita a pessoa que já existe (ex.: já era aluna)', async () => {
    const user = tools.test.createUser({ email: 'ja@example.test', name: 'Já Existe' });
    await tools.test.saveUser(user);
    const result = await bootstrapAdmin(tools.db, 'ja@example.test');
    expect(result).toEqual({ userId: user.id, createdUser: false });
    expect(await tools.db.select().from(schema.user)).toHaveLength(1);
  });

  it('recusa se já existir um Admin, mesmo suspenso ou de outro e-mail, e não altera nada', async () => {
    await bootstrapAdmin(tools.db, 'primeiro@example.test');
    await expect(bootstrapAdmin(tools.db, 'segundo@example.test')).rejects.toBeInstanceOf(
      AdminAlreadyExistsError,
    );
    expect(await adminExists(tools.db)).toBe(true);
    expect(await tools.db.select().from(schema.user)).toHaveLength(1);
    expect(await tools.db.select().from(schema.userRole)).toHaveLength(1);
  });

  it('dois bootstraps simultâneos (conexões separadas): exatamente um vence', async () => {
    const [one, two] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    try {
      const results = await Promise.allSettled([
        bootstrapAdmin(one.db, 'a@example.test'),
        bootstrapAdmin(two.db, 'b@example.test'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(AdminAlreadyExistsError);
      expect(await tools.db.select().from(schema.userRole)).toHaveLength(1);
    } finally {
      await Promise.all([one.close(), two.close()]);
    }
  });
});
