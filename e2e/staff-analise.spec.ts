import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  LEARNING_DEFINITIONS,
  OFFER_DEFINITIONS,
  type CourseAnalyticsDto,
  type OfferAnalyticsDto,
} from '../src/features/staff/analytics';

/**
 * Análise (`/staff/analise`, M9-02) contra o build de produção, com a API simulada: texto de privacidade e de não-causalidade, números
 * com definição, escolha de curso, funil só com `finance.view`, estados vazio e de erro, acessibilidade e celular.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const COURSE_A = '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01';
const COURSE_B = '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02';

function learning(overrides: Partial<CourseAnalyticsDto> = {}): CourseAnalyticsDto {
  return {
    generatedAt: '2026-10-17T15:30:00.000Z',
    course: { id: COURSE_A, title: 'Curso A' },
    enrolled: 9,
    withAccess: 7,
    inactive: { days14: 4, days30: 2 },
    progressBands: [2, 3, 1, 1],
    requiredLessons: 4,
    lessons: [
      {
        lessonId: 'l1',
        title: 'Aula 1',
        kind: 'text',
        isOptional: false,
        completions: 6,
        video: null,
        quiz: null,
      },
      {
        lessonId: 'l4',
        title: 'Aula 4 (vídeo)',
        kind: 'video',
        isOptional: false,
        completions: 1,
        video: { started: 5, completed: 1, bands: [1, 1, 1, 2] },
        quiz: null,
      },
      {
        lessonId: 'l5',
        title: 'Aula 5 (quiz)',
        kind: 'quiz',
        isOptional: true,
        completions: 1,
        video: null,
        quiz: { attemptedPeople: 3, attempts: 6, passedPeople: 1 },
      },
    ],
    definitions: LEARNING_DEFINITIONS,
    ...overrides,
  };
}

function offers(overrides: Partial<OfferAnalyticsDto> = {}): OfferAnalyticsDto {
  return {
    generatedAt: '2026-10-17T15:30:00.000Z',
    windowDays: 90,
    offers: [
      {
        offerId: 'o1',
        offerName: 'Oferta paga',
        courseId: COURSE_A,
        courseTitle: 'Curso A',
        kind: 'paid',
        status: 'published',
        ordersCreated: 8,
        checkoutsOpened: 5,
        paid: 4,
        expired: 1,
        canceled: 1,
        pending: 1,
        refunded: 1,
      },
    ],
    interests: [
      {
        courseId: COURSE_A,
        courseTitle: 'Curso A',
        total: 5,
        active: 2,
        withdrawn: 1,
        converted: 2,
      },
    ],
    definitions: OFFER_DEFINITIONS,
    ...overrides,
  };
}

async function open(
  page: Page,
  options: { capabilities?: string[]; learning?: unknown; learningStatus?: number } = {},
) {
  const capabilities = options.capabilities ?? ['staff.read'];
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({ json: { roles: ['student', 'support'], capabilities, recentAuth: false } }),
  );
  await page.route('**/api/staff/courses', (route) =>
    route.fulfill({
      json: {
        courses: [
          { id: COURSE_A, title: 'Curso A' },
          { id: COURSE_B, title: 'Curso B' },
        ],
      },
    }),
  );
  await page.route('**/api/staff/analytics/courses/*', (route) => {
    const id = route.request().url().split('/').pop();
    return route.fulfill({
      status: options.learningStatus ?? 200,
      json:
        options.learning ??
        learning({ course: { id: id!, title: id === COURSE_B ? 'Curso B' : 'Curso A' } }),
    });
  });
  await page.route('**/api/staff/analytics/offers', (route) => route.fulfill({ json: offers() }));
  await page.goto('/staff/analise');
}

test('traz o aviso de que não é anônimo, o de não-causalidade e que não há exportação', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Análise' })).toBeVisible();
  await expect(page.getByText(/pessoas matriculadas, que podem ser identificadas/)).toBeVisible();
  await expect(page.getByText(/não são dados anônimos/)).toBeVisible();
  await expect(page.getByText(/não explica sozinho uma compra/)).toBeVisible();
  await expect(page.getByText(/Não há exportação/)).toBeVisible();
});

test('mostra matriculados, com acesso e parados há 14 e 30 dias, cada um com a definição', async ({
  page,
}) => {
  await open(page);
  const stats = page.getByRole('list').filter({ hasText: 'Matriculados' });
  await expect(stats.getByRole('listitem').filter({ hasText: 'Matriculados' })).toContainText('9');
  await expect(stats.getByRole('listitem').filter({ hasText: 'Com acesso' }).first()).toContainText(
    '7',
  );
  await expect(
    stats.getByRole('listitem').filter({ hasText: 'Sem atividade há 14 dias ou mais' }),
  ).toContainText('4');
  await expect(
    stats.getByRole('listitem').filter({ hasText: 'Sem atividade há 30 dias ou mais' }),
  ).toContainText('2');
  await expect(page.getByText(/Quem nunca teve atividade conta desde a matrícula/)).toBeVisible();
});

test('faixas de progresso e a tabela por aula (vídeo com 4 faixas, quiz com tentativas)', async ({
  page,
}) => {
  await open(page);
  const bands = page.getByRole('table', { name: 'Pessoas por faixa de progresso' });
  await expect(bands.getByRole('row')).toHaveCount(5);
  await expect(bands.getByRole('row', { name: /^de 1% a 49% 3$/ })).toBeVisible();
  const lessons = page.getByRole('table', { name: 'Números por aula' });
  await expect(lessons.getByRole('row', { name: /Aula 1/ })).toContainText('6 (67%)');
  await expect(lessons.getByRole('row', { name: /Aula 4/ })).toContainText(
    '5 começaram, 1 concluíram.',
  );
  await expect(lessons.getByRole('row', { name: /Aula 4/ })).toContainText('75% ou mais: 2');
  await expect(lessons.getByRole('row', { name: /Aula 5/ })).toContainText(
    '3 tentaram, 6 tentativas, 1 passaram.',
  );
  await expect(lessons.getByText('Opcional')).toBeVisible();
});

test('trocar o curso busca a análise do outro curso', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('combobox', { name: 'Curso' })).toBeVisible();
  const request = page.waitForRequest(`**/api/staff/analytics/courses/${COURSE_B}`);
  await page.getByRole('combobox', { name: 'Curso' }).selectOption(COURSE_B);
  await request;
});

test('o funil e os avisos só aparecem com finance.view; sem ele a tela explica', async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByText('O funil das ofertas aparece só para quem tem acesso às finanças.'),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: /Pedidos por oferta paga/ })).toHaveCount(0);

  const finance = await page.context().newPage();
  await open(finance, { capabilities: ['staff.read', 'finance.view'] });
  const funnel = finance.getByRole('table', { name: /Pedidos por oferta paga, últimos 90 dias/ });
  await expect(funnel.getByRole('row', { name: /Oferta paga/ })).toContainText('8');
  await expect(
    finance.getByText(/não indicam que um aviso|Não indicam que um aviso/i),
  ).toBeVisible();
  const interests = finance.getByRole('table', { name: 'Pedidos de aviso por curso' });
  await expect(interests.getByRole('row', { name: /Curso A/ })).toContainText('2 (40%)');
});

test('curso sem aula obrigatória: avisa em vez de faixas; sem aulas: mensagem', async ({
  page,
}) => {
  await open(page, {
    learning: learning({ progressBands: null, requiredLessons: 0, lessons: [] }),
  });
  await expect(page.getByText('Este curso ainda não tem aula obrigatória.')).toBeVisible();
  await expect(page.getByText('Este curso ainda não tem aulas.')).toBeVisible();
});

test('erro 500 oferece "Tentar novamente"; 403 diz que não há acesso', async ({ page }) => {
  await open(page, { learning: { error: { code: 'internal' } }, learningStatus: 500 });
  await expect(page.getByRole('alert')).toHaveText('Não foi possível carregar a análise agora.');
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  const other = await page.context().newPage();
  await open(other, { learning: { error: { code: 'forbidden' } }, learningStatus: 403 });
  await expect(other.getByRole('alert')).toHaveText('Você não tem acesso a esta análise.');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`acessibilidade (WCAG 2.2 AA) da análise, tema ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, { capabilities: ['staff.read', 'finance.view'] });
    await expect(page.getByRole('table', { name: 'Números por aula' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Pedidos de aviso por curso' })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
}

test('no celular: sem rolagem horizontal da página', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, { capabilities: ['staff.read', 'finance.view'] });
  await expect(page.getByRole('table', { name: 'Números por aula' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
