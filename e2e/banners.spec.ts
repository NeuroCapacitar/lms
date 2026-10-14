import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { solidPng } from './support/png.ts';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ID = (n: number) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`;
const MEDIA_ID = '99999999-9999-4999-8999-999999999998';

/** Imagem pública simulada: um caminho do próprio site (a CSP só deixa `img-src 'self'`). */
const image = (n: number, width = 1680, height = 420) => ({
  src: `/img/banner-${n}.png`,
  fallbackSrc: `/img/banner-${n}.png`,
  width,
  height,
});

const banner = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: ID(n),
  image: image(n),
  alt: `Banner ${n}: matrículas abertas`,
  linkUrl: null,
  ...overrides,
});

async function stubImages(page: Page) {
  await page.route('**/img/*.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: solidPng(60, 15) }),
  );
}

async function stubStudent(
  page: Page,
  options: { banners?: unknown[]; failBanners?: boolean } = {},
) {
  await stubImages(page);
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/catalog/courses', (route) =>
    route.fulfill({
      json: {
        courses: [
          {
            id: 'c-demo',
            slug: 'demo',
            title: 'Curso Demonstrativo',
            summary: 'Conteúdo sintético.',
            workloadHours: 3,
            sequenceMode: 'guided',
            availability: 'open',
            offer: {
              id: 'o-demo',
              kind: 'free',
              priceCents: 0,
              accessMonths: 3,
              maxInstallments: 1,
            },
            access: { hasAccess: false, reason: 'no_access', expiresAt: null },
            interested: false,
          },
        ],
      },
    }),
  );
  await page.route('**/api/me/banners', (route) =>
    options.failBanners
      ? route.fulfill({ status: 500, json: { error: { code: 'internal' } } })
      : route.fulfill({ json: { banners: options.banners ?? [] } }),
  );
}

test.describe('banners no painel do aluno (M5-15)', () => {
  test('mostra um banner por vez, com navegação manual, texto alternativo e link', async ({
    page,
  }) => {
    await stubStudent(page, {
      banners: [
        banner(1, { linkUrl: '/ajuda' }),
        banner(2, { linkUrl: 'https://neurocapacitar.com.br/promo' }),
        banner(3),
      ],
    });
    await page.goto('/cursos');
    const strip = page.getByRole('region', { name: 'Destaques' });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('img', { name: 'Banner 1: matrículas abertas' })).toBeVisible();
    await expect(strip.getByRole('link')).toHaveAttribute('href', '/ajuda');
    await expect(strip.getByRole('status')).toHaveText('Banner 1 de 3');
    // um por vez: os outros dois não estão na tela
    await expect(strip.getByRole('img')).toHaveCount(1);

    // nada gira sozinho (WCAG 2.2.2): continua no 1 depois de um tempo
    await page.waitForTimeout(1500);
    await expect(strip.getByRole('status')).toHaveText('Banner 1 de 3');

    await strip.getByRole('button', { name: 'Próximo banner' }).click();
    await expect(strip.getByRole('img', { name: 'Banner 2: matrículas abertas' })).toBeVisible();
    await expect(strip.getByRole('status')).toHaveText('Banner 2 de 3');
    const external = strip.getByRole('link');
    await expect(external).toHaveAttribute('href', 'https://neurocapacitar.com.br/promo');
    await expect(external).toHaveAttribute('rel', 'noopener noreferrer');

    await strip.getByRole('button', { name: 'Próximo banner' }).click();
    await expect(strip.getByRole('link')).toHaveCount(0);
    // dá a volta nos dois sentidos
    await strip.getByRole('button', { name: 'Próximo banner' }).click();
    await expect(strip.getByRole('status')).toHaveText('Banner 1 de 3');
    await strip.getByRole('button', { name: 'Banner anterior' }).click();
    await expect(strip.getByRole('status')).toHaveText('Banner 3 de 3');
  });

  test('um único banner não mostra os botões de navegação', async ({ page }) => {
    await stubStudent(page, { banners: [banner(1)] });
    await page.goto('/cursos');
    const strip = page.getByRole('region', { name: 'Destaques' });
    await expect(strip.getByRole('img', { name: 'Banner 1: matrículas abertas' })).toBeVisible();
    await expect(strip.getByRole('button')).toHaveCount(0);
  });

  test('sem banner ativo ou com falha na lista, o painel segue normal', async ({ page }) => {
    await stubStudent(page, { banners: [] });
    await page.goto('/cursos');
    await expect(page.getByRole('link', { name: 'Curso Demonstrativo' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Destaques' })).toHaveCount(0);

    const failing = await page.context().newPage();
    await stubStudent(failing, { failBanners: true });
    await failing.goto('/cursos');
    await expect(failing.getByRole('link', { name: 'Curso Demonstrativo' })).toBeVisible();
    await expect(failing.getByRole('region', { name: 'Destaques' })).toHaveCount(0);
  });

  test('se a variante da imagem falhar, troca uma vez para o master e não quebra a tela', async ({
    page,
  }) => {
    await stubStudent(page, {
      banners: [
        banner(1, {
          image: { ...image(1), src: '/img/variante-falha.png', fallbackSrc: '/img/banner-1.png' },
        }),
      ],
    });
    await page.route('**/img/variante-falha.png', (route) => route.fulfill({ status: 502 }));
    await page.goto('/cursos');
    const img = page.getByRole('img', { name: 'Banner 1: matrículas abertas' });
    await expect(img).toHaveAttribute('src', '/img/banner-1.png');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade e sem rolagem horizontal no celular (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubStudent(page, { banners: [banner(1), banner(2)] });
      await page.goto('/cursos');
      await expect(page.getByRole('region', { name: 'Destaques' })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
      await page.setViewportSize({ width: 375, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
});

test.describe('imagem decorativa do login (M5-15)', () => {
  async function stubLogin(page: Page, items: unknown[]) {
    await stubImages(page);
    const calls = { loginMedia: 0 };
    await page.route('**/api/public/login-media', (route) => {
      calls.loginMedia += 1;
      return route.fulfill({ json: { items } });
    });
    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: false } }));
    return calls;
  }
  const item = { id: ID(1), image: image(1, 900, 1200) };

  test('em tela larga mostra a imagem, decorativa (fora da árvore de acessibilidade)', async ({
    page,
  }) => {
    const calls = await stubLogin(page, [item]);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    const decor = page.locator('[aria-hidden="true"] img[src="/img/banner-1.png"]');
    await expect(decor).toBeVisible();
    await expect(decor).toHaveAttribute('alt', '');
    expect(calls.loginMedia).toBeGreaterThan(0);
    // a imagem não entra na árvore de acessibilidade
    await expect(page.getByRole('img')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('no celular nem a lista é pedida: a tela fica como era', async ({ page }) => {
    const calls = await stubLogin(page, [item]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(calls.loginMedia).toBe(0);
    await expect(page.locator('img')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('sem imagem publicada, ou com falha da lista, a tela de login não muda', async ({
    page,
  }) => {
    await stubLogin(page, []);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(page.locator('img')).toHaveCount(0);

    const failing = await page.context().newPage();
    await failing.setViewportSize({ width: 1024, height: 800 });
    await failing.route('**/api/public/login-media', (route) => route.abort());
    await failing.route('**/api/auth/options', (route) =>
      route.fulfill({ json: { google: false } }),
    );
    await failing.goto('/entrar');
    await expect(failing.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(failing.locator('img')).toHaveCount(0);
  });
});

interface Call {
  method: string;
  path: string;
  body: Record<string, any>;
}

const staffPanel = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: ID(n),
  mediaId: ID(60 + n),
  alt: `Banner ${n}`,
  linkUrl: null,
  startsAt: null,
  endsAt: null,
  state: 'draft',
  ...overrides,
});
const staffLogin = (n: number, state = 'draft') => ({ id: ID(30 + n), mediaId: ID(70 + n), state });

async function stubStaff(
  page: Page,
  options: {
    capabilities?: string[];
    panel?: Record<string, unknown>[];
    login?: Record<string, unknown>[];
    forbidden?: boolean;
    write?: (call: Call) => { status: number; json: unknown } | undefined;
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: {
        roles: ['student', 'admin'],
        capabilities: options.capabilities ?? ['staff.read', 'staff.manage'],
        recentAuth: false,
      },
    }),
  );
  const calls: Call[] = [];
  const state = { panel: options.panel ?? [], login: options.login ?? [] };
  await page.route('**/api/staff/banners', (route) =>
    options.forbidden
      ? route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } })
      : route.fulfill({ json: state }),
  );
  await page.route('**/api/staff/banners/**', (route) => {
    const request = route.request();
    const call: Call = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: (request.postDataJSON() ?? {}) as Record<string, any>,
    };
    calls.push(call);
    const answer = options.write?.(call);
    if (answer) return route.fulfill({ status: answer.status, json: answer.json });
    return route.fulfill({
      status: call.method === 'POST' && call.path.endsWith('/panel') ? 201 : 200,
      json: { item: state.panel[0] ?? {} },
    });
  });
  return { calls, state };
}

test.describe('banners (Staff)', () => {
  test('o item "Banners" só aparece para quem pode gerenciar (Admin)', async ({ page }) => {
    await stubStaff(page, { capabilities: ['staff.read'] });
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: 'Área da equipe' });
    await expect(nav.getByRole('link', { name: 'Ajuda' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Banners' })).toHaveCount(0);

    const admin = await page.context().newPage();
    await stubStaff(admin, {});
    await admin.goto('/staff');
    await admin
      .getByRole('navigation', { name: 'Área da equipe' })
      .getByRole('link', { name: 'Banners' })
      .click();
    await expect(admin).toHaveURL(/\/staff\/banners$/);
    await expect(admin.getByRole('heading', { level: 1, name: 'Banners' })).toBeVisible();
  });

  test('sem permissão (403) a tela avisa, sem mostrar nada', async ({ page }) => {
    await stubStaff(page, { forbidden: true });
    await page.goto('/staff/banners');
    await expect(page.getByRole('alert')).toHaveText('Só o Admin gerencia banners.');
  });

  test('lista com estado, ordem acessível e as ações chamam a API certa', async ({ page }) => {
    const { calls } = await stubStaff(page, {
      panel: [staffPanel(1), staffPanel(2, { state: 'published', linkUrl: '/cursos' })],
      login: [staffLogin(1, 'published'), staffLogin(2)],
    });
    await page.goto('/staff/banners');
    await expect(page.getByRole('article', { name: 'Painel, banner 1' })).toContainText('Rascunho');
    await expect(page.getByRole('article', { name: 'Painel, banner 2' })).toContainText(
      'Publicado',
    );
    await expect(page.getByRole('article', { name: 'Painel, banner 2' })).toContainText(
      'Link: /cursos',
    );
    await expect(page.getByRole('button', { name: 'Subir o banner 1' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Descer o banner 2' })).toBeDisabled();

    await page.getByRole('button', { name: 'Descer o banner 1' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Movido para a posição 2.' }),
    ).toBeVisible();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: `/api/staff/banners/panel/${ID(1)}/move`,
      body: { direction: 'down' },
    });

    await page.getByRole('button', { name: 'Publicar o banner 1' }).click();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: `/api/staff/banners/panel/${ID(1)}/state`,
      body: { state: 'published' },
    });
    await page.getByRole('button', { name: 'Despublicar o banner 2' }).click();
    expect(calls.at(-1)).toMatchObject({ body: { state: 'draft' } });

    await page.getByRole('button', { name: 'Excluir o banner 1' }).click();
    await page.getByRole('button', { name: 'Confirmar exclusão do banner' }).click();
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      path: `/api/staff/banners/panel/${ID(1)}/delete`,
    });

    await page.getByRole('button', { name: 'Publicar a imagem 2' }).click();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: `/api/staff/banners/login/${ID(32)}/state`,
      body: { state: 'published' },
    });
  });

  test('a 6ª imagem publicada mostra o motivo (limite de 5) e não some a lista', async ({
    page,
  }) => {
    await stubStaff(page, {
      login: [staffLogin(1, 'published'), staffLogin(2)],
      write: (call) =>
        call.path.endsWith('/state')
          ? { status: 409, json: { error: { code: 'too_many_published' } } }
          : undefined,
    });
    await page.goto('/staff/banners');
    await page.getByRole('button', { name: 'Publicar a imagem 2' }).click();
    await expect(page.getByRole('alert')).toContainText('Já há 5 imagens publicadas no login.');
    await expect(page.getByRole('article', { name: 'Login, imagem 2' })).toContainText('Rascunho');
  });

  test('criar o banner: envia a imagem, exige texto alternativo e manda o link e a janela', async ({
    page,
  }) => {
    const { calls } = await stubStaff(page, {});
    const intents: Record<string, any>[] = [];
    await page.route('**/api/media/intents', (route) => {
      const body = route.request().postDataJSON() as Record<string, any>;
      intents.push(body);
      return route.fulfill({
        status: 201,
        json: {
          id: MEDIA_ID,
          upload: {
            method: 'PUT',
            url: `https://conta-teste.r2.cloudflarestorage.com/bucket-privado/m/${MEDIA_ID}`,
            headers: { 'content-type': body.contentType },
            expiresInSeconds: 300,
          },
        },
      });
    });
    await page.route('https://conta-teste.r2.cloudflarestorage.com/**', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: '',
      }),
    );
    await page.route('**/api/media/*/confirm', (route) =>
      route.fulfill({
        json: {
          media: {
            id: MEDIA_ID,
            purpose: 'panel_banner',
            state: 'ready',
            contentType: 'image/webp',
            size: 1000,
            width: 1680,
            height: 420,
          },
        },
      }),
    );
    await page.goto('/staff/banners');
    const create = page.getByRole('button', { name: 'Criar (rascunho)' }).first();
    await expect(create).toBeDisabled();

    await page.getByLabel('Imagem (Novo banner)').setInputFiles({
      name: 'promo.png',
      mimeType: 'image/png',
      buffer: solidPng(2000, 800),
    });
    await expect(page.getByText('Imagem enviada. Salve o banner para usá-la.')).toBeVisible();
    expect(intents[0]).toMatchObject({ purpose: 'panel_banner' });
    // com imagem mas sem texto alternativo, ainda não dá para criar
    await expect(create).toBeDisabled();

    await page.getByLabel('Texto alternativo (Novo banner)').fill('Matrículas abertas');
    await page.getByLabel('Link, opcional (Novo banner)').fill('/cursos');
    await page.getByLabel('Começa em, opcional (Novo banner)').fill('2026-10-20T08:00');
    await expect(create).toBeEnabled();
    await create.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Banner criado como rascunho.' }),
    ).toBeVisible();
    const sent = calls.find((call) => call.path === '/api/staff/banners/panel')!;
    expect(sent.body).toMatchObject({
      mediaId: MEDIA_ID,
      alt: 'Matrículas abertas',
      linkUrl: '/cursos',
      endsAt: null,
    });
    expect(sent.body.startsAt).toBe(new Date('2026-10-20T08:00').toISOString());
  });

  test('link recusado pelo servidor mostra a regra em português', async ({ page }) => {
    await stubStaff(page, {
      panel: [staffPanel(1)],
      write: () => ({ status: 400, json: { error: { code: 'invalid_request' } } }),
    });
    await page.goto('/staff/banners');
    await page.getByRole('button', { name: 'Editar o banner 1' }).click();
    await page.getByLabel('Link, opcional (Editar o banner 1)').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'o link só pode ser um caminho do próprio site',
    );
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade e sem rolagem horizontal no celular (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubStaff(page, {
        panel: [staffPanel(1), staffPanel(2, { state: 'published' })],
        login: [staffLogin(1, 'published')],
      });
      await page.goto('/staff/banners');
      await expect(page.getByRole('article', { name: 'Painel, banner 1' })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
      await page.setViewportSize({ width: 375, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
});
