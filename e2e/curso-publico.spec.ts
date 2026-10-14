import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const FREE = {
  id: 'c-demo',
  slug: 'demo',
  title: 'Curso Demonstrativo',
  description: doc('Texto público sobre o curso.'),
  workloadHours: 3,
  sequenceMode: 'guided',
  availability: 'open',
  offer: { id: 'o-demo', kind: 'free', priceCents: 0, accessMonths: 3, maxInstallments: 1 },
  syllabus: ['Primeiros passos', 'Aprofundando', 'Fechamento'],
};
const PAID = {
  ...FREE,
  slug: 'pago',
  offer: { id: 'o-pago', kind: 'paid', priceCents: 19_700, accessMonths: 12, maxInstallments: 12 },
};
const CLOSED = { ...FREE, slug: 'fechado', availability: 'closed', offer: null };

/**
 * O documento `/cursos/:slug` passa pelo Worker, que consulta o banco para as meta tags. Nos testes de TELA
 * o documento é servido da raiz (a mesma SPA, sem o Worker consultar o banco); só o último bloco deste
 * arquivo usa o Worker de verdade.
 */
async function serveShell(page: Page) {
  await page.route('**/cursos/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const shell = await route.fetch({ url: new URL('/', route.request().url()).toString() });
    return route.fulfill({ response: shell });
  });
}
async function stubCourse(page: Page, course: unknown | null, status = 200) {
  await serveShell(page);
  // Sem sessão por padrão: o estado de acesso responde 401 (a página mostra o convite para entrar).
  await page.route('**/api/courses/*/access', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
  );
  await page.route('**/api/public/courses/**', (route) =>
    course === null
      ? route.fulfill({ status: 404, json: { error: { code: 'not_found' } } })
      : route.fulfill({ status, json: course }),
  );
}
async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('página pública do curso', () => {
  test('curso gratuito aberto: conteúdo, ementa só de títulos e "Entrar para se inscrever" leva ao login', async ({
    page,
  }) => {
    await stubCourse(page, FREE);
    await page.goto('/cursos/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    await expect(page.getByText('3 h · Sequência guiada')).toBeVisible();
    await expect(page.getByText('Texto público sobre o curso.')).toBeVisible();
    await expect(page.getByRole('list').getByRole('listitem')).toHaveText([
      'Primeiros passos',
      'Aprofundando',
      'Fechamento',
    ]);
    await expect(page.getByText('Gratuito · acesso por 3 meses')).toBeVisible();
    const enter = page.getByRole('link', { name: 'Entrar para se inscrever' });
    await expect(enter).toHaveAttribute('href', '/entrar?returnTo=%2Fcursos%2Fdemo');
    await enter.click();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('curso pago sem sessão: mostra o preço e convida a entrar para comprar (sem botão de compra)', async ({
    page,
  }) => {
    await stubCourse(page, PAID);
    await page.goto('/cursos/pago');
    await expect(
      page.getByText('R$ 197,00 · acesso por 12 meses · até 12x sem juros'),
    ).toBeVisible();
    const enter = page.getByRole('link', { name: 'Entrar para comprar' });
    await expect(enter).toHaveAttribute('href', '/entrar?returnTo=%2Fcursos%2Fpago');
    await expect(page.getByRole('link', { name: 'Entrar para se inscrever' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /comprar|inscrever/i })).toHaveCount(0);
  });

  test('inscrições encerradas: sem ação', async ({ page }) => {
    await stubCourse(page, CLOSED);
    await page.goto('/cursos/fechado');
    await expect(page.getByText('Inscrições encerradas')).toBeVisible();
    await expect(page.getByRole('link', { name: /inscrever/i })).toHaveCount(0);
  });

  test('curso inexistente (404): mensagem neutra com caminho de volta', async ({ page }) => {
    await stubCourse(page, null);
    await page.goto('/cursos/nao-existe');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso não encontrado' }),
    ).toBeVisible();
    await expect(page.getByText('Este curso não existe ou não está disponível.')).toBeVisible();
    await page.getByRole('link', { name: 'Ver os cursos' }).click();
    await expect(page).toHaveURL(/\/cursos$/);
  });

  test('erro do servidor: mensagem e "Tentar novamente" que recarrega', async ({ page }) => {
    let fail = true;
    await serveShell(page);
    await page.route('**/api/public/courses/**', (route) =>
      fail
        ? route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } })
        : route.fulfill({ json: FREE }),
    );
    await page.goto('/cursos/demo');
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar o curso agora.');
    fail = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
  });

  test('abre sem login: a página não chama as rotas de sessão', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (request) => calls.push(new URL(request.url()).pathname));
    await stubCourse(page, FREE);
    await page.goto('/cursos/demo');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // só a API pública e o estado de acesso (que responde 401 sem sessão); nada de /api/me
    expect(
      calls.filter(
        (path) =>
          path.startsWith('/api/') &&
          !path.startsWith('/api/public/') &&
          !/^\/api\/courses\/[^/]+\/access$/.test(path),
      ),
    ).toEqual([]);
  });

  test('XSS em título, descrição e ementa aparece como texto e não executa', async ({ page }) => {
    await stubCourse(page, {
      ...FREE,
      title: '<img src=x onerror=alert(1)> Título',
      description: doc('<script>alert(2)</script> descrição'),
      syllabus: ['<svg onload=alert(3)> Módulo'],
    });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('/cursos/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: '<img src=x onerror=alert(1)> Título' }),
    ).toBeVisible();
    await expect(page.getByText('<script>alert(2)</script> descrição')).toBeVisible();
    await expect(page.getByText('<svg onload=alert(3)> Módulo')).toBeVisible();
    expect(await page.locator('main img, main svg, main script').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test('o título do curso no catálogo leva à página do curso', async ({ page }) => {
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: true, documents: [] } }),
    );
    await page.route('**/api/catalog/courses', (route) =>
      route.fulfill({
        json: {
          courses: [
            {
              slug: 'demo',
              title: 'Curso Demonstrativo',
              summary: 'Resumo.',
              workloadHours: 3,
              sequenceMode: 'guided',
              availability: 'open',
              offer: FREE.offer,
              access: { hasAccess: false, reason: 'no_access', expiresAt: null },
            },
          ],
        },
      }),
    );
    await stubCourse(page, FREE);
    await page.goto('/cursos');
    await page.getByRole('link', { name: 'Curso Demonstrativo' }).click();
    await expect(page).toHaveURL(/\/cursos\/demo$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações: aberto gratuito, pago, encerrado e 404 (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [label, course, path] of [
        ['gratuito', FREE, '/cursos/demo'],
        ['pago', PAID, '/cursos/pago'],
        ['encerrado', CLOSED, '/cursos/fechado'],
        ['404', null, '/cursos/nao-existe'],
      ] as const) {
        await page.unrouteAll();
        await stubCourse(page, course);
        await page.goto(path);
        await page.getByRole('heading', { level: 1 }).waitFor();
        await expectNoViolations(page, `${label} (${scheme})`);
      }
    });
  }

  test('no celular (375 px) não há rolagem horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stubCourse(page, {
      ...FREE,
      title: 'Um título bem longo para conferir a quebra de linha no celular',
      syllabus: ['Um módulo com um nome também bastante longo para quebrar linha'],
    });
    await page.goto('/cursos/demo');
    await page.getByRole('heading', { level: 1 }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('meta tags servidas pelo Worker (HTMLRewriter de verdade)', () => {
  test('a resposta HTML de /cursos/:slug traz title, description, canonical, og e twitter UMA vez', async ({
    request,
  }) => {
    const response = await request.get('/cursos/curso-que-nao-existe');
    // 404 com o banco de teste migrado; 200 se o banco não responder: a meta é genérica nos dois.
    expect([200, 404]).toContain(response.status());
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    // a página que o Worker devolve mantém a CSP restrita de `public/_headers`
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers()['cache-control']).toBe('no-cache');
    for (const pattern of [
      /<title>NeuroCapacitar Hub<\/title>/g,
      /<meta name="description" content="[^"]+">/g,
      /<link rel="canonical" href="https?:\/\/[^"]+\/">/g,
      /<meta property="og:title" content="[^"]+">/g,
      /<meta property="og:image" content="https?:\/\/[^"]+\/og-default\.png">/g,
      /<meta name="twitter:card" content="summary_large_image">/g,
    ]) {
      expect(html.match(pattern)?.length, String(pattern)).toBe(1);
    }
    expect(html).not.toContain('curso-que-nao-existe');
  });

  test('a imagem de compartilhamento existe e é um PNG', async ({ request }) => {
    const response = await request.get('/og-default.png');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
  });
});

test.describe('imagens públicas do curso (M5-07)', () => {
  const image = (name: string, width: number, height: number) => ({
    src: `/midia-teste/cdn-cgi/image/width=640,quality=80,format=auto/${name}.webp`,
    fallbackSrc: `/midia-teste/${name}.webp`,
    width,
    height,
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAhBZwgAAAAABJRU5ErkJggg==',
    'base64',
  );

  test('mostra capa e banner decorativos (alt vazio) com as dimensões do master', async ({
    page,
  }) => {
    await page.route('**/midia-teste/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: png }),
    );
    await stubCourse(page, {
      ...FREE,
      cover: image('capa', 1280, 720),
      banner: image('banner', 1680, 420),
    });
    await page.goto('/cursos/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    const images = page.locator('article img');
    await expect(images).toHaveCount(2);
    await expect(images.first()).toHaveAttribute('alt', '');
    await expect(images.first()).toHaveAttribute('width', '1680');
    await expect(images.first()).toHaveAttribute('height', '420');
    await expectNoViolations(page, 'página com capa e banner');
  });

  test('a variante falha (cota do Images): cai no master estático, sem erro visível', async ({
    page,
  }) => {
    const requests: string[] = [];
    await page.route('**/midia-teste/**', (route) => {
      const url = route.request().url();
      requests.push(url);
      if (url.includes('/cdn-cgi/image/')) return route.fulfill({ status: 502, body: 'erro 9422' });
      return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    });
    await stubCourse(page, { ...FREE, cover: image('capa', 1280, 720) });
    await page.goto('/cursos/demo');
    const cover = page.locator('article img');
    await expect(cover).toHaveAttribute('src', '/midia-teste/capa.webp');
    await expect
      .poll(() => cover.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    expect(requests.some((url) => url.includes('/cdn-cgi/image/'))).toBe(true);
  });

  test('variante E master falham: a imagem some, sem ícone quebrado e sem barulho', async ({
    page,
  }) => {
    await page.route('**/midia-teste/**', (route) => route.fulfill({ status: 404, body: '' }));
    await stubCourse(page, { ...FREE, banner: image('banner', 1680, 420) });
    await page.goto('/cursos/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    await expect(page.locator('article img')).toHaveCount(0);
  });

  test('curso sem imagens (ou resposta antiga sem os campos) segue normal', async ({ page }) => {
    await stubCourse(page, FREE);
    await page.goto('/cursos/demo');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    await expect(page.locator('article img')).toHaveCount(0);
  });
});
