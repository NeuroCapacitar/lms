import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const PROFILE = {
  displayName: 'Maria Souza',
  certificateName: null,
  certificateNameConfirmed: false,
  theme: 'system',
  autoAdvance: false,
};

async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('Minha conta (/conta)', () => {
  test('sem sessão, pede para entrar e leva ao /entrar', async ({ page }) => {
    await page.route('**/api/me/profile', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto('/conta');
    await expect(page.getByText('Entre para ver e editar o seu perfil.')).toBeVisible();
    await page.getByRole('link', { name: 'Entrar', exact: true }).last().click();
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('"Sair da conta" encerra a sessão (um POST) e volta à página inicial', async ({ page }) => {
    await page.route('**/api/me/profile', (route) => route.fulfill({ json: PROFILE }));
    const calls: string[] = [];
    await page.route('**/api/auth/sign-out', (route) => {
      calls.push(route.request().method());
      return route.fulfill({ json: { success: true } });
    });
    await page.goto('/conta');
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    expect(calls).toEqual(['POST']);
  });

  test('"Sair da conta": se o servidor falha, avisa e a pessoa continua na tela para tentar de novo', async ({
    page,
  }) => {
    await page.route('**/api/me/profile', (route) => route.fulfill({ json: PROFILE }));
    await page.route('**/api/auth/sign-out', (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto('/conta');
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Não foi possível sair agora. Tente novamente.',
    );
    await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeEnabled();
    await expect(page).toHaveURL(/\/conta$/);
  });

  test('mostra o perfil, tema padrão "Seguir o sistema" e autoavanço desligado', async ({
    page,
  }) => {
    await page.route('**/api/me/profile', (route) => route.fulfill({ json: PROFILE }));
    await page.goto('/conta');
    await expect(page.getByLabel('Nome de exibição')).toHaveValue('Maria Souza');
    await expect(page.getByLabel('Nome no certificado')).toHaveValue('');
    await expect(page.getByRole('radio', { name: 'Seguir o sistema' })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: /Avançar para a próxima aula/ }),
    ).not.toBeChecked();
  });

  test('salva só o que está no formulário, aplica o tema e confirma', async ({ page }) => {
    let patched: unknown;
    await page.route('**/api/me/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        patched = route.request().postDataJSON();
        await route.fulfill({
          json: {
            ...PROFILE,
            displayName: 'Maria S.',
            certificateName: 'Maria Souza Lima',
            theme: 'dark',
            autoAdvance: true,
          },
        });
        return;
      }
      await route.fulfill({ json: PROFILE });
    });
    await page.goto('/conta');
    await page.getByLabel('Nome de exibição').fill('Maria S.');
    await page.getByLabel('Nome no certificado').fill('Maria Souza Lima');
    await page.getByRole('radio', { name: 'Escuro' }).check();
    await page.getByRole('checkbox', { name: /Avançar para a próxima aula/ }).check();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Preferências salvas.' }),
    ).toBeVisible();
    expect(patched).toEqual({
      displayName: 'Maria S.',
      certificateName: 'Maria Souza Lima',
      theme: 'dark',
      autoAdvance: true,
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('nome vazio mostra o erro e não envia nada', async ({ page }) => {
    let patches = 0;
    await page.route('**/api/me/profile', async (route) => {
      if (route.request().method() === 'PATCH') patches += 1;
      await route.fulfill({ json: PROFILE });
    });
    await page.goto('/conta');
    await page.getByLabel('Nome de exibição').fill('');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Informe o nome que aparece para você.')).toBeVisible();
    expect(patches).toBe(0);
  });

  test('erro do servidor ao salvar mostra um aviso e permite tentar de novo', async ({ page }) => {
    await page.route('**/api/me/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
        return;
      }
      await route.fulfill({ json: PROFILE });
    });
    await page.goto('/conta');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível salvar');
    await expect(page.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  test('só com teclado: Tab até o formulário, editar o nome e salvar com Enter', async ({
    page,
  }) => {
    let patched: unknown;
    await page.route('**/api/me/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        patched = route.request().postDataJSON();
        await route.fulfill({ json: { ...PROFILE, displayName: 'Nome por teclado' } });
        return;
      }
      await route.fulfill({ json: PROFILE });
    });
    await page.goto('/conta');
    await page.getByLabel('Nome de exibição').focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Nome por teclado');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Preferências salvas.' }),
    ).toBeVisible();
    expect(patched).toMatchObject({ displayName: 'Nome por teclado' });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /conta, com sessão e sem sessão (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route('**/api/me/profile', (route) => route.fulfill({ json: PROFILE }));
      await page.goto('/conta');
      await page.getByLabel('Nome de exibição').waitFor();
      await expectNoViolations(page, `/conta com sessão (${scheme})`);
      await page.unroute('**/api/me/profile');
      await page.route('**/api/me/profile', (route) =>
        route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
      );
      await page.reload();
      await page.getByText('Entre para ver e editar o seu perfil.').waitFor();
      await expectNoViolations(page, `/conta sem sessão (${scheme})`);
    });
  }
});
