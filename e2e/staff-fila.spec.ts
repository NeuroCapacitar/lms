import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { StaffQueueDto } from '../src/features/staff/queue';

/**
 * Fila de ações da Staff (`/staff/fila`, M9-01) contra o build de produção, com a API simulada: itens com a idade em português, a
 * ação só quando o servidor a manda, o aviso do que não aparece para o perfil, os estados e a acessibilidade.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function queue(overrides: Partial<StaffQueueDto> = {}): StaffQueueDto {
  return {
    generatedAt: '2026-10-17T15:30:00.000Z',
    items: [
      {
        id: 'financial_review:1',
        kind: 'financial_review',
        title: 'Revisão financeira aberta',
        detail: 'amount_mismatch',
        ageSeconds: 2 * 86_400 + 30,
        action: { label: 'Resolver', screen: '/staff/financeiro' },
      },
      {
        id: 'certificate_failed:2',
        kind: 'certificate_failed',
        title: 'Certificado com falha na geração',
        detail: 'render_failed',
        ageSeconds: 5 * 3600,
        action: { label: 'Tentar de novo', screen: '/staff/certificados/emitidos' },
      },
      {
        id: 'email_problem:3',
        kind: 'email_problem',
        title: 'E-mail com problema',
        detail: 'vnext-magic-link / failed',
        ageSeconds: 20 * 60,
        action: null,
      },
    ],
    totals: { financial_review: 1, certificate_failed: 1, email_problem: 1 },
    truncated: false,
    hidden: [],
    ...overrides,
  };
}

async function open(page: Page, body: unknown, status = 200, capabilities = ['staff.read']) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({ json: { roles: ['student', 'support'], capabilities, recentAuth: false } }),
  );
  await page.route('**/api/staff/queue', (route) => route.fulfill({ status, json: body }));
  await page.goto('/staff/fila');
}

test('lista os itens com a idade em português, o detalhe e a ação só onde o servidor a mandou', async ({
  page,
}) => {
  await open(page, queue());
  await expect(page.getByRole('heading', { level: 1, name: 'Fila de ações' })).toBeVisible();
  const items = page.getByRole('list').filter({ hasText: 'Revisão financeira aberta' }).last();
  await expect(items.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByText('Há 2 dias · amount_mismatch')).toBeVisible();
  await expect(page.getByText('Há 5 h · render_failed')).toBeVisible();
  await expect(page.getByText('Há 20 min · vnext-magic-link / failed')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Resolver' })).toHaveAttribute(
    'href',
    '/staff/financeiro',
  );
  await expect(page.getByRole('link', { name: 'Tentar de novo' })).toBeVisible();
  // O item do e-mail é informativo: sem ação, sem link.
  await expect(page.getByRole('link', { name: /Ver |Moderar|Reenfileirar/ })).toHaveCount(0);
});

test('mostra o total real por tipo, com a definição escrita', async ({ page }) => {
  await open(
    page,
    queue({ totals: { financial_review: 7, certificate_failed: 1, email_problem: 1 } }),
  );
  await expect(page.getByText('Revisão financeira aberta', { exact: false }).first()).toBeVisible();
  await expect(
    page.getByText('Revisão financeira ainda não resolvida, desde que foi aberta.'),
  ).toBeVisible();
  await expect(page.getByText('7', { exact: true }).first()).toBeVisible();
});

test('quando a fila foi cortada, avisa; quando há tipos escondidos, diz de qual grupo', async ({
  page,
}) => {
  await open(
    page,
    queue({ truncated: true, hidden: ['financial_review', 'refund_failed', 'discussion_report'] }),
  );
  await expect(page.getByText(/Mostrando os 3 mais antigos/)).toBeVisible();
  await expect(
    page.getByText(
      'Itens de finanças e de moderação das discussões não aparecem para o seu perfil.',
    ),
  ).toBeVisible();
});

test('fila vazia: "Nada precisa de ação agora."', async ({ page }) => {
  await open(page, queue({ items: [], totals: { email_problem: 0 } }));
  await expect(
    page.getByRole('status').filter({ hasText: 'Nada precisa de ação agora.' }),
  ).toBeVisible();
});

test('erro 500 oferece "Tentar novamente"; 403 diz que não há acesso', async ({ page }) => {
  await open(page, { error: { code: 'internal' } }, 500);
  await expect(page.getByRole('alert')).toHaveText('Não foi possível carregar a fila agora.');
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  const other = await page.context().newPage();
  await open(other, { error: { code: 'forbidden' } }, 403);
  await expect(other.getByRole('alert')).toHaveText('Você não tem acesso a esta fila.');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`acessibilidade (WCAG 2.2 AA) da fila, tema ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, queue({ hidden: ['refund_failed'] }));
    await expect(page.getByRole('heading', { level: 2, name: 'Itens' })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
}

test('no celular: sem rolagem horizontal da página', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, queue());
  await expect(page.getByRole('heading', { level: 2, name: 'Itens' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
