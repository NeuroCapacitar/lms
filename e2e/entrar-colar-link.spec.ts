import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * "Já recebeu o link? Cole aqui" (M8-04): o app instalado no iPhone não recebe a sessão do link aberto no Safari; a pessoa cola o link
 * e o app o confirma dentro do próprio armazenamento. Contra o build de produção, com a API simulada.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TOKEN = 'abcdEFGH1234ijklMNOP5678qrstUVWX';

async function stub(page: Page, confirmStatus = 200) {
  const calls: unknown[] = [];
  await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: false } }));
  await page.route('**/api/public/login-media', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/auth/link/confirm', (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      status: confirmStatus,
      json: confirmStatus === 200 ? { status: 'ok' } : {},
    });
  });
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
  );
  return calls;
}

/** Abre `/entrar` e espera a página ASSENTAR: a tela muda de altura quando a lista de imagens termina de carregar e um clique no meio disso cai no lugar errado. */
async function openSignIn(page: Page) {
  await page.goto('/entrar');
  await page.waitForLoadState('networkidle');
}

const linkOf = (origin: string, extra = '') => `${origin}/entrar/confirmar#token=${TOKEN}${extra}`;

test('colar o link do e-mail confirma o acesso DENTRO do app e leva à página inicial', async ({
  page,
  baseURL,
}) => {
  const calls = await stub(page);
  await openSignIn(page);
  await page.getByText('Já recebeu o link? Cole aqui').click();
  await page.getByLabel('Link de acesso').fill(`  ${linkOf(baseURL!)}\n`);
  await page.getByRole('button', { name: 'Entrar com o link' }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
  expect(calls).toEqual([{ token: TOKEN }]);
});

test('depois de pedir o link, o campo já vem aberto na tela "Verifique seu e-mail"', async ({
  page,
}) => {
  await stub(page);
  await page.route('**/api/auth/link/request', (route) =>
    route.fulfill({ json: { status: 'ok' } }),
  );
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'window.turnstile = { render: (el, o) => { setTimeout(() => o.callback("t"), 0); return "w"; }, remove: () => {} };',
    }),
  );
  await openSignIn(page);
  await page.getByLabel('E-mail').fill('pessoa@example.test');
  await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
  await expect(page.getByRole('heading', { name: 'Verifique seu e-mail' })).toBeVisible();
  await expect(page.getByLabel('Link de acesso')).toBeVisible();
});

test('link expirado ou já usado: mensagem clara e o campo continua para tentar de novo', async ({
  page,
  baseURL,
}) => {
  await stub(page, 400);
  await openSignIn(page);
  await page.getByText('Já recebeu o link? Cole aqui').click();
  await page.getByLabel('Link de acesso').fill(linkOf(baseURL!));
  await page.getByRole('button', { name: 'Entrar com o link' }).click();
  await expect(page.getByText('Este link expirou ou já foi usado.')).toBeVisible();
  await expect(page).toHaveURL(/\/entrar$/);
});

test('o que não é um link de acesso DESTE site NUNCA chega ao servidor', async ({
  page,
  baseURL,
}) => {
  const calls = await stub(page);
  await openSignIn(page);
  await page.getByText('Já recebeu o link? Cole aqui').click();
  const field = page.getByLabel('Link de acesso');
  const submit = page.getByRole('button', { name: 'Entrar com o link' });
  const cases: [string, string][] = [
    ['', 'Cole o link que chegou no seu e-mail.'],
    ['olá tudo bem', 'Isso não parece o link do e-mail.'],
    [`https://evil.example/entrar/confirmar#token=${TOKEN}`, 'Este link não é deste site.'],
    [`${baseURL}/cursos#token=${TOKEN}`, 'Este não é o link de acesso.'],
    [linkOf(baseURL!, '&purpose=reauth'), 'link de confirmação de identidade'],
    [`${baseURL}/entrar/confirmar#token=abc`, 'O link está incompleto.'],
  ];
  for (const [text, message] of cases) {
    await field.fill(text);
    await submit.click();
    await expect(page.getByText(message, { exact: false })).toBeVisible();
  }
  expect(calls).toEqual([]);
});

test('o link colado não fica na tela, no histórico nem no armazenamento depois de entrar', async ({
  page,
  baseURL,
}) => {
  await stub(page);
  await openSignIn(page);
  await page.getByText('Já recebeu o link? Cole aqui').click();
  await page.getByLabel('Link de acesso').fill(linkOf(baseURL!));
  await page.getByRole('button', { name: 'Entrar com o link' }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
  expect(page.url()).not.toContain(TOKEN);
  expect(await page.content()).not.toContain(TOKEN);
  expect(
    await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }])),
  ).not.toContain(TOKEN);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`acessibilidade (WCAG 2.2 AA) com o campo aberto e com erro, tema ${scheme}`, async ({
    page,
  }) => {
    await stub(page);
    await page.emulateMedia({ colorScheme: scheme });
    await openSignIn(page);
    await page.getByText('Já recebeu o link? Cole aqui').click();
    await page.getByRole('button', { name: 'Entrar com o link' }).click();
    await expect(page.getByText('Cole o link que chegou no seu e-mail.')).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
}
