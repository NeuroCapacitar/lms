import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TOKEN = 'token-de-teste-com-mais-de-16-caracteres';

/** O widget real busca um script externo; aqui ele é simulado e entrega um token na hora. */
async function stubTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'window.turnstile = { render: (el, o) => { setTimeout(() => o.callback("token-simulado"), 0); return "w1"; }, remove: () => {} };',
    }),
  );
}

async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('pedido de link (/entrar)', () => {
  test('pede o link, mostra a mensagem genérica e envia e-mail e captcha', async ({ page }) => {
    await stubTurnstile(page);
    let posted: unknown;
    await page.route('**/api/auth/link/request', async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({ status: 200, json: { status: 'ok' } });
    });
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('pessoa@example.com');
    await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
    await expect(page.getByRole('status')).toContainText('Se o e-mail informado puder entrar');
    expect(posted).toEqual({ email: 'pessoa@example.com', captchaToken: 'token-simulado' });
  });

  test('captcha recusado pelo servidor mostra aviso e mantém o formulário', async ({ page }) => {
    await stubTurnstile(page);
    await page.route('**/api/auth/link/request', (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'captcha_failed' } } }),
    );
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('pessoa@example.com');
    await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
    await expect(page.getByRole('alert')).toContainText('verificação de segurança');
    await expect(page.getByLabel('E-mail')).toBeVisible();
  });

  test('cota de e-mail do dia esgotada: avisa com clareza, sem prometer o link, e mantém o formulário', async ({
    page,
  }) => {
    await stubTurnstile(page);
    await page.route('**/api/auth/link/request', (route) =>
      route.fulfill({ status: 503, json: { error: { code: 'email_unavailable' } } }),
    );
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('pessoa@example.com');
    await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('limite de e-mails de hoje');
    await expect(alert).toContainText('21h (horário de Brasília)');
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByLabel('E-mail')).toBeVisible();
  });

  test('503 sem o código de cota continua sendo a falha genérica', async ({ page }) => {
    await stubTurnstile(page);
    await page.route('**/api/auth/link/request', (route) =>
      route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } }),
    );
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('pessoa@example.com');
    await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível enviar agora');
  });

  test('só com teclado: digitar o e-mail e Enter envia o pedido', async ({ page }) => {
    await stubTurnstile(page);
    await page.route('**/api/auth/link/request', (route) =>
      route.fulfill({ status: 200, json: { status: 'ok' } }),
    );
    await page.goto('/entrar');
    await page.getByLabel('E-mail').focus();
    await page.keyboard.type('pessoa@example.com');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /entrar (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubTurnstile(page);
      await page.goto('/entrar');
      await page.getByLabel('E-mail').waitFor();
      await expectNoViolations(page, `/entrar (${scheme})`);
    });
  }
});

test.describe('confirmação (/entrar/confirmar)', () => {
  test('abrir a página não consome o link: o POST só acontece no clique, e o token sai da URL', async ({
    page,
  }) => {
    const confirmRequests: Request[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/link/confirm')) confirmRequests.push(request);
    });
    await page.route('**/api/auth/link/confirm', (route) =>
      route.fulfill({ status: 200, json: { status: 'ok' } }),
    );
    await page.goto(`/entrar/confirmar#token=${TOKEN}`);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(page.url(), 'o token foi removido da barra de endereço').not.toContain('token');
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(confirmRequests, 'nenhum POST antes do clique').toHaveLength(0);

    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(confirmRequests).toHaveLength(1);
    expect(confirmRequests[0]!.postDataJSON()).toEqual({ token: TOKEN });
  });

  test('link expirado ou usado mostra o aviso e leva a um novo pedido', async ({ page }) => {
    await page.route('**/api/auth/link/confirm', (route) =>
      route.fulfill({ status: 400, json: { error: { code: 'invalid_or_expired_link' } } }),
    );
    await page.goto(`/entrar/confirmar#token=${TOKEN}`);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toContainText('expirou ou já foi usado');
    await page.getByRole('link', { name: 'Pedir um novo link' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('sem token no endereço, a página avisa e oferece um novo pedido', async ({ page }) => {
    await page.goto('/entrar/confirmar');
    await expect(page.getByRole('alert')).toContainText('incompleto');
    await expect(page.getByRole('link', { name: 'Pedir um novo link' })).toBeVisible();
  });

  test('a resposta da página não envia Referer e não é cacheável (_headers)', async ({ page }) => {
    const response = await page.goto('/entrar/confirmar');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /entrar/confirmar, pronto e com erro (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route('**/api/auth/link/confirm', (route) =>
        route.fulfill({ status: 400, json: { error: { code: 'invalid_or_expired_link' } } }),
      );
      await page.goto(`/entrar/confirmar#token=${TOKEN}`);
      await page.getByRole('button', { name: 'Entrar' }).waitFor();
      await expectNoViolations(page, `/entrar/confirmar pronto (${scheme})`);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.getByRole('alert').waitFor();
      await expectNoViolations(page, `/entrar/confirmar erro (${scheme})`);
    });
  }
});

test.describe('reautenticação (/entrar/confirmar#…&purpose=reauth)', () => {
  const URL = `/entrar/confirmar#token=${TOKEN}&purpose=reauth`;

  test('confirma a identidade pela rota de reautenticação, não pela de login, e não navega', async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/'))
        calls.push(new globalThis.URL(request.url()).pathname);
    });
    await page.route('**/api/auth/reauth/confirm', (route) =>
      route.fulfill({ status: 200, json: { status: 'ok' } }),
    );
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: 'Confirmar identidade' })).toBeVisible();
    expect(page.url(), 'o token e a finalidade saem da URL').not.toMatch(/token|purpose/);
    expect(calls, 'nada é enviado antes do clique').toHaveLength(0);

    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('status')).toContainText('Identidade confirmada');
    expect(calls).toEqual(['/api/auth/reauth/confirm']);
  });

  test('sem sessão (401) explica que o link só vale na sessão que o pediu', async ({ page }) => {
    await page.route('**/api/auth/reauth/confirm', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto(URL);
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('alert')).toContainText('mesma sessão');
    await expect(page.getByRole('link', { name: 'Pedir um novo link' })).toBeVisible();
  });

  test('link expirado ou de outra sessão mostra o aviso padrão', async ({ page }) => {
    await page.route('**/api/auth/reauth/confirm', (route) =>
      route.fulfill({ status: 400, json: { error: { code: 'invalid_or_expired_link' } } }),
    );
    await page.goto(URL);
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('alert')).toContainText('expirou ou já foi usado');
  });
});
