import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { currentVersions, publishLegalVersion } from '../../src/server/auth/legal-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-09 em Postgres 18 real: aceite versionado dos Termos e da Política com a declaração de 18+.
 * Sem aceite das versões vigentes, TODA rota de área logada responde 403 `terms_required`, antes de
 * qualquer dado; só o aceite (`/me/legal`) e o encerramento de sessão ficam de fora.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema({ keepLegalSeeds: true });
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});

/** Cada teste parte das duas versões provisórias da migration, sem aceites nem outras versões. */
beforeEach(async () => {
  // As versões semeadas têm `effective_from` = o instante da migration. Numa máquina rápida, uma versão
  // nova publicada com `now() - 1s` ficaria ANTES dela e não seria a vigente: recua as semeadas.
  await tools.db
    .update(schema.legalDocumentVersion)
    .set({ effectiveFrom: new Date(Date.now() - 24 * 60 * 60 * 1000) })
    .where(eq(schema.legalDocumentVersion.version, 'provisorio-1'));
  await tools.db.delete(schema.termsAcceptance);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
  await tools.db.delete(schema.authThrottle);
  await tools.db
    .delete(schema.legalDocumentVersion)
    .where(eq(schema.legalDocumentVersion.version, 'v-teste'));
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => false });

async function newUser(options: { admin?: boolean } = {}) {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  if (options.admin) await grantRole(tools.db, { actorId: null, targetId: user.id, role: 'admin' });
  const login = async () => (await tools.test.login({ userId: user.id })).headers;
  return { id: user.id, login };
}

function call(method: string, path: string, headers: Headers | undefined, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
const status = async (headers: Headers | undefined) =>
  (await (await call('GET', '/me/legal', headers)).json()) as {
    accepted: boolean;
    documents: { id: string; kind: string; version: string; body: string }[];
  };
const ids = (docs: { id: string }[]) => docs.map((doc) => doc.id);
const accept = (headers: Headers | undefined, documentVersionIds: string[], adult = true) =>
  call('POST', '/me/legal/accept', headers, { adultDeclaration: adult, documentVersionIds });
const acceptCurrentDocs = async (headers: Headers) =>
  accept(headers, ids((await status(headers)).documents));
const acceptancesOf = (userId: string) =>
  tools.db.select().from(schema.termsAcceptance).where(eq(schema.termsAcceptance.userId, userId));

describe('versões vigentes', () => {
  it('a migration semeia Termos e Política PROVISÓRIOS, sinalizados como texto do advogado pendente', async () => {
    const current = await currentVersions(tools.db);
    expect(current.map((doc) => doc.kind).sort()).toEqual(['privacy', 'terms']);
    for (const doc of current) {
      expect(doc.version).toBe('provisorio-1');
      expect(doc.body).toMatch(/^TEXTO PROVISÓRIO: aguarda a redação do advogado/);
    }
  });

  it('GET /me/legal exige sessão e devolve o texto e se já foi aceito', async () => {
    const person = await newUser();
    expect((await call('GET', '/me/legal', undefined)).status).toBe(401);
    const headers = await person.login();
    const result = await status(headers);
    expect(result.accepted).toBe(false);
    expect(result.documents).toHaveLength(2);
    await acceptCurrentDocs(headers);
    expect((await status(headers)).accepted).toBe(true);
  });
});

describe('portão: nenhuma rota de área logada responde antes do aceite', () => {
  it('rotas de aluno e de Staff dão 403 terms_required, sem dados; sem sessão continua 401', async () => {
    const person = await newUser({ admin: true });
    const headers = await person.login();
    const probes: [string, string, unknown?][] = [
      ['GET', '/me'],
      ['GET', '/me/profile'],
      ['PATCH', '/me/profile', { displayName: 'Novo nome' }],
      ['GET', '/me/access'],
      ['GET', '/staff/invitations'],
      ['POST', '/staff/invitations', { email: 'a@example.test' }],
      ['POST', '/staff/invitations/accept', { token: 'x'.repeat(40) }],
      ['POST', `/staff/users/${person.id}/suspend`, {}],
    ];
    for (const [method, path, body] of probes) {
      const blocked = await call(method, path, headers, body);
      expect(blocked.status, `${method} ${path}`).toBe(403);
      expect(await blocked.json(), `${method} ${path}`).toEqual({
        error: { code: 'terms_required' },
      });
      expect((await call(method, path, undefined, body)).status, `sem sessão ${path}`).toBe(401);
    }
    // nada foi alterado pela tentativa de PATCH
    const [profile] = await tools.db
      .select()
      .from(schema.profile)
      .where(eq(schema.profile.userId, person.id));
    expect(profile!.displayName).not.toBe('Novo nome');
  });

  it('o aceite (/me/legal) e o encerramento de sessão ficam de fora do portão', async () => {
    const person = await newUser();
    const headers = await person.login();
    expect((await call('GET', '/me/legal', headers)).status).toBe(200);
    expect((await acceptCurrentDocs(headers)).status).toBe(200);
    const again = await person.login();
    expect((await call('POST', '/auth/sign-out', again, {})).status).toBe(200);
  });

  it('depois do aceite as rotas respondem normalmente (inclusive as de Staff)', async () => {
    const person = await newUser({ admin: true });
    const headers = await person.login();
    expect((await call('GET', '/me', headers)).status).toBe(403);
    await acceptCurrentDocs(headers);
    expect((await call('GET', '/me', headers)).status).toBe(200);
    expect((await call('GET', '/me/profile', headers)).status).toBe(200);
    expect((await call('GET', '/staff/invitations', headers)).status).toBe(200);
  });

  it('o aceite é por pessoa: aceitar não libera outra conta', async () => {
    const one = await newUser();
    const two = await newUser();
    const [headersOne, headersTwo] = [await one.login(), await two.login()];
    await acceptCurrentDocs(headersOne);
    expect((await call('GET', '/me', headersOne)).status).toBe(200);
    expect((await call('GET', '/me', headersTwo)).status).toBe(403);
  });

  it('sem versão vigente não há o que aceitar e o portão fica aberto', async () => {
    const person = await newUser();
    const headers = await person.login();
    const saved = await tools.db.select().from(schema.legalDocumentVersion);
    await tools.db.delete(schema.legalDocumentVersion);
    try {
      expect((await call('GET', '/me', headers)).status).toBe(200);
      expect((await status(headers)).accepted).toBe(true);
    } finally {
      await tools.db.insert(schema.legalDocumentVersion).values(saved);
    }
  });
});

describe('aceitar', () => {
  it('grava o aceite das versões vigentes com a declaração 18+, sem IP; repetir é idempotente', async () => {
    const person = await newUser();
    const headers = await person.login();
    const documents = (await status(headers)).documents;
    const first = await accept(headers, ids(documents));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'ok' });
    const rows = await acceptancesOf(person.id);
    expect(rows.map((row) => row.documentVersionId).sort()).toEqual(ids(documents).sort());
    expect(rows.every((row) => row.adultDeclared === true)).toBe(true);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ['acceptedAt', 'adultDeclared', 'documentVersionId', 'userId'].sort(),
    );

    const [before] = rows;
    expect((await accept(headers, ids(documents))).status).toBe(200);
    const after = await acceptancesOf(person.id);
    expect(after).toHaveLength(2);
    expect(
      after.find((row) => row.documentVersionId === before!.documentVersionId)!.acceptedAt,
    ).toEqual(before!.acceptedAt);
  });

  it('recusa sem a declaração de 18+, com corpo inválido ou sem sessão; nada é gravado', async () => {
    const person = await newUser();
    const headers = await person.login();
    const documents = ids((await status(headers)).documents);
    expect((await accept(headers, documents, false)).status).toBe(400);
    expect(
      (await call('POST', '/me/legal/accept', headers, { documentVersionIds: documents })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/me/legal/accept', headers, { adultDeclaration: true })).status,
    ).toBe(400);
    expect((await accept(headers, ['nao-e-uuid'])).status).toBe(400);
    expect(
      (
        await call('POST', '/me/legal/accept', headers, {
          adultDeclaration: true,
          documentVersionIds: documents,
          x: 1,
        })
      ).status,
    ).toBe(400);
    expect((await accept(undefined, documents)).status).toBe(401);
    expect(await acceptancesOf(person.id)).toHaveLength(0);
  });

  it('exige as versões vigentes COMPLETAS: faltando uma, ou uma desconhecida, é 409 e não grava nada', async () => {
    const person = await newUser();
    const headers = await person.login();
    const documents = ids((await status(headers)).documents);
    for (const sent of [
      [documents[0]!],
      [documents[0]!, '00000000-0000-4000-8000-000000000000'],
      ['00000000-0000-4000-8000-000000000000'],
    ]) {
      const response = await accept(headers, sent);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: 'terms_changed' } });
    }
    expect(await acceptancesOf(person.id)).toHaveLength(0);
  });
});

describe('nova versão', () => {
  it('publicar uma versão nova volta a bloquear até novo aceite, e só vale a partir da data', async () => {
    const person = await newUser();
    const headers = await person.login();
    await acceptCurrentDocs(headers);
    expect((await call('GET', '/me', headers)).status).toBe(200);

    // futura: ainda não é a vigente, ninguém é bloqueado
    await publishLegalVersion(tools.db, {
      kind: 'terms',
      version: 'v-teste',
      body: 'Termos novos (teste)',
      effectiveFrom: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect((await call('GET', '/me', headers)).status).toBe(200);
    await tools.db
      .delete(schema.legalDocumentVersion)
      .where(eq(schema.legalDocumentVersion.version, 'v-teste'));

    // vigente agora: bloqueia de novo
    const newId = await publishLegalVersion(tools.db, {
      kind: 'terms',
      version: 'v-teste',
      body: 'Termos novos (teste)',
      effectiveFrom: new Date(Date.now() - 1000),
    });
    const blocked = await call('GET', '/me', headers);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: { code: 'terms_required' } });

    const result = await status(headers);
    expect(result.accepted).toBe(false);
    expect(ids(result.documents)).toContain(newId);
    expect(result.documents.find((doc) => doc.kind === 'terms')!.body).toBe('Termos novos (teste)');

    // aceitar com os IDs ANTIGOS falha (a versão mudou); com os novos, libera
    const oldIds = ids((await currentVersions(tools.db)).filter((doc) => doc.id !== newId));
    expect((await accept(headers, oldIds)).status).toBe(409);
    expect((await acceptCurrentDocs(headers)).status).toBe(200);
    expect((await call('GET', '/me', headers)).status).toBe(200);
    // o aceite anterior continua registrado (histórico)
    expect((await acceptancesOf(person.id)).length).toBe(3);
  });
});

describe('o banco recusa o que o mecanismo não permite', () => {
  async function expectViolation(work: PromiseLike<unknown>, constraint: RegExp) {
    const error = (await work.then(
      () => null,
      (reason: unknown) => reason,
    )) as { message?: string; cause?: { message?: string } } | null;
    expect(error, 'a escrita deveria ser recusada').not.toBeNull();
    expect(`${error?.message} ${error?.cause?.message}`).toMatch(constraint);
  }

  it('declaração 18+ falsa, tipo desconhecido e versão repetida são recusados', async () => {
    const person = await newUser();
    const [terms] = await tools.db
      .select()
      .from(schema.legalDocumentVersion)
      .where(eq(schema.legalDocumentVersion.kind, 'terms'));
    await expectViolation(
      tools.db
        .insert(schema.termsAcceptance)
        .values({ userId: person.id, documentVersionId: terms!.id, adultDeclared: false }),
      /terms_acceptance_adult_check/,
    );
    await expectViolation(
      tools.db
        .insert(schema.legalDocumentVersion)
        .values({ kind: 'cookies', version: 'x', body: 'x', effectiveFrom: new Date() }),
      /legal_document_version_kind_check/,
    );
    await expectViolation(
      tools.db
        .insert(schema.legalDocumentVersion)
        .values({ kind: 'terms', version: 'provisorio-1', body: 'x', effectiveFrom: new Date() }),
      /legal_document_version_kind_version_idx/,
    );
  });

  it('uma versão com aceite não pode ser apagada (o histórico fica)', async () => {
    const person = await newUser();
    await acceptCurrentDocs(await person.login());
    await expectViolation(
      tools.db.delete(schema.legalDocumentVersion),
      /violates RESTRICT setting of foreign key constraint/,
    );
  });

  it('apagar a pessoa leva os aceites dela junto (LGPD), sem afetar as versões', async () => {
    const person = await newUser();
    await acceptCurrentDocs(await person.login());
    await tools.db.delete(schema.user).where(eq(schema.user.id, person.id));
    expect(await acceptancesOf(person.id)).toHaveLength(0);
    expect(await currentVersions(tools.db)).toHaveLength(2);
  });
});
