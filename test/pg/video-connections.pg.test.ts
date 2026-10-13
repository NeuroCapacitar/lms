import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { openSecret, parseKeyring } from '../../src/server/security/secret-box.ts';
import {
  ProviderNotVerifiedError,
  createConnection,
  readConnectionSecret,
  setConnectionStatus,
} from '../../src/server/video/connection-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-01 em Postgres 18 real: conexões com providers de vídeo. Só o Admin; reautenticação nas mudanças;
 * segredo cifrado (AES-256-GCM) que NUNCA volta em resposta, auditoria nem coluna em claro; rotação do
 * segredo e da chave mestra sem perder os assets; desativar não altera assets nem histórico.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

const key = (seed: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)));
const KEYS_V1 = `1:${key(1)}`;
const KEYS_V1_V2 = `1:${key(1)},2:${key(2)}`;
const PROVIDER_TOKEN = 'segredo falso do cliente 1';
const NEW_TOKEN = 'segredo falso rotacionado 2';

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
  await tools.db.execute(sql`truncate table video_asset, video_provider_connection cascade`);
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
/** `null` = o segredo do Worker NÃO está configurado. */
const env = (masterKey: string | null = KEYS_V1) =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
    ...(masterKey ? { VIDEO_SECRETS_MASTER_KEY: masterKey } : {}),
  }) as unknown as Env;

async function newPerson(
  options: { role?: 'support' | 'admin'; reauth?: boolean; grants?: string[] } = {},
) {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  if (options.role)
    await grantRole(tools.db, { actorId: null, targetId: user.id, role: options.role });
  for (const capability of options.grants ?? []) {
    await tools.db
      .insert(schema.staffGrant)
      .values({ userId: user.id, capability, grantedBy: user.id });
  }
  const session = await tools.test.login({ userId: user.id });
  if (options.reauth) {
    await tools.db
      .insert(schema.reauthProof)
      .values({ sessionId: session.session.id, verifiedAt: new Date() });
  }
  return { id: user.id, headers: session.headers };
}

function call(
  method: string,
  path: string,
  headers: Headers | undefined,
  body?: unknown,
  masterKey?: string | null,
) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api/staff${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    masterKey === undefined ? env() : env(masterKey),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;
const auditFor = (targetId: string) =>
  tools.db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, targetId));

async function createPanda(admin: { headers: Headers }, label = 'Conta Panda do cliente') {
  const response = await call('POST', '/video/connections', admin.headers, {
    provider: 'panda',
    label,
    secret: PROVIDER_TOKEN,
  });
  expect(response.status).toBe(201);
  return (await json(response)).connection as { id: string };
}

describe('autorização (só Admin)', () => {
  it('sem sessão 401; aluno 403; Suporte 403 MESMO com todos os grants delegáveis; Admin 200', async () => {
    const student = await newPerson();
    const support = await newPerson({
      role: 'support',
      reauth: true,
      grants: ['course.edit', 'access.grant', 'ops.queue', 'audit.view', 'finance.view'],
    });
    const admin = await newPerson({ role: 'admin' });
    expect((await call('GET', '/video/connections', undefined)).status).toBe(401);
    expect((await call('GET', '/video/connections', student.headers)).status).toBe(403);
    expect((await call('GET', '/video/connections', support.headers)).status).toBe(403);
    expect((await call('GET', '/video/connections', admin.headers)).status).toBe(200);
  });

  it('o Suporte também não cadastra, rotaciona, desativa nem recifra, direto pela API', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const connection = await createPanda(admin);
    const support = await newPerson({ role: 'support', reauth: true, grants: ['ops.queue'] });
    const attempts = [
      call('POST', '/video/connections', support.headers, {
        provider: 'mux',
        label: 'x',
        secret: 's',
      }),
      call('PUT', `/video/connections/${connection.id}/secret`, support.headers, {
        secret: 'novo',
      }),
      call('POST', `/video/connections/${connection.id}/disable`, support.headers, {}),
      call('POST', `/video/connections/${connection.id}/enable`, support.headers, {}),
      call('POST', '/video/rekey', support.headers, {}),
    ];
    for (const response of await Promise.all(attempts)) expect(response.status).toBe(403);
    const [row] = await tools.db.select().from(schema.videoProviderConnection);
    expect(row).toMatchObject({ status: 'active', keyVersion: 1 });
  });

  it('Admin SEM reautenticação recente não muda nada (403 reauth_required), mas lê', async () => {
    const admin = await newPerson({ role: 'admin' });
    const response = await call('POST', '/video/connections', admin.headers, {
      provider: 'mux',
      label: 'x',
      secret: 's',
    });
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: 'reauth_required' } });
    expect((await call('GET', '/video/connections', admin.headers)).status).toBe(200);
    expect(await tools.db.select().from(schema.videoProviderConnection)).toHaveLength(0);
  });

  it('conta suspensa não vê nada', async () => {
    const admin = await newPerson({ role: 'admin' });
    await tools.db
      .insert(schema.userSuspension)
      .values({ userId: admin.id, reason: 't', suspendedBy: admin.id });
    expect((await call('GET', '/video/connections', admin.headers)).status).toBe(403);
  });
});

describe('cadastro e segredo cifrado', () => {
  it('guarda CIFRADO (nenhuma coluna tem o segredo em claro) e devolve só "configurado" e a versão da chave', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const response = await call('POST', '/video/connections', admin.headers, {
      provider: 'panda',
      label: '  Conta Panda do cliente  ',
      secret: PROVIDER_TOKEN,
    });
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.connection).toMatchObject({
      provider: 'panda',
      label: 'Conta Panda do cliente',
      status: 'active',
      configured: true,
      keyVersion: 1,
    });
    expect(Object.keys(body.connection).sort()).toEqual(
      [
        'configured',
        'createdAt',
        'id',
        'keyVersion',
        'label',
        'provider',
        'status',
        'updatedAt',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toContain(PROVIDER_TOKEN);

    const [row] = await tools.db.select().from(schema.videoProviderConnection);
    expect(JSON.stringify(row)).not.toContain(PROVIDER_TOKEN);
    expect(JSON.stringify(row)).not.toContain('segredo falso');
    expect(row!.nonce).toHaveLength(16); // 12 bytes em base64
    // O AAD é id + provider: só abre com os dois.
    const ring = await parseKeyring(KEYS_V1);
    const sealed = {
      ciphertext: row!.ciphertext!,
      nonce: row!.nonce!,
      keyVersion: row!.keyVersion!,
    };
    expect(await openSecret(ring, sealed, `${row!.id}:panda`)).toBe(PROVIDER_TOKEN);
    await expect(openSecret(ring, sealed, `${row!.id}:mux`)).rejects.toThrow();
  });

  it('a listagem, a auditoria e todas as respostas NUNCA têm o segredo (varredura)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const connection = await createPanda(admin);
    const outputs = [
      await (await call('GET', '/video/connections', admin.headers)).text(),
      await (
        await call('PUT', `/video/connections/${connection.id}/secret`, admin.headers, {
          secret: NEW_TOKEN,
        })
      ).text(),
      await (
        await call('POST', `/video/connections/${connection.id}/disable`, admin.headers, {})
      ).text(),
      await (
        await call('POST', `/video/connections/${connection.id}/enable`, admin.headers, {})
      ).text(),
      await (await call('POST', '/video/rekey', admin.headers, {}, KEYS_V1_V2)).text(),
      JSON.stringify(await auditFor(connection.id)),
      JSON.stringify(await tools.db.select().from(schema.auditLog)),
    ].join('\n');
    for (const leaked of [
      PROVIDER_TOKEN,
      NEW_TOKEN,
      'segredo falso',
      'segredo falso rotacionado',
      'ciphertext',
      'nonce',
    ]) {
      expect(outputs, leaked).not.toContain(leaked);
    }
  });

  it('audita cada mudança com ator, provider e versão da chave (sem segredo)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const connection = await createPanda(admin);
    await call('PUT', `/video/connections/${connection.id}/secret`, admin.headers, {
      secret: NEW_TOKEN,
    });
    await call('POST', `/video/connections/${connection.id}/disable`, admin.headers, {});
    const audit = await auditFor(connection.id);
    expect(audit.map((entry) => entry.action).sort()).toEqual([
      'video.connection_create',
      'video.connection_disable',
      'video.secret_rotate',
    ]);
    expect(audit.every((entry) => entry.actorId === admin.id)).toBe(true);
    expect(audit.find((entry) => entry.action === 'video.connection_create')!.details).toEqual({
      provider: 'panda',
      label: 'Conta Panda do cliente',
      keyVersion: 1,
    });
  });

  it('provider que exige credencial recusa conexão sem segredo; YouTube e Vimeo aceitam sem', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const refused = await call('POST', '/video/connections', admin.headers, {
      provider: 'mux',
      label: 'sem segredo',
    });
    expect(refused.status).toBe(400);
    expect(await json(refused)).toEqual({ error: { code: 'secret_required' } });
    for (const provider of ['youtube', 'vimeo']) {
      const created = await call('POST', '/video/connections', admin.headers, {
        provider,
        label: `${provider} público`,
      });
      expect(created.status).toBe(201);
      expect((await json(created)).connection).toMatchObject({
        configured: false,
        keyVersion: null,
      });
    }
    const rows = await tools.db.select().from(schema.videoProviderConnection);
    expect(rows.filter((row) => row.ciphertext === null)).toHaveLength(2);
  });

  it('várias conexões por provider e nenhum provider padrão', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    await createPanda(admin, 'Conta A');
    await createPanda(admin, 'Conta B');
    const list = (await json(await call('GET', '/video/connections', admin.headers)))
      .connections as { provider: string }[];
    expect(list.filter((item) => item.provider === 'panda')).toHaveLength(2);
  });

  it('corpo inválido 400 (provider desconhecido, rótulo vazio, campo a mais, id malformado); inexistente 404', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    for (const body of [
      { provider: 'dailymotion', label: 'x', secret: 's' },
      { provider: 'mux', label: '', secret: 's' },
      { provider: 'mux', label: 'x', secret: 's', extra: 1 },
      {},
    ]) {
      expect((await call('POST', '/video/connections', admin.headers, body)).status).toBe(400);
    }
    expect(
      (await call('PUT', '/video/connections/nao-e-uuid/secret', admin.headers, { secret: 's' }))
        .status,
    ).toBe(400);
    const ghost = '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10';
    expect(
      (await call('PUT', `/video/connections/${ghost}/secret`, admin.headers, { secret: 's' }))
        .status,
    ).toBe(404);
    expect(
      (await call('POST', `/video/connections/${ghost}/disable`, admin.headers, {})).status,
    ).toBe(404);
  });

  it('sem o segredo do Worker (cofre ausente ou malformado): 503 e NADA é gravado', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    for (const masterKey of [null, 'malformado', `1:${btoa('curta')}`]) {
      const response = await call(
        'POST',
        '/video/connections',
        admin.headers,
        { provider: 'panda', label: 'x', secret: PROVIDER_TOKEN },
        masterKey,
      );
      expect(response.status, String(masterKey)).toBe(503);
      expect(await json(response)).toEqual({ error: { code: 'video_secrets_not_configured' } });
    }
    expect(await tools.db.select().from(schema.videoProviderConnection)).toHaveLength(0);
    // A listagem não precisa do cofre.
    expect((await call('GET', '/video/connections', admin.headers, undefined, null)).status).toBe(
      200,
    );
  });
});

describe('rotação e assets', () => {
  async function withAsset(admin: { headers: Headers }) {
    const connection = await createPanda(admin);
    const [asset] = await tools.db
      .insert(schema.videoAsset)
      .values({
        connectionId: connection.id,
        provider: 'panda',
        externalId: 'video-123',
        mode: 'managed',
        state: 'ready',
        durationSeconds: 600,
        capabilities: { reportsTime: true },
      })
      .returning();
    return { connection, asset: asset! };
  }

  it('rotacionar o segredo cifra de novo (nonce novo) e os assets e o progresso seguem iguais', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const { connection, asset } = await withAsset(admin);
    const [before] = await tools.db.select().from(schema.videoProviderConnection);
    expect(
      (
        await call('PUT', `/video/connections/${connection.id}/secret`, admin.headers, {
          secret: NEW_TOKEN,
        })
      ).status,
    ).toBe(200);
    const [after] = await tools.db.select().from(schema.videoProviderConnection);
    expect(after!.ciphertext).not.toBe(before!.ciphertext);
    expect(after!.nonce).not.toBe(before!.nonce);
    const ring = await parseKeyring(KEYS_V1);
    expect(await readConnectionSecret(tools.db, ring, connection.id)).toBe(NEW_TOKEN);
    const [kept] = await tools.db
      .select()
      .from(schema.videoAsset)
      .where(eq(schema.videoAsset.id, asset.id));
    expect(kept).toMatchObject({ externalId: 'video-123', durationSeconds: 600, state: 'ready' });
  });

  it('desativar NÃO apaga o segredo nem altera o asset; desativada não entrega o segredo; reativar volta', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const { connection, asset } = await withAsset(admin);
    const ring = await parseKeyring(KEYS_V1);
    expect(
      (await call('POST', `/video/connections/${connection.id}/disable`, admin.headers, {})).status,
    ).toBe(200);
    expect(await readConnectionSecret(tools.db, ring, connection.id)).toBeUndefined();
    const [row] = await tools.db.select().from(schema.videoProviderConnection);
    expect(row).toMatchObject({ status: 'disabled', keyVersion: 1 });
    expect(row!.ciphertext).not.toBeNull();
    const [kept] = await tools.db
      .select()
      .from(schema.videoAsset)
      .where(eq(schema.videoAsset.id, asset.id));
    expect(kept).toMatchObject({ provider: 'panda', externalId: 'video-123' });
    await call('POST', `/video/connections/${connection.id}/enable`, admin.headers, {});
    expect(await readConnectionSecret(tools.db, ring, connection.id)).toBe(PROVIDER_TOKEN);
  });

  it('a conexão com asset não pode ser apagada do banco (FK restrict) e um asset duplicado na mesma conexão é recusado', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const { connection } = await withAsset(admin);
    await expect(
      tools.db
        .delete(schema.videoProviderConnection)
        .where(eq(schema.videoProviderConnection.id, connection.id)),
    ).rejects.toThrow();
    await expect(
      tools.db.insert(schema.videoAsset).values({
        connectionId: connection.id,
        provider: 'panda',
        externalId: 'video-123',
        mode: 'referenced',
      }),
    ).rejects.toThrow();
  });

  it('rotação da chave mestra: com v1 e v2 no cofre, recifrar leva tudo à v2; depois a v1 pode sair', async () => {
    const rekeysBefore = (await auditFor('all')).filter(
      (entry) => entry.action === 'video.rekey',
    ).length;
    const admin = await newPerson({ role: 'admin', reauth: true });
    const { connection } = await withAsset(admin);
    const publicConnection = await call('POST', '/video/connections', admin.headers, {
      provider: 'youtube',
      label: 'público',
    });
    expect(publicConnection.status).toBe(201);

    // Com v1 e v2 no cofre o segredo antigo continua abrindo (sem downtime).
    const ringBoth = await parseKeyring(KEYS_V1_V2);
    expect(await readConnectionSecret(tools.db, ringBoth, connection.id)).toBe(PROVIDER_TOKEN);

    const rekeyed = await call('POST', '/video/rekey', admin.headers, {}, KEYS_V1_V2);
    expect(rekeyed.status).toBe(200);
    expect(await json(rekeyed)).toEqual({ rekeyed: 1, alreadyCurrent: 0, failed: 0 });
    const [row] = await tools.db
      .select()
      .from(schema.videoProviderConnection)
      .where(eq(schema.videoProviderConnection.id, connection.id));
    expect(row!.keyVersion).toBe(2);

    // Agora a v1 pode sair do cofre: só a v2 basta.
    const ringNew = await parseKeyring(`2:${key(2)}`);
    expect(await readConnectionSecret(tools.db, ringNew, connection.id)).toBe(PROVIDER_TOKEN);
    // Repetir é idempotente.
    expect(await json(await call('POST', '/video/rekey', admin.headers, {}, KEYS_V1_V2))).toEqual({
      rekeyed: 0,
      alreadyCurrent: 1,
      failed: 0,
    });
    // A auditoria é append-only e o alvo `all` acumula entre testes: conta só o que ESTE teste fez.
    const audit = await auditFor('all');
    expect(audit.filter((entry) => entry.action === 'video.rekey').length).toBe(rekeysBefore + 2);
  });

  it('recifrar com uma versão ausente NÃO destrói o segredo: conta como falha e deixa a linha como está', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const { connection } = await withAsset(admin);
    const [before] = await tools.db.select().from(schema.videoProviderConnection);
    // O cofre só tem a v2: a conexão está na v1, que não existe mais ali.
    const response = await call('POST', '/video/rekey', admin.headers, {}, `2:${key(2)}`);
    expect(await json(response)).toEqual({ rekeyed: 0, alreadyCurrent: 0, failed: 1 });
    const [after] = await tools.db.select().from(schema.videoProviderConnection);
    expect(after).toMatchObject({ ciphertext: before!.ciphertext, keyVersion: 1 });
    // Com a v1 de volta no cofre ainda abre.
    expect(await readConnectionSecret(tools.db, await parseKeyring(KEYS_V1), connection.id)).toBe(
      PROVIDER_TOKEN,
    );
  });

  it('ciphertext copiado para OUTRA conexão não abre (o AAD amarra id e provider)', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const first = await createPanda(admin, 'A');
    const second = await createPanda(admin, 'B');
    const [a] = await tools.db
      .select()
      .from(schema.videoProviderConnection)
      .where(eq(schema.videoProviderConnection.id, first.id));
    await tools.db
      .update(schema.videoProviderConnection)
      .set({ ciphertext: a!.ciphertext, nonce: a!.nonce })
      .where(eq(schema.videoProviderConnection.id, second.id));
    await expect(
      readConnectionSecret(tools.db, await parseKeyring(KEYS_V1), second.id),
    ).rejects.toThrow('decryption_failed');
  });

  it('as colunas do cofre vêm juntas: ciphertext sem nonce ou sem versão é recusado pelo banco', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const connection = await createPanda(admin);
    await expect(
      tools.db.execute(
        sql`update video_provider_connection set nonce = null where id = ${connection.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      tools.db.execute(
        sql`update video_provider_connection set key_version = 0 where id = ${connection.id}`,
      ),
    ).rejects.toThrow();
  });
});

describe('trava de ativação dos providers (M5-03)', () => {
  it('GET /video/providers: só o Admin; em Dev todos selecionáveis e NENHUM verificado', async () => {
    expect((await call('GET', '/video/providers', undefined)).status).toBe(401);
    const support = await newPerson({ role: 'support' });
    expect((await call('GET', '/video/providers', support.headers)).status).toBe(403);
    const admin = await newPerson({ role: 'admin' });
    const response = await call('GET', '/video/providers', admin.headers);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(body.environment).toBe('development');
    expect(body.providers).toHaveLength(6);
    expect(body.providers.every((item: any) => item.selectable && !item.verified)).toBe(true);
  });

  it('em Production, cadastrar conexão de provider NÃO verificado é recusado e nada é gravado', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const keyring = await parseKeyring(KEYS_V1);
    await expect(
      createConnection(tools.db, keyring, {
        provider: 'panda',
        label: 'Panda',
        secret: PROVIDER_TOKEN,
        actorId: admin.id,
        environment: 'production',
      }),
    ).rejects.toBeInstanceOf(ProviderNotVerifiedError);
    // ambiente desconhecido também é Production
    await expect(
      createConnection(tools.db, keyring, {
        provider: 'youtube',
        label: 'YT',
        actorId: admin.id,
        environment: 'preview',
      }),
    ).rejects.toBeInstanceOf(ProviderNotVerifiedError);
    expect(await tools.db.select().from(schema.videoProviderConnection)).toHaveLength(0);
    const staging = await createConnection(tools.db, keyring, {
      provider: 'panda',
      label: 'Panda',
      secret: PROVIDER_TOKEN,
      actorId: admin.id,
      environment: 'staging',
    });
    expect(staging.provider).toBe('panda');
  });

  it('em Production, reativar conexão de provider não verificado é recusado; desativar sempre pode', async () => {
    const admin = await newPerson({ role: 'admin', reauth: true });
    const connection = await createPanda(admin);
    const disabled = await setConnectionStatus(tools.db, {
      id: connection.id,
      status: 'disabled',
      actorId: admin.id,
      environment: 'production',
    });
    expect(disabled.status).toBe('disabled');
    await expect(
      setConnectionStatus(tools.db, {
        id: connection.id,
        status: 'active',
        actorId: admin.id,
        environment: 'production',
      }),
    ).rejects.toBeInstanceOf(ProviderNotVerifiedError);
    const [row] = await tools.db
      .select()
      .from(schema.videoProviderConnection)
      .where(eq(schema.videoProviderConnection.id, connection.id));
    expect(row!.status).toBe('disabled');
    expect(
      (
        await setConnectionStatus(tools.db, {
          id: connection.id,
          status: 'active',
          actorId: admin.id,
          environment: 'staging',
        })
      ).status,
    ).toBe('active');
  });
});
