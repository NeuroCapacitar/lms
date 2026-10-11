import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const COURSES = [
  {
    slug: 'neuro',
    title: 'Neurociência aplicada',
    summary: 'Atenção, memória e aprendizagem na prática clínica.',
    workloadHours: 12,
    sequenceMode: 'guided',
    availability: 'open',
    offer: { kind: 'paid', priceCents: 19_700, accessMonths: 12, maxInstallments: 12 },
  },
  {
    slug: 'demo',
    title: 'Curso Demonstrativo',
    summary: 'Conteúdo sintético para conferir a plataforma.',
    workloadHours: 3,
    sequenceMode: 'guided',
    availability: 'open',
    offer: { kind: 'free', priceCents: 0, accessMonths: 3, maxInstallments: 1 },
  },
  {
    slug: 'antigo',
    title: 'Introdução antiga',
    summary: '',
    workloadHours: null,
    sequenceMode: 'free',
    availability: 'closed',
    offer: null,
  },
];

async function stubLegal(page: Page, accepted = true) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({
      json: accepted
        ? { accepted: true, documents: [] }
        : {
            accepted: false,
            documents: [
              {
                id: 'd1',
                kind: 'terms',
                version: '1',
                body: 'TEXTO PROVISÓRIO',
                effectiveFrom: '2026-01-01',
              },
            ],
          },
    }),
  );
}
async function stubCatalog(page: Page, courses: unknown[] = COURSES) {
  const calls: string[] = [];
  await stubLegal(page);
  await page.route('**/api/catalog/courses', (route) => {
    calls.push(route.request().url());
    return route.fulfill({ json: { courses } });
  });
  return calls;
}

const listed = (page: Page) =>
  page.getByRole('list', { name: 'Cursos' }).getByRole('heading', { level: 2 });

async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('estados da tela', () => {
  test('lista os cursos com resumo da oferta; encerrado não tem ação', async ({ page }) => {
    await stubCatalog(page);
    await page.goto('/cursos');
    await expect(listed(page)).toHaveText([
      'Neurociência aplicada',
      'Curso Demonstrativo',
      'Introdução antiga',
    ]);
    await expect(page.getByText('3 cursos encontrados.')).toBeVisible();
    await expect(
      page.getByText('Inscrições abertas · R$ 197,00 · acesso por 12 meses · até 12x sem juros'),
    ).toBeVisible();
    await expect(
      page.getByText('Inscrições abertas · Gratuito · acesso por 3 meses'),
    ).toBeVisible();
    await expect(page.getByText('12 h · Sequência guiada')).toBeVisible();
    const closed = page.getByRole('listitem').filter({ hasText: 'Introdução antiga' });
    await expect(closed).toContainText('Inscrições encerradas');
    await expect(closed.getByRole('button')).toHaveCount(0);
    // só o título leva à página do curso; nenhuma ação de inscrição
    await expect(closed.getByRole('link')).toHaveCount(1);
    await expect(closed.getByRole('link', { name: 'Introdução antiga' })).toHaveAttribute(
      'href',
      '/cursos/antigo',
    );
    // a inscrição é do M3-02: nenhum curso tem botão ainda
    await expect(page.getByRole('button', { name: /inscrever/i })).toHaveCount(0);
  });

  test('carregando, depois vazio', async ({ page }) => {
    await stubLegal(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/catalog/courses', async (route) => {
      await gate;
      await route.fulfill({ json: { courses: [] } });
    });
    await page.goto('/cursos');
    await expect(page.getByText('Carregando os cursos…')).toBeVisible();
    release();
    await expect(page.getByText('Ainda não há cursos publicados.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Cursos' })).toHaveCount(0);
  });

  test('erro do servidor: mensagem e "Tentar novamente" que recarrega', async ({ page }) => {
    await stubLegal(page);
    let fail = true;
    await page.route('**/api/catalog/courses', (route) =>
      fail
        ? route.fulfill({ status: 500, json: { error: { code: 'internal' } } })
        : route.fulfill({ json: { courses: COURSES } }),
    );
    await page.goto('/cursos');
    await expect(page.getByRole('alert')).toContainText(
      'Não foi possível carregar os cursos agora.',
    );
    fail = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(listed(page)).toHaveCount(3);
  });

  test('sem sessão (401): pede o login e não mostra lista nem busca', async ({ page }) => {
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.route('**/api/catalog/courses', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto('/cursos');
    await expect(page.getByRole('alert')).toContainText('Entre na sua conta para ver os cursos.');
    await expect(page.getByRole('link', { name: 'Entrar', exact: true }).last()).toBeVisible();
    await expect(page.getByRole('search')).toHaveCount(0);
  });

  test('termos não aceitos: mostra a tela de aceite e nem chama o catálogo', async ({ page }) => {
    const calls: string[] = [];
    await stubLegal(page, false);
    await page.route('**/api/catalog/courses', (route) => {
      calls.push(route.request().url());
      return route.fulfill({ status: 403, json: { error: { code: 'terms_required' } } });
    });
    await page.goto('/cursos');
    await expect(page.getByRole('heading', { name: 'Antes de continuar' })).toBeVisible();
    expect(calls).toEqual([]);
  });
});

test.describe('busca e filtro por parâmetros da URL', () => {
  test('a busca ignora acento e caixa e atualiza a URL sem empilhar histórico', async ({
    page,
  }) => {
    await stubCatalog(page);
    await page.goto('/cursos');
    await page.getByLabel('Buscar').fill('NEUROCIENCIA');
    await expect(listed(page)).toHaveText(['Neurociência aplicada']);
    await expect(page).toHaveURL(/busca=NEUROCIENCIA/);
    await expect(page.getByText('1 curso encontrado.')).toBeVisible();
    await page.getByLabel('Buscar').fill('nada disso');
    await expect(page.getByText('Nenhum curso encontrado com esses critérios.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Cursos' })).toHaveCount(0);
  });

  test('o filtro troca a lista e a URL; abrir a URL já aplica os parâmetros', async ({ page }) => {
    await stubCatalog(page);
    await page.goto('/cursos');
    await page.getByRole('radio', { name: 'Inscrições encerradas' }).check();
    await expect(listed(page)).toHaveText(['Introdução antiga']);
    await expect(page).toHaveURL(/filtro=encerrados/);
    await page.goto('/cursos?filtro=abertos&busca=demonstrativo');
    await expect(listed(page)).toHaveText(['Curso Demonstrativo']);
    await expect(page.getByLabel('Buscar')).toHaveValue('demonstrativo');
    await expect(page.getByRole('radio', { name: 'Inscrições abertas' })).toBeChecked();
  });

  test('parâmetros inválidos na URL caem no padrão em vez de quebrar a tela', async ({ page }) => {
    await stubCatalog(page);
    await page.goto('/cursos?filtro=zzz&busca=' + 'x'.repeat(200));
    await expect(listed(page)).toHaveCount(3);
    await expect(page.getByRole('radio', { name: 'Todos' })).toBeChecked();
    await expect(page.getByLabel('Buscar')).toHaveValue('');
  });

  test('o link "Cursos" da navegação leva ao catálogo', async ({ page }) => {
    await stubCatalog(page);
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Cursos' })
      .click();
    await expect(page).toHaveURL(/\/cursos$/);
    await expect(page.getByRole('heading', { name: 'Cursos', level: 1 })).toBeVisible();
  });
});

test.describe('segurança e acessibilidade', () => {
  test('XSS em título e resumo aparece como texto e não executa', async ({ page }) => {
    await stubCatalog(page, [
      {
        ...COURSES[0],
        title: '<img src=x onerror=alert(1)> Título',
        summary: '<script>alert(2)</script> resumo',
      },
    ]);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('/cursos');
    await expect(
      page.getByRole('heading', { name: '<img src=x onerror=alert(1)> Título' }),
    ).toBeVisible();
    await expect(page.getByText('<script>alert(2)</script> resumo')).toBeVisible();
    expect(await page.locator('main img, main script').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test('a busca e o filtro funcionam só pelo teclado', async ({ page }) => {
    await stubCatalog(page);
    await page.goto('/cursos');
    await page.getByLabel('Buscar').focus();
    await page.keyboard.type('demo');
    await expect(listed(page)).toHaveText(['Curso Demonstrativo']);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Todos' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Inscrições abertas' })).toBeChecked();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações: lista, vazio, erro e login (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubCatalog(page);
      await page.goto('/cursos');
      await listed(page).first().waitFor();
      await expectNoViolations(page, `lista (${scheme})`);
      await page.getByLabel('Buscar').fill('nada disso');
      await expect(page.getByText('Nenhum curso encontrado com esses critérios.')).toBeVisible();
      await expectNoViolations(page, `vazio (${scheme})`);

      await page.unrouteAll();
      await stubLegal(page);
      await page.route('**/api/catalog/courses', (route) =>
        route.fulfill({ status: 500, json: { error: { code: 'internal' } } }),
      );
      await page.goto('/cursos');
      await page.getByRole('alert').waitFor();
      await expectNoViolations(page, `erro (${scheme})`);

      await page.unrouteAll();
      await page.route('**/api/me/legal', (route) => route.fulfill({ status: 401, json: {} }));
      await page.route('**/api/catalog/courses', (route) =>
        route.fulfill({ status: 401, json: {} }),
      );
      await page.goto('/cursos');
      await page.getByRole('alert').waitFor();
      await expectNoViolations(page, `sem sessão (${scheme})`);
    });
  }

  test('no celular (375 px) não há rolagem horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stubCatalog(page);
    await page.goto('/cursos');
    await listed(page).first().waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
