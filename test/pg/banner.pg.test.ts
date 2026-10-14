import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { publicLoginMediaRoutes } from '../../src/server/banner/routes.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createMemoryStorage, type MemoryStorage } from '../../src/server/media/memory-storage.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { pngBytes } from '../helpers/media-bytes.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-15 em Postgres 18 real, com o armazenamento EM MEMÓRIA (o R2 real não foi exercitado, ver STATUS): banners do
 * painel (alt obrigatório, link só interno ou de host permitido, janela de exibição, ordem, publicar COPIA a
 * imagem antes de mudar o estado, rascunho nunca vaza) e imagens do login (teto de 5 publicadas, sem sessão).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const MEDIA_URL = 'https://midia.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
const DAY = 86_400_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let storage: MemoryStorage;
let seq = 0;
let clockNow = T0;
let withStorage = true;
let withMediaUrl = true;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  clockNow = T0;
  withStorage = true;
  withMediaUrl = true;
  storage = createMemoryStorage();
  await tools.db.execute(
    sql`truncate table panel_banner, login_media, media_reference, media_asset cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.profile);
  await tools.db.delete(schema.user);
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
    ...(withMediaUrl ? { MEDIA_PUBLIC_BASE_URL: MEDIA_URL } : {}),
  }) as unknown as Env;
// `/api/public` fica fora do `authRoutes` (no Worker é montada em `app.ts`): aqui a montamos ao lado.
const app = () =>
  new Hono<{ Bindings: Env }>().route('/api/public', publicLoginMediaRoutes()).route(
    '/',
    apiApp({
      emailSender: createFakeEmailSender(),
      isStaffEmail: async () => false,
      clock: () => clockNow,
      ...(withStorage ? { mediaStorage: storage } : {}),
    }),
  );

interface Person {
  id: string;
  headers: Headers;
}
async function newPerson(role?: 'support' | 'admin'): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  if (role) await grantRole(tools.db, { actorId: null, targetId: user.id, role });
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}
function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** Intenção, "PUT" do navegador e confirmação: devolve o id da mídia pronta. */
async function readyMedia(who: Person, purpose: string, bytes: Uint8Array): Promise<string> {
  const created = await call('POST', '/media/intents', who.headers, {
    purpose,
    contentType: 'image/png',
    size: bytes.length,
  });
  expect(created.status).toBe(201);
  const { id } = await json(created);
  storage.upload(`m/${id}`, bytes, 'image/png');
  expect((await call('POST', `/media/${id}/confirm`, who.headers)).status).toBe(200);
  return id as string;
}
const bannerImage = (admin: Person, extra = 0) =>
  readyMedia(admin, 'panel_banner', pngBytes(1680, 420, 300 + extra));
const loginImage = (admin: Person, extra = 0) =>
  readyMedia(admin, 'login_media', pngBytes(900, 1200, 300 + extra));

const createBanner = async (admin: Person, body: Record<string, unknown>) =>
  call('POST', '/staff/banners/panel', admin.headers, body);
const setState = (admin: Person, kind: 'panel' | 'login', id: string, state: string) =>
  call('POST', `/staff/banners/${kind}/${id}/state`, admin.headers, { state });
const studentBanners = async (who: Person) =>
  (await json(await call('GET', '/me/banners', who.headers))).banners as Record<string, any>[];
const loginList = async () =>
  (await json(await call('GET', '/public/login-media'))).items as Record<string, any>[];

describe('quem pode', () => {
  it('a gestão é só do Admin: sem sessão 401, aluno e Suporte 403', async () => {
    const student = await newPerson();
    const support = await newPerson('support');
    const admin = await newPerson('admin');
    const id = crypto.randomUUID();
    const routes: [string, string][] = [
      ['GET', '/staff/banners'],
      ['POST', '/staff/banners/panel'],
      ['PUT', `/staff/banners/panel/${id}`],
      ['POST', `/staff/banners/panel/${id}/state`],
      ['POST', `/staff/banners/panel/${id}/move`],
      ['POST', `/staff/banners/panel/${id}/delete`],
      ['POST', '/staff/banners/login'],
      ['POST', `/staff/banners/login/${id}/state`],
      ['POST', `/staff/banners/login/${id}/move`],
      ['POST', `/staff/banners/login/${id}/delete`],
    ];
    for (const [method, path] of routes) {
      expect((await call(method, path)).status, `${method} ${path} sem sessão`).toBe(401);
      expect((await call(method, path, student.headers)).status, `${method} ${path} aluno`).toBe(
        403,
      );
      expect((await call(method, path, support.headers)).status, `${method} ${path} suporte`).toBe(
        403,
      );
    }
    expect((await call('GET', '/staff/banners', admin.headers)).status).toBe(200);
    // o envio das imagens também é do Admin
    for (const purpose of ['panel_banner', 'login_media']) {
      const body = { purpose, contentType: 'image/png', size: 1000 };
      expect((await call('POST', '/media/intents', support.headers, body)).status).toBe(403);
      expect((await call('POST', '/media/intents', admin.headers, body)).status).toBe(201);
    }
  });

  it('o aluno precisa de sessão para ver os banners', async () => {
    expect((await call('GET', '/me/banners')).status).toBe(401);
  });
});

describe('a imagem enviada', () => {
  it('só a proporção certa vira mídia pronta: banner 4:1, login 3:4', async () => {
    const admin = await newPerson('admin');
    const send = async (purpose: string, bytes: Uint8Array) => {
      const created = await call('POST', '/media/intents', admin.headers, {
        purpose,
        contentType: 'image/png',
        size: bytes.length,
      });
      const { id } = await json(created);
      storage.upload(`m/${id}`, bytes, 'image/png');
      return (await call('POST', `/media/${id}/confirm`, admin.headers)).status;
    };
    expect(await send('panel_banner', pngBytes(1000, 1000, 300))).toBe(422);
    expect(await send('panel_banner', pngBytes(840, 200, 300))).toBe(422);
    expect(await send('panel_banner', pngBytes(1680, 420, 300))).toBe(200);
    expect(await send('login_media', pngBytes(1200, 900, 300))).toBe(422);
    expect(await send('login_media', pngBytes(900, 1200, 300))).toBe(200);
  });
});

describe('criar e editar o banner', () => {
  it('nasce como rascunho no fim da lista; alt obrigatório; link só interno ou de host permitido', async () => {
    const admin = await newPerson('admin');
    const mediaId = await bannerImage(admin);
    const bad = [
      { mediaId },
      { mediaId, alt: '   ' },
      { mediaId, alt: 'ok', linkUrl: 'javascript:alert(1)' },
      { mediaId, alt: 'ok', linkUrl: 'https://evil.example/' },
      { mediaId, alt: 'ok', linkUrl: '//evil.example' },
      { mediaId, alt: 'ok', startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-10-10T00:00:00Z' },
      { mediaId, alt: 'ok', state: 'published' },
    ];
    for (const body of bad) {
      expect((await createBanner(admin, body)).status, JSON.stringify(body)).toBe(400);
    }
    const created = await createBanner(admin, {
      mediaId,
      alt: '  Matrículas abertas  ',
      linkUrl: '/cursos',
    });
    expect(created.status).toBe(201);
    expect((await json(created)).item).toEqual({
      id: expect.any(String),
      mediaId,
      alt: 'Matrículas abertas',
      linkUrl: '/cursos',
      startsAt: null,
      endsAt: null,
      state: 'draft',
    });
    const refs = await tools.db.select().from(schema.mediaReference);
    expect(refs).toEqual([expect.objectContaining({ ownerType: 'panel_banner', mediaId })]);
  });

  it('mídia inexistente, ainda não confirmada ou de outro propósito é recusada (sem violação de FK)', async () => {
    const admin = await newPerson('admin');
    const cover = await readyMedia(admin, 'course_cover', pngBytes(1280, 720, 300));
    const pending = await json(
      await call('POST', '/media/intents', admin.headers, {
        purpose: 'panel_banner',
        contentType: 'image/png',
        size: 500,
      }),
    );
    expect((await createBanner(admin, { mediaId: cover, alt: 'x' })).status).toBe(422);
    expect((await createBanner(admin, { mediaId: pending.id, alt: 'x' })).status).toBe(409);
    expect((await createBanner(admin, { mediaId: crypto.randomUUID(), alt: 'x' })).status).toBe(
      409,
    );
    expect(await tools.db.select().from(schema.panelBanner)).toHaveLength(0);
    // login com mídia de banner: propósito errado
    const wrong = await bannerImage(admin);
    expect(
      (await call('POST', '/staff/banners/login', admin.headers, { mediaId: wrong })).status,
    ).toBe(422);
  });

  it('editar troca texto, link e janela; ids malformados ou inexistentes dão 404', async () => {
    const admin = await newPerson('admin');
    const mediaId = await bannerImage(admin);
    const { item } = await json(await createBanner(admin, { mediaId, alt: 'Antes' }));
    const updated = await call('PUT', `/staff/banners/panel/${item.id}`, admin.headers, {
      mediaId,
      alt: 'Depois',
      linkUrl: 'https://app.neurocapacitar.com.br/promo',
      startsAt: '2026-10-10T00:00:00Z',
      endsAt: '2026-10-20T00:00:00Z',
    });
    expect(updated.status).toBe(200);
    expect((await json(updated)).item).toMatchObject({
      alt: 'Depois',
      linkUrl: 'https://app.neurocapacitar.com.br/promo',
      startsAt: '2026-10-10T00:00:00.000Z',
      endsAt: '2026-10-20T00:00:00.000Z',
    });
    for (const id of ['x', crypto.randomUUID()]) {
      expect(
        (await call('PUT', `/staff/banners/panel/${id}`, admin.headers, { mediaId, alt: 'x' }))
          .status,
      ).toBe(404);
      expect((await setState(admin, 'panel', id, 'published')).status).toBe(404);
      expect((await call('POST', `/staff/banners/panel/${id}/delete`, admin.headers)).status).toBe(
        404,
      );
    }
  });
});

describe('publicar e o que o aluno vê', () => {
  it('rascunho não aparece; publicar COPIA a imagem para o bucket público e então o aluno a vê', async () => {
    const admin = await newPerson('admin');
    const student = await newPerson();
    const mediaId = await bannerImage(admin);
    const { item } = await json(
      await createBanner(admin, { mediaId, alt: 'Promo', linkUrl: '/x' }),
    );
    expect(await studentBanners(student)).toEqual([]);
    expect(storage.keys('public')).toEqual([]);

    expect((await setState(admin, 'panel', item.id, 'published')).status).toBe(200);
    expect(storage.keys('public')).toHaveLength(1);
    const seen = await studentBanners(student);
    expect(seen).toEqual([
      {
        id: item.id,
        alt: 'Promo',
        linkUrl: '/x',
        image: {
          src: expect.stringContaining(`${MEDIA_URL}/cdn-cgi/image/width=1680`),
          fallbackSrc: expect.stringMatching(new RegExp(`^${MEDIA_URL}/[0-9a-f-]+\\.png$`)),
          width: 1680,
          height: 420,
        },
      },
    ]);
    // nada de campo interno na resposta do aluno
    expect(Object.keys(seen[0]!).sort()).toEqual(['alt', 'id', 'image', 'linkUrl']);

    // voltar a rascunho tira da tela
    expect((await setState(admin, 'panel', item.id, 'draft')).status).toBe(200);
    expect(await studentBanners(student)).toEqual([]);
  });

  it('sem R2 configurado não publica (503) e o estado continua rascunho', async () => {
    const admin = await newPerson('admin');
    const mediaId = await bannerImage(admin);
    const { item } = await json(await createBanner(admin, { mediaId, alt: 'Promo' }));
    withStorage = false;
    expect((await setState(admin, 'panel', item.id, 'published')).status).toBe(503);
    const [row] = await tools.db.select().from(schema.panelBanner);
    expect(row!.state).toBe('draft');
  });

  it('a janela de exibição vale por requisição: início inclusivo, fim exclusivo', async () => {
    const admin = await newPerson('admin');
    const student = await newPerson();
    const mediaId = await bannerImage(admin);
    const startsAt = new Date(T0.getTime() + DAY).toISOString();
    const endsAt = new Date(T0.getTime() + 3 * DAY).toISOString();
    const { item } = await json(
      await createBanner(admin, { mediaId, alt: 'Janela', startsAt, endsAt }),
    );
    await setState(admin, 'panel', item.id, 'published');
    expect(await studentBanners(student)).toEqual([]);
    clockNow = new Date(startsAt);
    expect(await studentBanners(student)).toHaveLength(1);
    clockNow = new Date(new Date(endsAt).getTime() - 1);
    expect(await studentBanners(student)).toHaveLength(1);
    clockNow = new Date(endsAt);
    expect(await studentBanners(student)).toEqual([]);
  });

  it('a ordem da Staff vale para o aluno; subir e descer troca com o vizinho e nas pontas não faz nada', async () => {
    const admin = await newPerson('admin');
    const student = await newPerson();
    const ids: string[] = [];
    for (const [index, alt] of ['A', 'B', 'C'].entries()) {
      const mediaId = await bannerImage(admin, index);
      const { item } = await json(await createBanner(admin, { mediaId, alt }));
      await setState(admin, 'panel', item.id, 'published');
      ids.push(item.id);
    }
    const order = async () => (await studentBanners(student)).map((banner) => banner.alt);
    expect(await order()).toEqual(['A', 'B', 'C']);
    const move = (id: string, direction: string) =>
      call('POST', `/staff/banners/panel/${id}/move`, admin.headers, { direction });
    expect((await move(ids[2]!, 'up')).status).toBe(200);
    expect(await order()).toEqual(['A', 'C', 'B']);
    expect((await move(ids[0]!, 'up')).status).toBe(200);
    expect(await order()).toEqual(['A', 'C', 'B']);
    expect((await move(ids[0]!, 'down')).status).toBe(200);
    expect(await order()).toEqual(['C', 'A', 'B']);
    expect((await move(ids[0]!, 'sideways')).status).toBe(400);
    const positions = (await tools.db.select().from(schema.panelBanner))
      .map((row) => row.position)
      .sort();
    expect(positions).toEqual([0, 1, 2]);
  });

  it('trocar a imagem de um banner PUBLICADO publica a nova antes; excluir solta a referência', async () => {
    const admin = await newPerson('admin');
    const student = await newPerson();
    const first = await bannerImage(admin);
    const second = await bannerImage(admin, 1);
    const { item } = await json(await createBanner(admin, { mediaId: first, alt: 'Promo' }));
    await setState(admin, 'panel', item.id, 'published');
    const swapped = await call('PUT', `/staff/banners/panel/${item.id}`, admin.headers, {
      mediaId: second,
      alt: 'Promo',
    });
    expect(swapped.status).toBe(200);
    expect(storage.keys('public')).toHaveLength(2);
    expect(await studentBanners(student)).toHaveLength(1);
    const refs = await tools.db.select().from(schema.mediaReference);
    expect(refs).toEqual([expect.objectContaining({ mediaId: second })]);

    expect(
      (await call('POST', `/staff/banners/panel/${item.id}/delete`, admin.headers)).status,
    ).toBe(200);
    expect(await studentBanners(student)).toEqual([]);
    expect(await tools.db.select().from(schema.panelBanner)).toHaveLength(0);
    expect(await tools.db.select().from(schema.mediaReference)).toHaveLength(0);
  });

  it('banner cuja mídia ainda não foi copiada para o público não aparece, mesmo publicado no banco', async () => {
    const admin = await newPerson('admin');
    const student = await newPerson();
    const mediaId = await bannerImage(admin);
    const { item } = await json(await createBanner(admin, { mediaId, alt: 'Promo' }));
    // estado forçado direto no banco (como se a cópia nunca tivesse ocorrido)
    await tools.db
      .update(schema.panelBanner)
      .set({ state: 'published' })
      .where(eq(schema.panelBanner.id, item.id));
    expect(await studentBanners(student)).toEqual([]);
  });

  it('sem MEDIA_PUBLIC_BASE_URL nada é entregue (a tela cai no estado vazio)', async () => {
    const admin = await newPerson('admin');
    const student = await newPerson();
    const mediaId = await bannerImage(admin);
    const { item } = await json(await createBanner(admin, { mediaId, alt: 'Promo' }));
    await setState(admin, 'panel', item.id, 'published');
    withMediaUrl = false;
    expect(await studentBanners(student)).toEqual([]);
  });

  it('a lista da Staff traz rascunhos e publicados, na ordem', async () => {
    const admin = await newPerson('admin');
    const a = await bannerImage(admin);
    const b = await bannerImage(admin, 1);
    const first = (await json(await createBanner(admin, { mediaId: a, alt: 'A' }))).item;
    await createBanner(admin, { mediaId: b, alt: 'B' });
    await setState(admin, 'panel', first.id, 'published');
    const list = await json(await call('GET', '/staff/banners', admin.headers));
    expect(list.panel.map((item: any) => [item.alt, item.state])).toEqual([
      ['A', 'published'],
      ['B', 'draft'],
    ]);
    expect(list.login).toEqual([]);
  });
});

describe('imagens do login', () => {
  it('a tela pública (sem sessão) só recebe as publicadas, sem alt; rascunho não vaza', async () => {
    const admin = await newPerson('admin');
    expect(await loginList()).toEqual([]);
    const a = await loginImage(admin);
    const b = await loginImage(admin, 1);
    const first = (
      await json(await call('POST', '/staff/banners/login', admin.headers, { mediaId: a }))
    ).item;
    await call('POST', '/staff/banners/login', admin.headers, { mediaId: b });
    expect(first).toEqual({ id: expect.any(String), mediaId: a, state: 'draft' });
    expect(await loginList()).toEqual([]);

    expect((await setState(admin, 'login', first.id, 'published')).status).toBe(200);
    const items = await loginList();
    expect(items).toEqual([
      {
        id: first.id,
        image: {
          src: expect.stringContaining(`${MEDIA_URL}/cdn-cgi/image/width=600`),
          fallbackSrc: expect.stringMatching(/\.png$/),
          width: 900,
          height: 1200,
        },
      },
    ]);
    expect(storage.keys('public')).toHaveLength(1);
  });

  it('no máximo 5 publicadas: a 6ª recebe 409 e continua rascunho; despublicar libera a vaga', async () => {
    const admin = await newPerson('admin');
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const mediaId = await loginImage(admin, index);
      const { item } = await json(
        await call('POST', '/staff/banners/login', admin.headers, { mediaId }),
      );
      ids.push(item.id);
    }
    for (const id of ids.slice(0, 5)) {
      expect((await setState(admin, 'login', id, 'published')).status).toBe(200);
    }
    const sixth = await setState(admin, 'login', ids[5]!, 'published');
    expect(sixth.status).toBe(409);
    expect(await json(sixth)).toEqual({ error: { code: 'too_many_published' } });
    const states = await tools.db.select().from(schema.loginMedia);
    expect(states.filter((row) => row.state === 'published')).toHaveLength(5);
    expect(await loginList()).toHaveLength(5);

    // publicar de novo uma que JÁ está publicada não conta duas vezes
    expect((await setState(admin, 'login', ids[0]!, 'published')).status).toBe(200);
    expect((await setState(admin, 'login', ids[0]!, 'draft')).status).toBe(200);
    expect((await setState(admin, 'login', ids[5]!, 'published')).status).toBe(200);
    expect(await loginList()).toHaveLength(5);
  });

  it('publicações simultâneas nunca passam de 5', async () => {
    const admin = await newPerson('admin');
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const mediaId = await loginImage(admin, index);
      const { item } = await json(
        await call('POST', '/staff/banners/login', admin.headers, { mediaId }),
      );
      ids.push(item.id);
    }
    const results = await Promise.all(ids.map((id) => setState(admin, 'login', id, 'published')));
    const ok = results.filter((response) => response.status === 200).length;
    expect(ok).toBe(5);
    expect(results.filter((response) => response.status === 409)).toHaveLength(3);
    const rows = await tools.db.select().from(schema.loginMedia);
    expect(rows.filter((row) => row.state === 'published')).toHaveLength(5);
  });

  it('ordem e exclusão: mover reordena e excluir solta a referência da mídia', async () => {
    const admin = await newPerson('admin');
    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const mediaId = await loginImage(admin, index);
      const { item } = await json(
        await call('POST', '/staff/banners/login', admin.headers, { mediaId }),
      );
      await setState(admin, 'login', item.id, 'published');
      ids.push(item.id);
    }
    expect((await loginList()).map((item) => item.id)).toEqual(ids);
    await call('POST', `/staff/banners/login/${ids[1]}/move`, admin.headers, { direction: 'up' });
    expect((await loginList()).map((item) => item.id)).toEqual([ids[1], ids[0]]);
    expect(
      (await call('POST', `/staff/banners/login/${ids[1]}/delete`, admin.headers)).status,
    ).toBe(200);
    expect((await loginList()).map((item) => item.id)).toEqual([ids[0]]);
    expect(await tools.db.select().from(schema.mediaReference)).toHaveLength(1);
  });
});
