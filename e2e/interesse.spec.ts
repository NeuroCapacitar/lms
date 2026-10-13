import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const course = (overrides: Record<string, unknown>) => ({
  id: 'c-fechado',
  slug: 'fechado',
  title: 'Curso em breve',
  summary: 'Ainda não abriu.',
  workloadHours: 10,
  sequenceMode: 'guided',
  availability: 'closed',
  offer: null,
  access: { hasAccess: false, reason: 'no_access', expiresAt: null },
  interested: false,
  ...overrides,
});

interface Call {
  method: string;
  path: string;
  body: Record<string, any>;
}

async function stub(
  page: Page,
  options: {
    courses?: Record<string, unknown>[];
    write?: (call: Call) => { status: number; json: unknown } | undefined;
  } = {},
) {
  const state = { interested: new Set<string>() };
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      json: {
        displayName: 'Ana',
        certificateName: null,
        certificateNameConfirmedAt: null,
        theme: 'system',
        autoAdvance: false,
      },
    }),
  );
  await page.route('**/api/catalog/courses', (route) =>
    route.fulfill({
      json: {
        courses: (options.courses ?? [course({})]).map((item) => ({
          ...item,
          interested: state.interested.has(String(item.id)),
        })),
      },
    }),
  );
  const calls: Call[] = [];
  await page.route('**/api/me/course-interests**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      return route.fulfill({
        json: {
          interests: [...state.interested].map((id) => ({
            courseId: id,
            slug: 'fechado',
            title: 'Curso em breve',
            status: 'active',
          })),
        },
      });
    }
    const call: Call = {
      method: request.method(),
      path,
      body: (request.postDataJSON() ?? {}) as Record<string, any>,
    };
    calls.push(call);
    const answer = options.write?.(call);
    if (answer) return route.fulfill({ status: answer.status, json: answer.json });
    if (path.endsWith('/withdraw')) {
      state.interested.delete(path.split('/').at(-2)!);
      return route.fulfill({ json: { status: 'withdrawn' } });
    }
    state.interested.add(String(call.body.courseId));
    return route.fulfill({ status: 201, json: { status: 'active' } });
  });
  return { calls, state };
}

test.describe('avisar quando abrir (catálogo)', () => {
  test('curso fechado oferece o aviso; pedir e retirar usam a API certa e atualizam a tela', async ({
    page,
  }) => {
    const { calls } = await stub(page);
    await page.goto('/cursos');
    await page.getByRole('button', { name: 'Avisar-me quando abrir: Curso em breve' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Pronto: avisaremos você' }),
    ).toBeVisible();
    await expect(
      page.getByText('Avisaremos você por e-mail quando as inscrições abrirem.'),
    ).toBeVisible();
    expect(calls).toEqual([
      { method: 'POST', path: '/api/me/course-interests', body: { courseId: 'c-fechado' } },
    ]);
    await page.getByRole('button', { name: 'Retirar o aviso de Curso em breve' }).click();
    await expect(
      page.getByRole('button', { name: 'Avisar-me quando abrir: Curso em breve' }),
    ).toBeVisible();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: '/api/me/course-interests/c-fechado/withdraw',
      body: {},
    });
  });

  test('curso aberto, e quem já tem acesso, não mostram o aviso', async ({ page }) => {
    await stub(page, {
      courses: [
        course({
          id: 'c-aberto',
          slug: 'aberto',
          title: 'Curso aberto',
          availability: 'open',
          offer: { id: 'o', kind: 'paid', priceCents: 9900, accessMonths: 12, maxInstallments: 1 },
        }),
        course({
          id: 'c-meu',
          slug: 'meu',
          title: 'Curso que já tenho',
          access: { hasAccess: true, reason: 'ok', expiresAt: '2027-01-01T00:00:00.000Z' },
        }),
      ],
    });
    await page.goto('/cursos');
    await expect(page.getByRole('heading', { level: 2, name: 'Curso aberto' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Avisar-me quando abrir/ })).toHaveCount(0);
  });

  test('erro do servidor vira mensagem clara e a tela segue utilizável', async ({ page }) => {
    await stub(page, {
      write: () => ({ status: 409, json: { error: { code: 'course_already_open' } } }),
    });
    await page.goto('/cursos');
    await page.getByRole('button', { name: 'Avisar-me quando abrir: Curso em breve' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'As inscrições deste curso já abriram. Atualize a página.',
    );
    await expect(
      page.getByRole('button', { name: 'Avisar-me quando abrir: Curso em breve' }),
    ).toBeEnabled();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`acessibilidade (WCAG 2.2 AA) no ${scheme === 'light' ? 'claro' : 'escuro'}, com o aviso ativo`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const { state } = await stub(page);
      state.interested.add('c-fechado');
      await page.goto('/cursos');
      await expect(page.getByText('Avisaremos você por e-mail')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }
});

test.describe('avisos na conta', () => {
  test('lista os avisos ativos e deixa retirar; sem avisos a seção não aparece', async ({
    page,
  }) => {
    const { state, calls } = await stub(page);
    await page.goto('/conta');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Avisos de cursos' })).toHaveCount(0);

    state.interested.add('c-fechado');
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Avisos de cursos' })).toBeVisible();
    await expect(page.getByText('Curso em breve', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retirar o aviso de Curso em breve' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Avisos de cursos' })).toHaveCount(0);
    expect(calls.at(-1)!.path).toBe('/api/me/course-interests/c-fechado/withdraw');
  });

  test('a seção de avisos passa na acessibilidade (WCAG 2.2 AA)', async ({ page }) => {
    const { state } = await stub(page);
    state.interested.add('c-fechado');
    await page.goto('/conta');
    await expect(page.getByRole('heading', { level: 2, name: 'Avisos de cursos' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([]);
  });
});
