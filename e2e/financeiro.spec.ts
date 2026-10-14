import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ID = (n: number) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`;

const review = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: ID(n),
  type: 'amount_mismatch',
  state: 'open',
  reason: 'total_differs_from_snapshot',
  createdAt: '2026-10-14T12:00:00.000Z',
  orderId: ID(50 + n),
  orderStatus: 'review',
  courseTitle: 'Curso pago',
  priceCents: 19_700,
  buyerName: 'Maria Souza',
  providerPaymentId: `pay_${n}`,
  observedCents: 19_699,
  expectedCents: 19_700,
  resolution: null,
  resolvedAt: null,
  ...overrides,
});

interface Call {
  path: string;
  body: Record<string, any>;
}

async function stub(
  page: Page,
  options: {
    capabilities?: string[];
    reviews?: Record<string, unknown>[];
    forbidden?: boolean;
    answer?: (call: Call) => { status: number; json: unknown } | undefined;
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: {
        roles: ['student', 'support'],
        capabilities: options.capabilities ?? ['staff.read', 'finance.review'],
        recentAuth: false,
      },
    }),
  );
  await page.route('**/api/staff/finance/reviews?*', (route) =>
    options.forbidden
      ? route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } })
      : route.fulfill({ json: { reviews: options.reviews ?? [] } }),
  );
  const calls: Call[] = [];
  await page.route('**/api/staff/finance/reviews/*/resolve', (route) => {
    const call = {
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON() as Record<string, any>,
    };
    calls.push(call);
    const answer = options.answer?.(call);
    return route.fulfill(answer ?? { status: 200, json: { resolved: true } });
  });
  return calls;
}

test.describe('Financeiro (Staff)', () => {
  test('o item "Financeiro" só aparece com o grant finance.review', async ({ page }) => {
    await stub(page, { capabilities: ['staff.read'] });
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: 'Área da equipe' });
    await expect(nav.getByRole('link', { name: 'Ajuda' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Financeiro' })).toHaveCount(0);

    const granted = await page.context().newPage();
    await stub(granted, { reviews: [] });
    await granted.goto('/staff');
    await granted
      .getByRole('navigation', { name: 'Área da equipe' })
      .getByRole('link', { name: 'Financeiro' })
      .click();
    await expect(granted).toHaveURL(/\/staff\/financeiro$/);
    await expect(granted.getByText('Nenhuma revisão aberta.')).toBeVisible();
  });

  test('sem permissão (403) a tela avisa, sem mostrar nada', async ({ page }) => {
    await stub(page, { forbidden: true });
    await page.goto('/staff/financeiro');
    await expect(page.getByRole('alert')).toHaveText(
      'Você não tem a permissão de ver as revisões financeiras.',
    );
  });

  test('valor divergente: mostra o valor do pedido e o observado e oferece reconciliar, aprovar e NÃO dispensar', async ({
    page,
  }) => {
    await stub(page, { reviews: [review(1)] });
    await page.goto('/staff/financeiro');
    const card = page.getByRole('article', { name: 'Revisão: Valor diferente do pedido' });
    await expect(card).toContainText('Curso pago');
    await expect(card).toContainText('Maria Souza');
    await expect(card).toContainText('R$ 197,00');
    await expect(card).toContainText('R$ 196,99');
    await expect(card.getByRole('button', { name: /^Reconciliar/ })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Aprovar o valor observado/ })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Dispensar/ })).toHaveCount(0);
    // nenhum dado pessoal além do nome
    await expect(card).not.toContainText('@');
  });

  test('as ações só habilitam com o motivo (5+ caracteres) e enviam ação e motivo', async ({
    page,
  }) => {
    const calls = await stub(page, { reviews: [review(1)] });
    await page.goto('/staff/financeiro');
    const approve = page.getByRole('button', { name: /^Aprovar o valor observado/ });
    await expect(approve).toBeDisabled();
    await page.getByLabel(/^Motivo/).fill('ok');
    await expect(approve).toBeDisabled();
    await page.getByLabel(/^Motivo/).fill('Desconto de R$ 0,01 autorizado');
    await approve.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Valor aprovado: o acesso foi liberado.' }),
    ).toBeVisible();
    expect(calls).toEqual([
      {
        path: `/api/staff/finance/reviews/${ID(1)}/resolve`,
        body: { action: 'approve', reason: 'Desconto de R$ 0,01 autorizado' },
      },
    ]);
  });

  test('tipos sem pagamento podem ser dispensados; os demais tipos não aprovam', async ({
    page,
  }) => {
    await stub(page, {
      reviews: [
        review(2, {
          type: 'unknown_checkout',
          orderId: null,
          providerPaymentId: 'pay_x',
          priceCents: null,
          observedCents: null,
          orderStatus: null,
          courseTitle: null,
          buyerName: null,
        }),
        review(3, { type: 'duplicate_purchase', observedCents: null }),
        review(4, { type: 'uncertain_result', providerPaymentId: null, observedCents: null }),
      ],
    });
    await page.goto('/staff/financeiro');
    const unknown = page.getByRole('article', {
      name: 'Revisão: Pagamento sem pedido correspondente',
    });
    await expect(unknown.getByRole('button', { name: /^Dispensar/ })).toBeVisible();
    await expect(unknown.getByRole('button', { name: /^Aprovar/ })).toHaveCount(0);
    const duplicate = page.getByRole('article', { name: 'Revisão: Compra em duplicidade' });
    await expect(duplicate.getByRole('button', { name: /^Reconciliar/ })).toBeVisible();
    await expect(duplicate.getByRole('button', { name: /^(Aprovar|Dispensar)/ })).toHaveCount(0);
    // sem pagamento para reler: só dispensar
    const uncertain = page.getByRole('article', {
      name: 'Revisão: Resultado incerto ao abrir o pagamento',
    });
    await expect(uncertain.getByRole('button', { name: /^Reconciliar/ })).toHaveCount(0);
    await expect(uncertain.getByRole('button', { name: /^Dispensar/ })).toBeVisible();
  });

  test('erros do servidor aparecem em português', async ({ page }) => {
    await stub(page, {
      reviews: [review(1)],
      answer: () => ({ status: 409, json: { error: { code: 'still_divergent' } } }),
    });
    await page.goto('/staff/financeiro');
    await page.getByLabel(/^Motivo/).fill('conferindo de novo');
    await page.getByRole('button', { name: /^Reconciliar/ }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'O Asaas ainda mostra a divergência: nada foi alterado.',
    );
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade e sem rolagem horizontal no celular (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stub(page, { reviews: [review(1), review(2, { type: 'event_anomaly' })] });
      await page.goto('/staff/financeiro');
      await expect(page.getByRole('list', { name: 'Revisões abertas' })).toBeVisible();
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
