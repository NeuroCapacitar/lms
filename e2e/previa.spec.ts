import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const L = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const OUTLINE = {
  preview: true,
  course: { id: COURSE_ID, title: 'Curso Demonstrativo', sequenceMode: 'guided' },
  access: { hasAccess: true, reason: 'ok', expiresAt: null },
  progress: { completed: 0, total: 2, percent: 0 },
  completedAt: null,
  modules: [
    {
      id: 'm1',
      title: 'Primeiros passos',
      releasesAt: '2026-10-11T03:00:00.000Z',
      lessons: [
        {
          id: L(1),
          title: 'Boas-vindas',
          isOptional: false,
          completed: false,
          locked: null,
          releasesAt: null,
        },
        {
          id: L(2),
          title: 'Leitura extra',
          isOptional: true,
          completed: false,
          locked: null,
          releasesAt: null,
        },
      ],
    },
    {
      id: 'm2',
      title: 'Aprofundando',
      releasesAt: '2099-01-01T03:00:00.000Z',
      lessons: [
        {
          id: L(3),
          title: 'Conceito central',
          isOptional: false,
          completed: false,
          locked: null,
          releasesAt: null,
        },
      ],
    },
  ],
};
const LESSON = {
  preview: true,
  course: { id: COURSE_ID, title: 'Curso Demonstrativo' },
  lesson: {
    id: L(1),
    title: 'Boas-vindas',
    isOptional: false,
    body: doc('Texto da aula na prévia.'),
  },
  completed: false,
  previous: null,
  next: { id: L(2), title: 'Leitura extra' },
};

interface Calls {
  writes: string[];
  student: string[];
}
async function setup(page: Page) {
  const calls: Calls = { writes: [], student: [] };
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: { roles: ['student', 'support'], capabilities: ['staff.read'], recentAuth: false },
    }),
  );
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'GET' && url.pathname.startsWith('/api/')) {
      calls.writes.push(`${request.method()} ${url.pathname}`);
    }
    if (/^\/api\/(courses|lessons)\//.test(url.pathname)) calls.student.push(url.pathname);
  });
  await page.route(`**/api/staff/preview/courses/${COURSE_ID}/outline`, (route) =>
    route.fulfill({ json: OUTLINE }),
  );
  await page.route(`**/api/staff/preview/courses/${COURSE_ID}/lessons/*`, (route) =>
    route.fulfill({ json: LESSON }),
  );
  return calls;
}
async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}
const banner = (page: Page) => page.getByRole('region', { name: 'Aviso de prévia' });

test.describe('mapa na prévia', () => {
  test('faixa fixa "Prévia — nada é gravado", tudo liberado, sem acesso nem progresso, links para a prévia', async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`/staff/previa/${COURSE_ID}`);
    await expect(banner(page)).toHaveText('Prévia — nada é gravado.');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    await expect(page.getByText('Na prévia todas as aulas aparecem liberadas.')).toBeVisible();
    // as 3 aulas são links, inclusive a do módulo que só abriria em 2099
    for (const title of ['Boas-vindas', 'Leitura extra', 'Conceito central']) {
      await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: /Boas-vindas/ })).toHaveAttribute(
      'href',
      `/staff/previa/${COURSE_ID}/aulas/${L(1)}`,
    );
    await expect(page.getByRole('heading', { level: 2, name: /libera em/ })).toHaveCount(0);
    // nada de progresso, acesso nem conclusão (são do aluno)
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByText(/Progresso:/)).toHaveCount(0);
    await expect(page.getByText(/Acesso até/)).toHaveCount(0);
  });

  test('a faixa fica visível ao rolar a página (fixa no topo)', async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 800, height: 300 });
    await page.goto(`/staff/previa/${COURSE_ID}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(banner(page)).toBeInViewport();
  });

  test('aluno comum (403 da API): mensagem de área da equipe, sem faixa nem curso', async ({
    page,
  }) => {
    await setup(page);
    await page.route(`**/api/staff/preview/courses/${COURSE_ID}/outline`, (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } }),
    );
    await page.goto(`/staff/previa/${COURSE_ID}`);
    await expect(page.getByRole('alert')).toHaveText('Esta área é só da equipe.');
    await expect(page.getByRole('main').getByRole('list')).toHaveCount(0);
  });

  test('curso sem currículo publicado (404): mensagem neutra', async ({ page }) => {
    await setup(page);
    await page.route(`**/api/staff/preview/courses/${COURSE_ID}/outline`, (route) =>
      route.fulfill({ status: 404, json: { error: { code: 'not_found' } } }),
    );
    await page.goto(`/staff/previa/${COURSE_ID}`);
    await expect(page.getByRole('alert')).toHaveText(
      'Este conteúdo não existe ou não está disponível.',
    );
  });
});

test.describe('aula na prévia', () => {
  test('mostra o conteúdo com a faixa; "Concluir aula" fica DESABILITADO e nenhum pedido de escrita sai', async ({
    page,
  }) => {
    const calls = await setup(page);
    await page.goto(`/staff/previa/${COURSE_ID}/aulas/${L(1)}`);
    await expect(banner(page)).toHaveText('Prévia — nada é gravado.');
    await expect(page.getByRole('heading', { level: 1, name: 'Boas-vindas' })).toBeVisible();
    await expect(page.getByText('Texto da aula na prévia.')).toBeVisible();
    const conclude = page.getByRole('button', { name: 'Concluir aula' });
    await expect(conclude).toBeDisabled();
    await expect(conclude).toHaveAccessibleDescription(
      'Na prévia não é possível concluir aulas: nada é gravado.',
    );
    await conclude.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(calls.writes).toEqual([]);
  });

  test('anterior, próxima e voltar ao curso ficam DENTRO da prévia; nenhuma rota do aluno é chamada', async ({
    page,
  }) => {
    const calls = await setup(page);
    await page.goto(`/staff/previa/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByRole('link', { name: 'Leitura extra →' })).toHaveAttribute(
      'href',
      `/staff/previa/${COURSE_ID}/aulas/${L(2)}`,
    );
    await expect(page.getByRole('link', { name: '← Voltar ao curso' })).toHaveAttribute(
      'href',
      `/staff/previa/${COURSE_ID}`,
    );
    await page.getByRole('link', { name: '← Voltar ao curso' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/previa/${COURSE_ID}$`));
    expect(calls.student).toEqual([]);
  });

  test('XSS no título e no texto aparece como texto', async ({ page }) => {
    await setup(page);
    await page.route(`**/api/staff/preview/courses/${COURSE_ID}/lessons/*`, (route) =>
      route.fulfill({
        json: {
          ...LESSON,
          lesson: {
            ...LESSON.lesson,
            title: '<img src=x onerror=alert(1)>',
            body: doc('<script>alert(2)</script> texto'),
          },
        },
      }),
    );
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(`/staff/previa/${COURSE_ID}/aulas/${L(1)}`);
    await expect(
      page.getByRole('heading', { level: 1, name: '<img src=x onerror=alert(1)>' }),
    ).toBeVisible();
    expect(await page.locator('main img, main script').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });
});

test.describe('entrada e acessibilidade', () => {
  test('o editor do curso tem o link "Ver como pessoa inscrita" que leva à prévia', async ({
    page,
  }) => {
    await setup(page);
    await page.route(`**/api/staff/courses/${COURSE_ID}`, (route) =>
      route.fulfill({
        json: {
          id: COURSE_ID,
          slug: 'demo',
          title: 'Curso Demonstrativo',
          sequenceMode: 'guided',
          status: 'published',
          firstPublishedAt: '2026-10-11T00:00:00.000Z',
          publishedVersion: 1,
          createdAt: '2026-10-11T00:00:00.000Z',
          updatedAt: '2026-10-11T00:00:00.000Z',
          offers: [],
        },
      }),
    );
    await page.route(`**/api/staff/courses/${COURSE_ID}/draft`, (route) =>
      route.fulfill({
        json: {
          rev: 1,
          publishedVersion: 1,
          details: { displayTitle: 'Curso', description: null, workloadHours: null },
          modules: [],
        },
      }),
    );
    await page.goto(`/staff/cursos/${COURSE_ID}`);
    await page
      .getByRole('link', { name: 'Ver como pessoa inscrita (prévia do curso publicado)' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/staff/previa/${COURSE_ID}$`));
    await expect(banner(page)).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações: mapa e aula na prévia (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await setup(page);
      await page.goto(`/staff/previa/${COURSE_ID}`);
      await banner(page).waitFor();
      await expectNoViolations(page, `mapa (${scheme})`);
      await page.goto(`/staff/previa/${COURSE_ID}/aulas/${L(1)}`);
      await page.getByRole('button', { name: 'Concluir aula' }).waitFor();
      await expectNoViolations(page, `aula (${scheme})`);
    });
  }

  test('no celular (375 px) não há rolagem horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page);
    for (const path of [`/staff/previa/${COURSE_ID}`, `/staff/previa/${COURSE_ID}/aulas/${L(1)}`]) {
      await page.goto(path);
      await banner(page).waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
