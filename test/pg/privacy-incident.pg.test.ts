import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-06 (B4, ADR 0033) em Postgres 18 real: o registro de incidentes com dados pessoais. Só o Admin; escrever exige
 * reautenticação; o texto NUNCA carrega dado pessoal; o ciclo só anda para a frente e encerrar exige a decisão
 * jurídica registrada; nada se apaga; a auditoria diz o que mudou sem o texto.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
}, 120_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

async function newPerson(options: { role?: 'support' | 'admin'; reauth?: boolean } = {}) {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  if (options.role)
    await grantRole(tools.db, { actorId: null, targetId: user.id, role: options.role });
  const session = await tools.test.login({ userId: user.id });
  if (options.reauth) {
    await tools.db
      .insert(schema.reauthProof)
      .values({ sessionId: session.session.id, verifiedAt: new Date() });
  }
  return { id: user.id, headers: session.headers };
}

function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api/staff/privacy/incidents${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;
const auditFor = (id: string) =>
  tools.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, id));

const body = (extra: Record<string, unknown> = {}) => ({
  title: 'Segredo exposto em um commit',
  description: 'Uma chave de teste apareceu em um commit e foi trocada no mesmo dia.',
  category: 'exposure',
  ...extra,
});

async function create(admin: { headers: Headers }, extra: Record<string, unknown> = {}) {
  const response = await call('POST', '', admin.headers, body(extra));
  expect(response.status).toBe(201);
  return (await json(response)).item as Record<string, any>;
}

describe('quem pode ver e escrever', () => {
  it('sem sessão 401; pessoa comum e Suporte 403; Admin lê; escrever sem reautenticação 403', async () => {
    const student = await newPerson();
    const support = await newPerson({ role: 'support', reauth: true });
    const adminNoReauth = await newPerson({ role: 'admin' });

    expect((await call('GET', '')).status).toBe(401);
    expect((await call('GET', '', student.headers)).status).toBe(403);
    expect((await call('GET', '', support.headers)).status).toBe(403);
    expect((await call('POST', '', support.headers, body())).status).toBe(403);
    expect((await call('GET', '', adminNoReauth.headers)).status).toBe(200);

    const refused = await call('POST', '', adminNoReauth.headers, body());
    expect(refused.status).toBe(403);
    expect((await json(refused)).error.code).toBe('reauth_required');
    const refusedPatch = await call(
      'PATCH',
      '/0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      adminNoReauth.headers,
      { status: 'contained' },
    );
    expect(refusedPatch.status).toBe(403);
  });
});

describe('registrar', () => {
  it('cria com padrões, não mostra nada ao público e audita só a categoria (nunca o texto)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin, { dataKinds: ['name', 'name', 'email'], affectedCount: 12 });
    expect(item).toMatchObject({
      status: 'open',
      riskAssessment: 'not_assessed',
      communication: 'pending',
      affectedCount: 12,
      dataKinds: ['name', 'email'],
      closedAt: null,
      containedAt: null,
      communicatedAt: null,
    });
    const audit = await auditFor(item.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.id,
      action: 'privacy.incident_create',
      details: { category: 'exposure' },
    });
    expect(JSON.stringify(audit)).not.toContain('chave de teste');
  });

  it('a lista vem do mais recente para o mais antigo (pela detecção)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const old = await create(admin, {
      detectedAt: '2026-01-01T00:00:00Z',
      title: 'Incidente antigo',
    });
    const recent = await create(admin, {
      detectedAt: '2026-09-01T00:00:00Z',
      title: 'Incidente recente',
    });
    const list = (await json(await call('GET', '', admin.headers))).items as { id: string }[];
    const ids = list.map((entry) => entry.id);
    expect(ids.indexOf(recent.id)).toBeLessThan(ids.indexOf(old.id));
  });

  it('recusa dado pessoal no texto (e-mail, CPF) e não grava nada', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const before = (await tools.db.select().from(schema.privacyIncident)).length;
    for (const extra of [
      { description: 'A conta ana.souza@example.com foi exposta por duas horas.' },
      { title: 'Vazou o CPF 123.456.789-09' },
      { actionsTaken: 'Avisei a pessoa em maria@example.com' },
    ]) {
      const response = await call('POST', '', admin.headers, body(extra));
      expect(response.status).toBe(400);
      expect((await json(response)).error.code).toBe('personal_data_in_text');
    }
    expect((await tools.db.select().from(schema.privacyIncident)).length).toBe(before);
  });

  it('corpo inválido: 400 genérico (categoria inventada, campo extra, JSON ruim)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    for (const bad of [body({ category: 'inventada' }), body({ extra: 1 }), body({ title: 'a' })]) {
      const response = await call('POST', '', admin.headers, bad);
      expect(response.status).toBe(400);
      expect((await json(response)).error.code).toBe('invalid_request');
    }
    const raw = new Headers(admin.headers);
    raw.set('origin', BASE_URL);
    raw.set('content-type', 'application/json');
    const response = await app().request(
      '/api/staff/privacy/incidents',
      { method: 'POST', headers: raw, body: '{não é json' },
      env(),
    );
    expect(response.status).toBe(400);
  });
});

describe('o ciclo do incidente', () => {
  it('contido carimba o instante; encerrar SEM a decisão jurídica é recusado; com ela, encerra', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin);

    const contained = await json(
      await call('PATCH', `/${item.id}`, admin.headers, { status: 'contained' }),
    );
    expect(contained.item.status).toBe('contained');
    expect(contained.item.containedAt).not.toBeNull();

    const early = await call('PATCH', `/${item.id}`, admin.headers, { status: 'closed' });
    expect(early.status).toBe(409);
    expect((await json(early)).error.code).toBe('decision_required');
    const onlyRisk = await call('PATCH', `/${item.id}`, admin.headers, {
      status: 'closed',
      riskAssessment: 'low',
    });
    expect(onlyRisk.status).toBe(409);

    const closed = await call('PATCH', `/${item.id}`, admin.headers, {
      status: 'closed',
      riskAssessment: 'low',
      communication: 'not_required',
      actionsTaken: 'Chave trocada; histórico revisado.',
    });
    expect(closed.status).toBe(200);
    const closedItem = (await json(closed)).item;
    expect(closedItem).toMatchObject({
      status: 'closed',
      riskAssessment: 'low',
      communication: 'not_required',
      actionsTaken: 'Chave trocada; histórico revisado.',
    });
    expect(closedItem.closedAt).not.toBeNull();
    expect(closedItem.containedAt).toBe(contained.item.containedAt);
  });

  it('encerrado é definitivo (409) e não volta atrás no ciclo', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin);
    await call('PATCH', `/${item.id}`, admin.headers, { status: 'contained' });
    const back = await call('PATCH', `/${item.id}`, admin.headers, { status: 'open' });
    expect(back.status).toBe(409);
    expect((await json(back)).error.code).toBe('invalid_transition');

    await call('PATCH', `/${item.id}`, admin.headers, {
      status: 'closed',
      riskAssessment: 'relevant',
      communication: 'communicated',
      communicatedAt: '2026-10-18T15:00:00Z',
    });
    const after = await call('PATCH', `/${item.id}`, admin.headers, {
      actionsTaken: 'tarde demais',
    });
    expect(after.status).toBe(409);
    expect((await json(after)).error.code).toBe('incident_closed');
  });

  it('"comunicado" exige a data; "não exigido" apaga a data; a auditoria lista os campos, não o texto', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin);
    const missing = await call('PATCH', `/${item.id}`, admin.headers, {
      communication: 'communicated',
    });
    expect(missing.status).toBe(409);
    expect((await json(missing)).error.code).toBe('communicated_at_required');

    const ok = await json(
      await call('PATCH', `/${item.id}`, admin.headers, {
        communication: 'communicated',
        communicatedAt: '2026-10-18T15:00:00Z',
        actionsTaken: 'Texto interno sem dado pessoal.',
      }),
    );
    expect(ok.item.communication).toBe('communicated');
    expect(ok.item.communicatedAt).toBe('2026-10-18T15:00:00.000Z');

    const reverted = await json(
      await call('PATCH', `/${item.id}`, admin.headers, { communication: 'not_required' }),
    );
    expect(reverted.item.communicatedAt).toBeNull();

    const updates = (await auditFor(item.id)).filter((e) => e.action === 'privacy.incident_update');
    expect(updates.length).toBe(2);
    expect(updates[0]?.details).toMatchObject({
      fields: ['actionsTaken', 'communicatedAt', 'communication'],
    });
    expect(JSON.stringify(updates)).not.toContain('Texto interno');
  });

  it('id inexistente ou malformado: 404; atualização vazia ou com texto pessoal: 400', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin);
    expect(
      (await call('PATCH', '/nao-e-uuid', admin.headers, { status: 'contained' })).status,
    ).toBe(404);
    expect(
      (
        await call('PATCH', '/0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', admin.headers, {
          status: 'contained',
        })
      ).status,
    ).toBe(404);
    expect((await call('PATCH', `/${item.id}`, admin.headers, {})).status).toBe(400);
    const personal = await call('PATCH', `/${item.id}`, admin.headers, {
      actionsTaken: 'falei com joao@example.com',
    });
    expect(personal.status).toBe(400);
    expect((await json(personal)).error.code).toBe('personal_data_in_text');
  });
});

describe('o banco não deixa apagar nem trocar a identidade', () => {
  it('DELETE e TRUNCATE são recusados; id, detecção e criação não mudam', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin);
    await expect(
      tools.db.execute(sql`delete from privacy_incident where id = ${item.id}`),
    ).rejects.toThrow();
    await expect(tools.db.execute(sql`truncate table privacy_incident`)).rejects.toThrow();
    await expect(
      tools.db.execute(
        sql`update privacy_incident set detected_at = detected_at - interval '1 day' where id = ${item.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      tools.db.execute(
        sql`update privacy_incident set created_at = created_at - interval '1 day' where id = ${item.id}`,
      ),
    ).rejects.toThrow();
    expect(
      await tools.db
        .select()
        .from(schema.privacyIncident)
        .where(eq(schema.privacyIncident.id, item.id)),
    ).toHaveLength(1);
  });

  it('as restrições recusam encerrar sem decisão e "comunicado" sem data, mesmo por SQL direto', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin);
    await expect(
      tools.db.execute(
        sql`update privacy_incident set status = 'closed', closed_at = now() where id = ${item.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      tools.db.execute(
        sql`update privacy_incident set communication = 'communicated' where id = ${item.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      tools.db.execute(
        sql`update privacy_incident set data_kinds = array['cpf_em_claro'] where id = ${item.id}`,
      ),
    ).rejects.toThrow();
  });

  it('apagar a conta de quem registrou NÃO é bloqueado, nem para incidente encerrado (só zera o autor)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const item = await create(admin);
    await call('PATCH', `/${item.id}`, admin.headers, {
      status: 'closed',
      riskAssessment: 'low',
      communication: 'not_required',
    });
    await tools.db.execute(sql`delete from session where user_id = ${admin.id}`);
    await tools.db.execute(sql`delete from user_role where user_id = ${admin.id}`);
    await tools.db.execute(sql`delete from "user" where id = ${admin.id}`);
    const [row] = await tools.db
      .select()
      .from(schema.privacyIncident)
      .where(eq(schema.privacyIncident.id, item.id));
    expect(row).toMatchObject({ id: item.id, createdBy: null, status: 'closed' });
  });
});
