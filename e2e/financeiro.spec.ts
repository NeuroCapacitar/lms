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
    refunds?: Record<string, unknown>[];
    orders?: {
      orders: Record<string, unknown>[];
      summary?: Record<string, number>;
      truncated?: boolean;
    };
    ordersFail?: boolean;
    revealAnswer?: (call: Call) => { status: number; json: unknown } | undefined;
    refundAnswer?: (call: Call) => { status: number; json: unknown } | undefined;
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
  const refundCalls: Call[] = [];
  const orderQueries: string[] = [];
  const revealCalls: Call[] = [];
  await page.route(/\/api\/staff\/finance\/orders(\?.*)?$/, (route) => {
    orderQueries.push(new URL(route.request().url()).search);
    return options.ordersFail
      ? route.fulfill({ status: 500, json: { error: { code: 'internal' } } })
      : route.fulfill({
          json: {
            orders: options.orders?.orders ?? [],
            truncated: options.orders?.truncated ?? false,
            summary: options.orders?.summary ?? {
              paidCents: 0,
              paidCount: 0,
              refundedCents: 0,
              refundedCount: 0,
              pendingCents: 0,
              pendingCount: 0,
            },
          },
        });
  });
  await page.route('**/api/staff/finance/payments/*/reveal-document', (route) => {
    const call = { path: new URL(route.request().url()).pathname, body: {} };
    revealCalls.push(call);
    const answer = options.revealAnswer?.(call);
    return route.fulfill(answer ?? { json: { document: '123.456.789-09' } });
  });
  await page.route('**/api/staff/finance/refunds', (route) =>
    route.fulfill({ json: { refunds: options.refunds ?? [] } }),
  );
  await page.route('**/api/staff/finance/orders/*/refund', (route) => {
    const call = {
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON() as Record<string, any>,
    };
    refundCalls.push(call);
    const answer = options.refundAnswer?.(call);
    return route.fulfill(answer ?? { status: 201, json: { id: ID(90) } });
  });
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
  return Object.assign(calls, { refundCalls, orderQueries, revealCalls });
}

const refundItem = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: ID(60 + n),
  orderId: ID(50 + n),
  state: 'requested',
  reason: 'Desistência dentro do prazo',
  courseTitle: 'Curso pago',
  buyerName: 'Maria Souza',
  priceCents: 19_700,
  failureCode: null,
  createdAt: '2026-10-14T12:00:00.000Z',
  completedAt: null,
  ...overrides,
});

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
    await page.getByLabel(/^Motivo [(]/).fill('ok');
    await expect(approve).toBeDisabled();
    await page.getByLabel(/^Motivo [(]/).fill('Desconto de R$ 0,01 autorizado');
    await approve.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Valor aprovado: o acesso foi liberado.' }),
    ).toBeVisible();
    expect([...calls]).toEqual([
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
    await page.getByLabel(/^Motivo [(]/).fill('conferindo de novo');
    await page.getByRole('button', { name: /^Reconciliar/ }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'O Asaas ainda mostra a divergência: nada foi alterado.',
    );
  });

  test('reembolso: o corpo é SÓ o motivo (sem valor); o botão só habilita com pedido e motivo', async ({
    page,
  }) => {
    const calls = await stub(page, { reviews: [] });
    await page.goto('/staff/financeiro');
    const submit = page.getByRole('button', { name: 'Pedir reembolso integral' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Número do pedido').fill(ID(51));
    await expect(submit).toBeDisabled();
    await page.getByLabel('Motivo do reembolso').fill('Desistência dentro do prazo');
    await submit.click();
    await expect(page.getByRole('status').filter({ hasText: 'Reembolso pedido.' })).toBeVisible();
    expect(calls.refundCalls).toEqual([
      {
        path: `/api/staff/finance/orders/${ID(51)}/refund`,
        body: { reason: 'Desistência dentro do prazo' },
      },
    ]);
    await expect(page.getByLabel('Número do pedido')).toHaveValue('');
  });

  test('sem reautenticação recente o painel pede a confirmação da identidade', async ({ page }) => {
    await stub(page, {
      reviews: [],
      refundAnswer: () => ({ status: 403, json: { error: { code: 'reauth_required' } } }),
    });
    await page.goto('/staff/financeiro');
    await page.getByLabel('Número do pedido').fill(ID(51));
    await page.getByLabel('Motivo do reembolso').fill('Desistência dentro do prazo');
    await page.getByRole('button', { name: 'Pedir reembolso integral' }).click();
    await expect(
      page.getByText('Para pedir um reembolso, confirme primeiro a sua identidade.'),
    ).toBeVisible();
  });

  test('erros do reembolso em português (prazo, já em andamento, pedido não pago)', async ({
    page,
  }) => {
    for (const [status, code, text] of [
      [
        403,
        'refund_window_closed',
        'Passaram os 7 dias: só o Admin pode reembolsar depois do prazo.',
      ],
      [409, 'refund_already_active', 'Já existe um reembolso em andamento para este pedido.'],
      [409, 'order_not_refundable', 'Este pedido não pode ser reembolsado agora'],
    ] as const) {
      const fresh = await page.context().newPage();
      await stub(fresh, {
        reviews: [],
        refundAnswer: () => ({ status, json: { error: { code } } }),
      });
      await fresh.goto('/staff/financeiro');
      await fresh.getByLabel('Número do pedido').fill(ID(51));
      await fresh.getByLabel('Motivo do reembolso').fill('Desistência dentro do prazo');
      await fresh.getByRole('button', { name: 'Pedir reembolso integral' }).click();
      await expect(fresh.getByRole('alert')).toContainText(text);
    }
  });

  test('a lista de reembolsos mostra o estado e a falha, sem e-mail da pessoa', async ({
    page,
  }) => {
    await stub(page, {
      reviews: [],
      refunds: [
        refundItem(1),
        refundItem(2, { state: 'failed', failureCode: 'insufficient_balance' }),
        refundItem(3, { state: 'awaiting_external_authorization' }),
        refundItem(4, { state: 'done', completedAt: '2026-10-14T13:00:00.000Z' }),
      ],
    });
    await page.goto('/staff/financeiro');
    const list = page.getByRole('list', { name: 'Reembolsos pedidos' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list).toContainText('Pedido registrado');
    await expect(list).toContainText('Falhou');
    await expect(list).toContainText('Motivo da falha: insufficient_balance');
    await expect(list).toContainText('Aguardando aprovação no painel do Asaas');
    await expect(list).toContainText('Reembolsado');
    await expect(list).not.toContainText('@');
  });

  const orderRow = (n: number, overrides: Record<string, unknown> = {}) => ({
    orderId: ID(80 + n),
    createdAt: '2026-10-14T12:00:00.000Z',
    status: 'paid',
    courseTitle: 'Curso pago',
    offerName: 'Oferta anual',
    priceCents: 19_700,
    buyerName: 'Maria Souza',
    method: 'pix',
    paidAt: '2026-10-14T12:05:00.000Z',
    paymentCount: 1,
    payerName: 'Maria da Silva',
    payerDocumentMasked: '•••.•••.•••-09',
    revealablePaymentId: ID(70 + n),
    ...overrides,
  });
  const FINANCE_VIEW = ['staff.read', 'finance.view'];

  test('só com finance.view: o item de menu aparece e a lista mostra pagador MASCARADO e os totais separados', async ({
    page,
  }) => {
    await stub(page, {
      capabilities: FINANCE_VIEW,
      orders: {
        orders: [
          orderRow(1),
          orderRow(2, {
            status: 'pending',
            method: null,
            paidAt: null,
            paymentCount: 0,
            payerName: null,
            payerDocumentMasked: null,
            revealablePaymentId: null,
          }),
          orderRow(3, {
            payerDocumentMasked: null,
            revealablePaymentId: null,
            paymentCount: 3,
            method: 'card',
          }),
        ],
        summary: {
          paidCents: 39_400,
          paidCount: 2,
          refundedCents: 0,
          refundedCount: 0,
          pendingCents: 19_700,
          pendingCount: 1,
        },
      },
    });
    await page.goto('/staff');
    await page
      .getByRole('navigation', { name: 'Área da equipe' })
      .getByRole('link', { name: 'Financeiro' })
      .click();
    const table = page.getByRole('table', { name: 'Pedidos e pagamentos' });
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table).toContainText('•••.•••.•••-09');
    await expect(table).toContainText('CPF/CNPJ não informado');
    await expect(table).toContainText('Cartão (3x)');
    await expect(table).not.toContainText('123.456.789-09');
    const totals = page.getByLabel('Totais do filtro');
    await expect(totals).toContainText('Recebido (pedidos pagos)');
    await expect(totals).toContainText('R$ 394,00 · 2');
    await expect(totals).toContainText('Pendente (não entra no recebido)');
    await expect(totals).toContainText('R$ 197,00 · 1');
    // sem refund.execute não há botão de reembolso
    await expect(page.getByRole('button', { name: /^Reembolsar o pedido/ })).toHaveCount(0);
  });

  test('o filtro envia período e estado; lista vazia e erro têm mensagem própria', async ({
    page,
  }) => {
    const calls = await stub(page, { capabilities: FINANCE_VIEW, orders: { orders: [] } });
    await page.goto('/staff/financeiro');
    await expect(page.getByText('Nenhum pedido neste filtro.')).toBeVisible();
    await page.getByLabel('De', { exact: true }).fill('2026-10-01');
    await page.getByLabel('Até', { exact: true }).fill('2026-10-31');
    await page.getByLabel('Estado do pedido').selectOption('paid');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect
      .poll(() => calls.orderQueries.at(-1))
      .toBe('?from=2026-10-01&to=2026-10-31&status=paid');

    const broken = await page.context().newPage();
    await stub(broken, { capabilities: FINANCE_VIEW, ordersFail: true });
    await broken.goto('/staff/financeiro');
    await expect(broken.getByRole('alert')).toContainText(
      'Não foi possível carregar os pedidos agora.',
    );
  });

  test('revelar o CPF/CNPJ: pede ao servidor, mostra o número só na tela e permite ocultar; nada vai para o armazenamento do navegador', async ({
    page,
  }) => {
    const calls = await stub(page, {
      capabilities: FINANCE_VIEW,
      orders: { orders: [orderRow(1)] },
    });
    await page.goto('/staff/financeiro');
    await page.getByRole('button', { name: /^Revelar CPF\/CNPJ do pedido/ }).click();
    await expect(page.getByText('123.456.789-09')).toBeVisible();
    expect(calls.revealCalls).toEqual([
      { path: `/api/staff/finance/payments/${ID(71)}/reveal-document`, body: {} },
    ]);
    const stored = await page.evaluate(
      () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
    );
    expect(stored).not.toContain('123.456.789-09');
    await page.getByRole('button', { name: 'Ocultar' }).click();
    await expect(page.getByText('123.456.789-09')).toHaveCount(0);
    await expect(page.getByText('•••.•••.•••-09')).toBeVisible();
  });

  test('revelar sem reautenticação recente pede a confirmação da identidade; cofre ausente mostra o aviso', async ({
    page,
  }) => {
    await stub(page, {
      capabilities: FINANCE_VIEW,
      orders: { orders: [orderRow(1)] },
      revealAnswer: () => ({ status: 403, json: { error: { code: 'reauth_required' } } }),
    });
    await page.goto('/staff/financeiro');
    await page.getByRole('button', { name: /^Revelar CPF\/CNPJ do pedido/ }).click();
    await expect(
      page.getByText('Para revelar o CPF/CNPJ, confirme primeiro a sua identidade.'),
    ).toBeVisible();

    const vault = await page.context().newPage();
    await stub(vault, {
      capabilities: FINANCE_VIEW,
      orders: { orders: [orderRow(1)] },
      revealAnswer: () => ({
        status: 503,
        json: { error: { code: 'document_vault_unavailable' } },
      }),
    });
    await vault.goto('/staff/financeiro');
    await vault.getByRole('button', { name: /^Revelar CPF\/CNPJ do pedido/ }).click();
    await expect(vault.getByRole('alert')).toContainText(
      'O cofre de documentos não está disponível',
    );
  });

  test('o botão Reembolsar (só com refund.execute, só em pedido pago) leva o número do pedido ao formulário', async ({
    page,
  }) => {
    await stub(page, {
      capabilities: ['staff.read', 'finance.view', 'refund.execute'],
      orders: {
        orders: [orderRow(1), orderRow(2, { status: 'pending', revealablePaymentId: null })],
      },
    });
    await page.goto('/staff/financeiro');
    await expect(page.getByRole('button', { name: /^Reembolsar o pedido/ })).toHaveCount(1);
    await page.getByRole('button', { name: `Reembolsar o pedido ${ID(81)}` }).click();
    await expect(page.getByLabel('Número do pedido')).toHaveValue(ID(81));
  });

  test('sem finance.view a seção de pedidos não existe (e nenhuma chamada é feita)', async ({
    page,
  }) => {
    const calls = await stub(page, { capabilities: ['staff.read', 'finance.review'] });
    await page.goto('/staff/financeiro');
    await expect(page.getByRole('heading', { name: 'Reembolsos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pedidos e pagamentos' })).toHaveCount(0);
    expect(calls.orderQueries).toEqual([]);
  });

  test('tabela de pedidos: sem violações de acessibilidade e sem rolagem horizontal da PÁGINA no celular', async ({
    page,
  }) => {
    await stub(page, {
      capabilities: ['staff.read', 'finance.view', 'refund.execute'],
      orders: { orders: [orderRow(1), orderRow(2)] },
    });
    await page.goto('/staff/financeiro');
    await expect(page.getByRole('table', { name: 'Pedidos e pagamentos' })).toBeVisible();
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
