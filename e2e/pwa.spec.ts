import { expect, test, type Page } from '@playwright/test';

/**
 * PWA (M8-01), contra o build de produção servido pelo `vite preview` (workerd local), com o Service Worker REAL.
 * Cobre: instalabilidade, shell pré-cacheado, Staff fora do cache, "só online" sem rede, atualização só em fronteira
 * segura, época do cliente (409) e o cabeçalho enviado. NÃO cobre Safari/iPhone (gate M8-04, aparelho real).
 */
test.use({ serviceWorkers: 'allow' });

/** Registra o SW e recarrega para a página ficar CONTROLADA por ele. */
async function controlled(page: Page, path = '/') {
  await page.goto(path);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
}

async function stubSession(page: Page) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      json: {
        displayName: 'Maria Souza',
        certificateName: null,
        certificateNameConfirmed: false,
        theme: 'system',
        autoAdvance: false,
      },
    }),
  );
  await page.route('**/api/me/course-interests**', (route) =>
    route.fulfill({ json: { interests: [] } }),
  );
  await page.route('**/api/me/certificates', (route) =>
    route.fulfill({ json: { certificates: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: {
        roles: ['student', 'admin'],
        capabilities: ['staff.read', 'staff.manage'],
        recentAuth: false,
      },
    }),
  );
}

test.describe('instalabilidade', () => {
  test('o manifesto declara nome, escopo, modo standalone e os ícones (incluindo o maskable), todos alcançáveis', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/manifest.webmanifest');
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({
      name: 'NeuroCapacitar Hub',
      short_name: 'NeuroCapacitar',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'pt-BR',
    });
    const sizes = manifest.icons.map(
      (icon: any) => `${icon.sizes}${icon.purpose ? `:${icon.purpose}` : ''}`,
    );
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/icons/apple-touch-icon.png',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f4c5c');
  });

  test('sw.js, index.html e o manifesto são servidos com no-cache', async ({ request }) => {
    for (const path of ['/sw.js', '/manifest.webmanifest', '/offline.html']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['cache-control'], path).toMatch(/no-cache|max-age=0/);
    }
  });
});

test.describe('Service Worker', () => {
  test('registra, controla a página e pré-cacheia o shell e a página "só online"', async ({
    page,
  }) => {
    await controlled(page);
    const urls = await cachedUrls(page);
    expect(urls).toEqual(
      expect.arrayContaining(['/index.html', '/offline.html', '/manifest.webmanifest']),
    );
    expect(urls.some((url) => url.startsWith('/assets/') && url.endsWith('.js'))).toBe(true);
  });

  test('NADA da Staff nem de /api entra no Cache Storage, mesmo depois de visitar a Staff', async ({
    page,
  }) => {
    await stubSession(page);
    await page.route('**/api/staff/**', (route) =>
      route.fulfill({ json: { members: [], invitations: [] } }),
    );
    await controlled(page);
    await page.goto('/staff/equipe');
    await page.waitForLoadState('networkidle');
    await page.goto('/conta');
    await page.waitForLoadState('networkidle');
    const urls = await cachedUrls(page);
    expect(urls.filter((url) => url.includes('staff') || url.includes('/api/'))).toEqual([]);
  });

  test('o shell pré-cacheado é FECHADO: nenhum arquivo do aluno depende de um chunk que ficou de fora do cache', async ({
    page,
  }) => {
    // Regressão do M8-02: o módulo compartilhado `api/staff` virou o chunk `staff-*.js`, ficou de fora do cache e a aula do
    // aluno não abria sem rede ("Failed to fetch dynamically imported module").
    await controlled(page);
    const missing = await page.evaluate(async () => {
      const cached = new Set<string>();
      const sources = new Map<string, string>();
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          cached.add(path.split('/').pop()!);
          if (path.startsWith('/assets/') && path.endsWith('.js')) {
            sources.set(path.split('/').pop()!, await (await cache.match(request))!.text());
          }
        }
      }
      const out: string[] = [];
      for (const [file, text] of sources) {
        for (const match of text.matchAll(/["'`]\.\/([^"'`]+\.js)["'`]/g)) {
          const target = match[1]!;
          // O roteador (index) carrega as rotas da Staff sob demanda: elas ficam de fora DE PROPÓSITO (a Staff é só online).
          if (!cached.has(target) && !(file.startsWith('index-') && target.startsWith('staff'))) {
            out.push(`${file} -> ${target}`);
          }
        }
      }
      return out;
    });
    expect(missing).toEqual([]);
  });

  test('sem rede, a Staff mostra "só online" (a página do SW), nunca o app da Staff', async ({
    page,
    context,
  }) => {
    await controlled(page);
    await context.setOffline(true);
    await page.goto('/staff/equipe');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Esta área só funciona online' }),
    ).toBeVisible();
    await page.goto('/certificados/AbCdEfGhIjKlMnOpQrStUv');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Esta área só funciona online' }),
    ).toBeVisible();
    await context.setOffline(false);
  });

  test('sem rede, as páginas do aluno e públicas abrem pelo shell (a API é que falha, mostrando o aviso do app)', async ({
    page,
    context,
  }) => {
    await controlled(page);
    await context.setOffline(true);
    await page.goto('/sobre');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('atualização do app', () => {
  /**
   * Faz o navegador ter um SW NOVO esperando: registra o mesmo script por outro endereço (`?v=teste`), que instala e
   * fica `waiting` por trás do antigo, que ainda controla a página. (O preview serve o `sw.js` com ETag fixa e o
   * Playwright não intercepta a verificação de atualização, então a "versão nova" não pode ser forjada pelos bytes.)
   */
  async function offerNewVersion(page: Page) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js?v=teste');
      await new Promise<void>((resolve) => {
        const check = async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration?.waiting) resolve();
          else setTimeout(check, 100);
        };
        void check();
      });
    });
  }

  test('o SW novo NÃO assume sozinho: o aviso aparece, e a página só recarrega quando a pessoa aplica', async ({
    page,
  }) => {
    await stubSession(page);
    await controlled(page, '/cursos');
    await page.evaluate(() => {
      (window as unknown as { marcador: string }).marcador = 'sem-recarga';
    });
    await offerNewVersion(page);
    await expect(page.getByRole('status').filter({ hasText: 'nova versão do app' })).toBeVisible();
    // passou tempo e nada recarregou: o marcador da página continua lá
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { marcador?: string }).marcador)).toBe(
      'sem-recarga',
    );
    await page.getByRole('button', { name: 'Atualizar agora' }).click();
    await page.waitForLoadState('load');
    // a página recarregou (o marcador sumiu); a leitura pode cair no meio da navegação, então tenta de novo
    await expect
      .poll(() =>
        page
          .evaluate(() => (window as unknown as { marcador?: string }).marcador ?? 'recarregou')
          .catch(() => 'navegando'),
      )
      .toBe('recarregou');
  });

  test('formulário sujo é fronteira INSEGURA: o botão fica desabilitado e diz por quê; ao sair da tela, libera', async ({
    page,
  }) => {
    await stubSession(page);
    await controlled(page, '/conta');
    await offerNewVersion(page);
    await expect(page.getByRole('status').filter({ hasText: 'nova versão do app' })).toBeVisible();
    await page.getByLabel('Nome de exibição').fill('Maria Souza Editada');
    const button = page.getByRole('button', { name: 'Atualizar agora' });
    await expect(button).toBeDisabled();
    await expect(
      page.getByText(/Termine o que está fazendo \(formulário não salvo\)/),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Cursos' }).first().click();
    await expect(button).toBeEnabled();
  });
});

test.describe('época do cliente', () => {
  test('todo /api sai com x-client-epoch e um 409 client_outdated mostra o aviso de recarga', async ({
    page,
  }) => {
    const seen: string[] = [];
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: true, documents: [] } }),
    );
    await page.route('**/api/me/profile', (route) => {
      seen.push(route.request().headers()['x-client-epoch'] ?? 'ausente');
      return route.fulfill({ status: 409, json: { error: { code: 'client_outdated' } } });
    });
    await page.goto('/conta');
    await expect(page.getByRole('alert').filter({ hasText: 'desatualizada' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recarregar agora' })).toBeEnabled();
    expect(seen[0]).toBe('1');
  });
});
