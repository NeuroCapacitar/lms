import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { PANEL_FACTS, type PanelFactId, type StaffPanelDto } from '../src/features/staff/panel';

/**
 * Painel de fatos da Staff (`/staff`, M9-01) contra o build de produção, com a API simulada: cada número aparece com a definição e o
 * período escritos; pedidos e denúncias só aparecem quando o servidor os manda; carregando, erro e vazio; acessibilidade e celular.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function panel(overrides: Partial<StaffPanelDto> = {}, only?: 'general'): StaffPanelDto {
  const ids = (Object.keys(PANEL_FACTS) as PanelFactId[]).filter(
    (id) => !only || PANEL_FACTS[id].section === only,
  );
  return {
    generatedAt: '2026-10-17T15:30:00.000Z',
    facts: ids.map((id, index) => ({
      id,
      value: 1200 + index,
      label: PANEL_FACTS[id].label,
      definition: PANEL_FACTS[id].definition,
      period: PANEL_FACTS[id].period,
    })),
    courses: [
      {
        courseId: 'c1',
        title: 'Curso Demonstrativo',
        withAccess: 12,
        expiringIn7Days: 2,
        completions: 5,
        activeInterests: 1,
      },
      {
        courseId: 'c2',
        title: 'Curso B',
        withAccess: 0,
        expiringIn7Days: 0,
        completions: 0,
        activeInterests: 0,
      },
    ],
    coursesTruncated: false,
    restricted: { finance: only === 'general', moderation: only === 'general' },
    ...overrides,
  };
}

async function open(page: Page, body: unknown, status = 200) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: { roles: ['student', 'support'], capabilities: ['staff.read'], recentAuth: false },
    }),
  );
  await page.route('**/api/staff/panel', (route) => route.fulfill({ status, json: body }));
  await page.goto('/staff');
}

test('mostra cada número com a definição e o período, e a hora da leitura', async ({ page }) => {
  await open(page, panel());
  await expect(page.getByRole('heading', { level: 2, name: 'Números do momento' })).toBeVisible();
  await expect(page.getByText(/Atualizado em/)).toBeVisible();
  const items = page
    .getByRole('list')
    .filter({ hasText: 'Inscrições com acesso' })
    .getByRole('listitem');
  await expect(items).toHaveCount(Object.keys(PANEL_FACTS).length);
  const access = items.filter({
    has: page.getByText('Inscrições com acesso', { exact: true }),
  });
  await expect(access).toContainText('1.200');
  await expect(access).toContainText('Pares pessoa × curso com direito de acesso em vigor');
  await expect(access).toContainText('Período: agora.');
  await expect(page.getByText('Período: criados nos últimos 30 dias.').first()).toBeVisible();
  // Sem avisos de restrição quando tudo veio.
  await expect(page.getByText(/aparecem só para quem/)).toHaveCount(0);
});

test('sem as capacidades, pedidos e denúncias não aparecem e a tela explica por quê', async ({
  page,
}) => {
  await open(page, panel({}, 'general'));
  await expect(page.getByText('Pedidos pagos')).toHaveCount(0);
  await expect(page.getByText('Denúncias abertas')).toHaveCount(0);
  await expect(
    page.getByText('Os números de pedidos aparecem só para quem tem acesso às finanças.'),
  ).toBeVisible();
  await expect(
    page.getByText('As denúncias abertas aparecem só para quem modera as discussões.'),
  ).toBeVisible();
  await expect(page.getByText('Inscrições com acesso', { exact: true })).toBeVisible();
});

test('a tabela por curso tem cabeçalhos, a ordem recebida e o aviso quando há mais de 50', async ({
  page,
}) => {
  await open(page, panel({ coursesTruncated: true }));
  const table = page.getByRole('table', { name: 'Números por curso' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Curso',
    'Com acesso',
    'Vencem em 7 dias',
    'Concluíram',
    'Interesses',
  ]);
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('rowheader').first()).toHaveText('Curso Demonstrativo');
  await expect(page.getByText('Mostrando os 50 primeiros cursos.')).toBeVisible();
});

test('sem cursos: mensagem de vazio', async ({ page }) => {
  await open(page, panel({ courses: [] }));
  await expect(page.getByText('Ainda não há cursos.')).toBeVisible();
});

test('erro do servidor: aviso e "Tentar novamente" busca de novo', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: { roles: ['student', 'support'], capabilities: ['staff.read'], recentAuth: false },
    }),
  );
  await page.route('**/api/staff/panel', (route) => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 500, json: { error: { code: 'internal' } } })
      : route.fulfill({ json: panel() });
  });
  await page.goto('/staff');
  await expect(page.getByRole('alert')).toHaveText('Não foi possível carregar os números agora.');
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Números do momento' })).toBeVisible();
});

test('"Atualizar" busca os números de novo', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: { roles: ['student', 'support'], capabilities: ['staff.read'], recentAuth: false },
    }),
  );
  await page.route('**/api/staff/panel', (route) => {
    calls += 1;
    return route.fulfill({ json: panel() });
  });
  await page.goto('/staff');
  await expect(page.getByRole('button', { name: 'Atualizar' })).toBeVisible();
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect.poll(() => calls).toBe(2);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`acessibilidade (WCAG 2.2 AA) do painel, tema ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, panel());
    await expect(page.getByRole('heading', { level: 2, name: 'Por curso' })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
}

test('no celular: sem rolagem horizontal da página (a tabela rola dentro do próprio quadro)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, panel());
  await expect(page.getByRole('heading', { level: 2, name: 'Por curso' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
