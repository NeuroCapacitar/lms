import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { AuditEntryDto, AuditPageDto } from '../src/features/staff/audit';

/**
 * Auditoria (`/staff/auditoria`, M9-01) contra o build de produção, com a API simulada: tabela com cabeçalhos, "Carregar mais" por
 * cursor, filtros que vão para a URL da API, estados vazio e de erro, e acessibilidade.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const entry = (id: number, overrides: Partial<AuditEntryDto> = {}): AuditEntryDto => ({
  id: String(id),
  at: '2026-10-17T15:30:00.000Z',
  actorId: `staff-${id}`,
  action: 'role.grant',
  targetType: 'user',
  targetId: `alvo-${id}`,
  details: { role: 'support' },
  ...overrides,
});

async function stubAccess(page: Page, capabilities = ['staff.read', 'audit.view']) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({ json: { roles: ['student', 'support'], capabilities, recentAuth: false } }),
  );
}

test('mostra a tabela, os detalhes ficam recolhidos e "Sistema" aparece quando não há ator', async ({
  page,
}) => {
  await stubAccess(page);
  await page.route('**/api/staff/audit**', (route) =>
    route.fulfill({
      json: {
        items: [entry(3), entry(2, { actorId: null, details: {}, action: 'course.completed' })],
        nextCursor: null,
      } satisfies AuditPageDto,
    }),
  );
  await page.goto('/staff/auditoria');
  const table = page.getByRole('table', { name: 'Registros da auditoria' });
  await expect(table.getByRole('columnheader')).toHaveText(['Quando', 'Quem', 'Ação', 'Alvo']);
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByText('staff-3')).toBeVisible();
  await expect(table.getByText('Sistema')).toBeVisible();
  // Só a linha com detalhes tem o "Detalhes".
  await expect(table.getByText('Detalhes')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Carregar mais' })).toHaveCount(0);
});

test('"Carregar mais" usa o cursor da página anterior e junta as linhas sem repetir', async ({
  page,
}) => {
  await stubAccess(page);
  const seen: (string | null)[] = [];
  await page.route('**/api/staff/audit**', (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    seen.push(cursor);
    return route.fulfill({
      json: cursor
        ? ({ items: [entry(1)], nextCursor: null } satisfies AuditPageDto)
        : ({ items: [entry(3), entry(2)], nextCursor: '2' } satisfies AuditPageDto),
    });
  });
  await page.goto('/staff/auditoria');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Carregar mais' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(4);
  expect(seen).toEqual([null, '2']);
  await expect(page.getByRole('button', { name: 'Carregar mais' })).toHaveCount(0);
});

test('os filtros vão na consulta (vazios não) e "Limpar filtros" volta ao começo', async ({
  page,
}) => {
  await stubAccess(page);
  const queries: string[] = [];
  await page.route('**/api/staff/audit**', (route) => {
    queries.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { items: [entry(1)], nextCursor: null } });
  });
  await page.goto('/staff/auditoria');
  await page.getByLabel('Ação').fill('  finance.review.resolve ');
  await page.getByLabel('Identificador do alvo').fill('pedido-9');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect
    .poll(() => queries.at(-1))
    .toBe('?limit=25&action=finance.review.resolve&targetId=pedido-9');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect.poll(() => queries.at(-1)).toBe('?limit=25');
  await expect(page.getByLabel('Ação')).toHaveValue('');
});

test('sem registros: mensagem de vazio; erro: aviso e "Tentar novamente"; 403: sem acesso', async ({
  page,
}) => {
  await stubAccess(page);
  let mode: 'empty' | 'error' | 'forbidden' = 'empty';
  await page.route('**/api/staff/audit**', (route) =>
    mode === 'empty'
      ? route.fulfill({ json: { items: [], nextCursor: null } })
      : route.fulfill({
          status: mode === 'error' ? 500 : 403,
          json: { error: { code: mode === 'error' ? 'internal' : 'forbidden' } },
        }),
  );
  await page.goto('/staff/auditoria');
  await expect(page.getByText('Nenhum registro com esses filtros.')).toBeVisible();
  mode = 'error';
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Não foi possível carregar a auditoria agora.');
  mode = 'forbidden';
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('alert')).toHaveText('Você não tem acesso à auditoria.');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`acessibilidade (WCAG 2.2 AA) da auditoria, tema ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await stubAccess(page);
    await page.route('**/api/staff/audit**', (route) =>
      route.fulfill({ json: { items: [entry(2), entry(1)], nextCursor: '1' } }),
    );
    await page.goto('/staff/auditoria');
    await expect(page.getByRole('table')).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
}

test('no celular: sem rolagem horizontal da página (a tabela rola no próprio quadro)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubAccess(page);
  await page.route('**/api/staff/audit**', (route) =>
    route.fulfill({ json: { items: [entry(2), entry(1)], nextCursor: null } }),
  );
  await page.goto('/staff/auditoria');
  await expect(page.getByRole('table')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
