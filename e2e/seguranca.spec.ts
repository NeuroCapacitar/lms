import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const SECURITY = {
  methods: { password: false, google: false },
  googleAvailable: true,
  canManageMethods: true,
};

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

test.describe('login: Google e senha (/entrar)', () => {
  test('o botão do Google só aparece quando o ambiente tem Google configurado', async ({
    page,
  }) => {
    await stubTurnstile(page);
    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: false } }));
    await page.goto('/entrar');
    await expect(page.getByRole('button', { name: 'Entrar com e-mail e senha' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar com Google' })).toHaveCount(0);

    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: true } }));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
  });

  test('Entrar com Google pede o endereço ao servidor e vai até ele; erro genérico na volta', async ({
    page,
  }) => {
    await stubTurnstile(page);
    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: true } }));
    await page.route('**/api/auth/google/start', (route) =>
      route.fulfill({ json: { url: '/entrar?erro=google' } }),
    );
    await page.goto('/entrar');
    await page.getByRole('button', { name: 'Entrar com Google' }).click();
    await expect(page).toHaveURL(/\/entrar\?erro=google$/);
    await expect(page.getByRole('alert')).toContainText('Não foi possível entrar com o Google');
  });

  test('senha: falha de credencial mostra a mensagem única; sucesso vai para o início', async ({
    page,
  }) => {
    await stubTurnstile(page);
    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: false } }));
    let posted: unknown;
    await page.route('**/api/auth/password/sign-in', async (route) => {
      posted = route.request().postDataJSON();
      const fail = (posted as { password: string }).password === 'errada-errada-errada';
      await route.fulfill(
        fail
          ? { status: 401, json: { error: { code: 'invalid_credentials' } } }
          : { status: 200, json: { status: 'ok' } },
      );
    });
    await page.goto('/entrar');
    await page.getByRole('button', { name: 'Entrar com e-mail e senha' }).click();
    const form = page.getByRole('form', { name: 'Entrar com e-mail e senha' });
    await form.getByLabel('E-mail').fill('pessoa@example.com');
    await form.getByLabel('Senha').fill('errada-errada-errada');
    await form.getByRole('button', { name: 'Entrar com senha' }).click();
    await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
    expect(posted).toEqual({
      email: 'pessoa@example.com',
      password: 'errada-errada-errada',
      captchaToken: 'token-simulado',
    });

    await form.getByLabel('Senha').fill('uma-senha-correta-123');
    await form.getByRole('button', { name: 'Entrar com senha' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /entrar com a senha aberta (${scheme})`, async ({ page }) => {
      await stubTurnstile(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: true } }));
      await page.goto('/entrar');
      await page.getByRole('button', { name: 'Entrar com e-mail e senha' }).click();
      await page.getByRole('form', { name: 'Entrar com e-mail e senha' }).waitFor();
      await expectNoViolations(page, `/entrar (${scheme})`);
    });
  }
});

test.describe('segurança da conta (/conta/seguranca)', () => {
  test('sem sessão pede para entrar', async ({ page }) => {
    await page.route('**/api/me/security', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto('/conta/seguranca');
    await expect(page.getByText('Entre para ver a segurança da sua conta.')).toBeVisible();
  });

  test('definir a senha pede a reautenticação, envia o link e repete a ação com sucesso', async ({
    page,
  }) => {
    let reauthDone = false;
    let methods = { ...SECURITY.methods };
    await page.route('**/api/me/security', (route) =>
      route.fulfill({ json: { ...SECURITY, methods } }),
    );
    await page.route('**/api/me/security/password', async (route) => {
      if (!reauthDone) {
        await route.fulfill({ status: 403, json: { error: { code: 'reauth_required' } } });
        return;
      }
      methods = { ...methods, password: true };
      await route.fulfill({ json: { status: 'ok' } });
    });
    await page.route('**/api/auth/reauth/request', async (route) => {
      reauthDone = true;
      await route.fulfill({ json: { status: 'ok' } });
    });

    await page.goto('/conta/seguranca');
    await expect(page.getByText('Senha: não definida')).toBeVisible();
    await page.locator('input[name="password"]').fill('uma-senha-bem-longa-123');
    await page.getByRole('button', { name: 'Definir senha' }).click();
    await expect(page.getByRole('alert')).toContainText('confirme primeiro a sua identidade');
    await page.getByRole('button', { name: 'Enviar link de confirmação' }).click();
    await expect(page.getByRole('status')).toContainText('Enviamos um link de confirmação');

    await page.getByRole('button', { name: 'Definir senha' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Senha definida.' })).toBeVisible();
    await expect(page.getByText('Senha: definida')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remover senha' })).toBeVisible();
  });

  test('ligar o Google pede o endereço ao servidor e segue para ele', async ({ page }) => {
    await page.route('**/api/me/security', (route) => route.fulfill({ json: SECURITY }));
    await page.route('**/api/me/security/google/link', (route) =>
      route.fulfill({ json: { url: '/conta/seguranca?erro=google' } }),
    );
    await page.goto('/conta/seguranca');
    await page.getByRole('button', { name: 'Ligar conta Google' }).click();
    await expect(page).toHaveURL(/\/conta\/seguranca\?erro=google$/);
    await expect(page.getByRole('alert')).toContainText('Não foi possível ligar o Google');
  });

  test('a equipe não vê as ações: só link de acesso', async ({ page }) => {
    await page.route('**/api/me/security', (route) =>
      route.fulfill({ json: { ...SECURITY, canManageMethods: false } }),
    );
    await page.goto('/conta/seguranca');
    await expect(page.getByText('A equipe entra somente por link de acesso')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Definir senha' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ligar conta Google' })).toHaveCount(0);
  });

  test('Google indisponível no ambiente: a seção some', async ({ page }) => {
    await page.route('**/api/me/security', (route) =>
      route.fulfill({ json: { ...SECURITY, googleAvailable: false } }),
    );
    await page.goto('/conta/seguranca');
    await expect(page.getByText('Google: indisponível')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Google' })).toHaveCount(0);
  });

  test('nenhuma violação de CSP em /conta/seguranca e /entrar', async ({ page }) => {
    await stubTurnstile(page);
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await page.route('**/api/me/security', (route) => route.fulfill({ json: SECURITY }));
    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: true } }));
    for (const path of ['/conta/seguranca', '/entrar']) {
      await page.goto(path);
      await page.locator('main').waitFor();
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
        path,
      ).toEqual([]);
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /conta/seguranca, com e sem aviso (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route('**/api/me/security', (route) => route.fulfill({ json: SECURITY }));
      await page.route('**/api/me/security/password', (route) =>
        route.fulfill({ status: 403, json: { error: { code: 'reauth_required' } } }),
      );
      await page.goto('/conta/seguranca?erro=google');
      await page.getByRole('button', { name: 'Definir senha' }).waitFor();
      await expectNoViolations(page, `/conta/seguranca (${scheme})`);
      await page.locator('input[name="password"]').fill('uma-senha-bem-longa-123');
      await page.getByRole('button', { name: 'Definir senha' }).click();
      await page.getByRole('button', { name: 'Enviar link de confirmação' }).waitFor();
      await expectNoViolations(page, `/conta/seguranca com reautenticação (${scheme})`);
    });
  }
});
