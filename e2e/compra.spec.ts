import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OFFER_ID = '00000000-0000-4000-8000-000000000601';
const ORDER_ID = '00000000-0000-4000-8000-000000000602';
const CHECKOUT_URL = 'https://sandbox.asaas.com/checkoutSession/show/abc';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const COURSE = {
  id: 'c-pago',
  slug: 'pago',
  title: 'Curso pago',
  summary: 'Conteúdo pago.',
  workloadHours: 6,
  sequenceMode: 'guided',
  availability: 'open',
  offer: { id: OFFER_ID, kind: 'paid', priceCents: 19_700, accessMonths: 12, maxInstallments: 12 },
  access: { hasAccess: false, reason: 'no_access', expiresAt: null },
  interested: false,
};

type Answer = { status: number; json: unknown };
const OK: Answer = {
  status: 200,
  json: { orderId: ORDER_ID, checkoutUrl: CHECKOUT_URL, expiresAt: '2026-10-14T13:00:00.000Z' },
};

async function stubCatalog(page: Page, options: { access?: unknown; answers?: Answer[] } = {}) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/catalog/courses', (route) =>
    route.fulfill({
      json: { courses: [{ ...COURSE, access: options.access ?? COURSE.access }] },
    }),
  );
  // O Checkout hospedado do Asaas é simulado: a página só precisa chegar até ele.
  await page.route('https://sandbox.asaas.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Checkout Asaas (simulado)</h1>' }),
  );
  const bodies: Record<string, any>[] = [];
  const answers = [...(options.answers ?? [OK])];
  await page.route('**/api/me/checkout', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, any>);
    const answer = answers.length > 1 ? answers.shift()! : (answers[0] ?? OK);
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return bodies;
}

test.describe('compra (M6-02)', () => {
  test('"Comprar" no catálogo pede o checkout só com offerId e attemptId e segue para o Checkout hospedado', async ({
    page,
  }) => {
    const bodies = await stubCatalog(page);
    await page.goto('/cursos');
    await expect(
      page.getByText('Inscrições abertas · R$ 197,00 · acesso por 12 meses · até 12x sem juros'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Comprar' }).click();
    await expect(page).toHaveURL(CHECKOUT_URL);
    await expect(page.getByRole('heading', { name: 'Checkout Asaas (simulado)' })).toBeVisible();
    expect(bodies).toHaveLength(1);
    // só os dois campos: preço, e-mail e callbacks nunca saem da interface
    expect(Object.keys(bodies[0]!).sort()).toEqual(['attemptId', 'offerId']);
    expect(bodies[0]!.offerId).toBe(OFFER_ID);
    expect(bodies[0]!.attemptId).toMatch(UUID);
  });

  test('o mesmo pedido continua o mesmo ao tentar de novo; depois de pedido expirado a tentativa é nova', async ({
    page,
  }) => {
    const bodies = await stubCatalog(page, {
      answers: [
        { status: 409, json: { error: { code: 'checkout_unknown' } } },
        { status: 409, json: { error: { code: 'order_expired' } } },
        OK,
      ],
    });
    await page.goto('/cursos');
    const buy = page.getByRole('button', { name: 'Comprar' });
    await buy.click();
    await expect(page.getByRole('alert')).toContainText(
      'Aguarde alguns minutos antes de tentar de novo',
    );
    await buy.click();
    await expect(page.getByRole('alert')).toContainText('O pedido anterior expirou');
    await buy.click();
    await expect(page).toHaveURL(CHECKOUT_URL);
    expect(bodies).toHaveLength(3);
    // 1ª e 2ª usam a MESMA tentativa (reaproveita a sessão); depois de "expirado" nasce outra
    expect(bodies[1]!.attemptId).toBe(bodies[0]!.attemptId);
    expect(bodies[2]!.attemptId).not.toBe(bodies[0]!.attemptId);
  });

  test('erros do servidor aparecem em português e o botão volta a funcionar', async ({ page }) => {
    await stubCatalog(page, {
      answers: [{ status: 503, json: { error: { code: 'checkout_not_configured' } } }],
    });
    await page.goto('/cursos');
    await page.getByRole('button', { name: 'Comprar' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'A compra ainda não está disponível neste ambiente.',
    );
    await expect(page.getByRole('button', { name: 'Comprar' })).toBeEnabled();
  });

  test('endereço que não é https nunca é seguido', async ({ page }) => {
    await stubCatalog(page, {
      answers: [
        {
          status: 200,
          json: { orderId: ORDER_ID, checkoutUrl: 'javascript:alert(1)', expiresAt: 'x' },
        },
      ],
    });
    await page.goto('/cursos');
    await page.getByRole('button', { name: 'Comprar' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/cursos$/);
  });

  test('quem já tem acesso vê o acesso, não o botão de compra; acesso expirado oferece "Comprar de novo"', async ({
    page,
  }) => {
    await stubCatalog(page, {
      access: { hasAccess: true, reason: 'active', expiresAt: '2027-01-01T00:00:00.000Z' },
    });
    await page.goto('/cursos');
    await expect(page.getByText('Você está inscrito')).toBeVisible();
    await expect(page.getByRole('button', { name: /comprar/i })).toHaveCount(0);

    const expired = await page.context().newPage();
    await stubCatalog(expired, {
      access: { hasAccess: false, reason: 'expired', expiresAt: '2026-01-01T00:00:00.000Z' },
    });
    await expired.goto('/cursos');
    await expect(expired.getByRole('button', { name: 'Comprar de novo' })).toBeVisible();
  });

  test('sem sessão no catálogo: convite para entrar (a API devolve 401)', async ({ page }) => {
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: true, documents: [] } }),
    );
    await page.route('**/api/catalog/courses', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto('/cursos');
    await expect(page.getByRole('button', { name: /comprar/i })).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`catálogo com "Comprar": sem violações de acessibilidade (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubCatalog(page);
      await page.goto('/cursos');
      await expect(page.getByRole('button', { name: 'Comprar' })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }
});

test.describe('retorno do checkout (M6-02)', () => {
  let apiCalls: string[];
  test.beforeEach(async ({ page }) => {
    apiCalls = [];
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: true, documents: [] } }),
    );
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/') && path !== '/api/me/legal') apiCalls.push(path);
    });
  });

  for (const [resultado, title] of [
    ['sucesso', 'Estamos confirmando o seu pagamento'],
    ['cancelado', 'Pagamento cancelado'],
    ['expirado', 'O pagamento expirou'],
  ] as const) {
    test(`resultado=${resultado}: só informa e nunca diz que o acesso foi liberado`, async ({
      page,
    }) => {
      await page.goto(`/compra/retorno?pedido=${ORDER_ID}&resultado=${resultado}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByText(/acesso (foi )?liberado\.?$/i)).toHaveCount(0);
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }

  test('resultado desconhecido cai no texto neutro de confirmação e a página não chama a API de compra', async ({
    page,
  }) => {
    await page.goto('/compra/retorno?pedido=nao-e-uuid&resultado=pago');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Estamos confirmando o seu pagamento' }),
    ).toBeVisible();
    expect(apiCalls.filter((path) => path.includes('checkout') || path.includes('order'))).toEqual(
      [],
    );
  });
});
