import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const ADMIN = {
  roles: ['student', 'admin'],
  capabilities: ['staff.read', 'integration.credentials', 'staff.manage'],
  recentAuth: false,
};
const SUPPORT = { roles: ['student', 'support'], capabilities: ['staff.read'], recentAuth: false };

const SECRET = 'tok_live_SEGREDO_QUE_NUNCA_PODE_VOLTAR';

const connection = (overrides: Record<string, unknown> = {}) => ({
  id: '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10',
  provider: 'panda',
  label: 'Conta Panda do cliente',
  status: 'active',
  configured: true,
  keyVersion: 1,
  createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:00:00.000Z',
  ...overrides,
});

async function stub(page: Page, access: unknown) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) => route.fulfill({ json: access }));
  const state = {
    connections: [connection()] as ReturnType<typeof connection>[],
    reauthDone: false,
    calls: [] as { method: string; path: string; body: unknown }[],
  };
  const guard = (route: Route) => {
    state.calls.push({
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    if (!state.reauthDone) {
      void route.fulfill({ status: 403, json: { error: { code: 'reauth_required' } } });
      return false;
    }
    return true;
  };
  await page.route('**/api/staff/video/connections', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { connections: state.connections } });
      return;
    }
    if (!guard(route)) return;
    const body = route.request().postDataJSON() as {
      provider: string;
      label: string;
      secret?: string;
    };
    // O servidor NUNCA devolve o segredo: só "configurado" e a versão da chave.
    state.connections.push(
      connection({
        id: '9a9a9a9a-8d1b-4c63-9b1e-6a3f5d2c9e11',
        provider: body.provider,
        label: body.label,
        configured: body.secret !== undefined,
        keyVersion: body.secret === undefined ? null : 1,
      }),
    );
    await route.fulfill({ status: 201, json: { connection: state.connections.at(-1) } });
  });
  await page.route('**/api/staff/video/connections/*/secret', async (route) => {
    if (!guard(route)) return;
    await route.fulfill({ json: { connection: state.connections[0] } });
  });
  await page.route('**/api/staff/video/connections/*/disable', async (route) => {
    if (!guard(route)) return;
    state.connections[0]!.status = 'disabled';
    await route.fulfill({ json: { connection: state.connections[0] } });
  });
  await page.route('**/api/staff/video/rekey', async (route) => {
    if (!guard(route)) return;
    await route.fulfill({ json: { rekeyed: 1, alreadyCurrent: 0, failed: 0 } });
  });
  return state;
}

test.describe('Vídeo (Admin)', () => {
  test('lista as conexões mostrando só "configurado" e a versão da chave, nunca o segredo', async ({
    page,
  }) => {
    await stub(page, ADMIN);
    await page.goto('/staff/videos');
    await expect(page.getByRole('heading', { level: 1, name: 'Vídeo' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Conexões com provedores de vídeo' });
    await expect(table.getByRole('rowheader', { name: 'Conta Panda do cliente' })).toBeVisible();
    await expect(table.getByText('configurado (chave v1)')).toBeVisible();
    await expect(table.getByText('Panda Video')).toBeVisible();
    // Nenhum campo traz valor de segredo.
    const text = await page.locator('main').innerText();
    expect(text).not.toContain('tok_');
    for (const input of await page.locator('input[type="password"]').all()) {
      await expect(input).toHaveValue('');
    }
  });

  test('o item "Vídeo" só aparece para quem tem a capability, e o Suporte vê o aviso se abrir a rota', async ({
    page,
  }) => {
    await stub(page, SUPPORT);
    await page.route('**/api/staff/video/connections', (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } }),
    );
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: 'Área da equipe' });
    await expect(nav.getByRole('link', { name: 'Vídeo' })).toHaveCount(0);
    await page.goto('/staff/videos');
    await expect(page.getByRole('alert')).toHaveText(
      'Só o administrador pode gerir as conexões de vídeo.',
    );
  });

  test('o Admin vê o item no menu', async ({ page }) => {
    await stub(page, ADMIN);
    await page.goto('/staff');
    await page
      .getByRole('navigation', { name: 'Área da equipe' })
      .getByRole('link', { name: 'Vídeo' })
      .click();
    await expect(page).toHaveURL(/\/staff\/videos$/);
  });

  test('cadastrar: segredo é write-only (campo de senha), pede reautenticação e depois conclui', async ({
    page,
  }) => {
    const state = await stub(page, ADMIN);
    await page.goto('/staff/videos');
    await page.getByLabel('Provedor').selectOption('mux');
    await page.getByLabel('Nome da conta').fill('Conta Mux do cliente');
    const secret = page.getByLabel(/^Segredo da conta/);
    await expect(secret).toHaveAttribute('type', 'password');
    await expect(secret).toHaveAttribute('autocomplete', 'off');
    await secret.fill(SECRET);
    await page.getByRole('button', { name: 'Cadastrar conexão' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'confirme primeiro a sua identidade' }),
    ).toBeVisible();
    expect(state.calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/staff/video/connections',
      body: { provider: 'mux', label: 'Conta Mux do cliente', secret: SECRET },
    });

    state.reauthDone = true;
    await page.getByRole('button', { name: 'Cadastrar conexão' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Conexão cadastrada.' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'Conta Mux do cliente' })).toBeVisible();
    // Depois de salvo o formulário zera e a página não mostra o segredo em lugar nenhum.
    await expect(page.getByLabel(/^Segredo da conta/)).toHaveValue('');
    expect(await page.locator('body').innerText()).not.toContain(SECRET);
  });

  test('YouTube e Vimeo aceitam conexão sem segredo (o campo vira opcional)', async ({ page }) => {
    const state = await stub(page, ADMIN);
    state.reauthDone = true;
    await page.goto('/staff/videos');
    await page.getByLabel('Provedor').selectOption('youtube');
    await expect(page.getByLabel('Segredo da conta (opcional)')).toBeVisible();
    await page.getByLabel('Nome da conta').fill('YouTube público');
    await page.getByRole('button', { name: 'Cadastrar conexão' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Conexão cadastrada.' })).toBeVisible();
    expect(state.calls[0]!.body).toEqual({ provider: 'youtube', label: 'YouTube público' });
    await expect(page.getByRole('cell', { name: 'sem credenciais' })).toBeVisible();
  });

  test('trocar o segredo e desativar (com confirmação) usam a API certa e mantêm a tela sem o valor', async ({
    page,
  }) => {
    const state = await stub(page, ADMIN);
    state.reauthDone = true;
    await page.goto('/staff/videos');
    await page.getByRole('button', { name: /Trocar o segredo da conexão/ }).click();
    await page.getByLabel(/Novo segredo de/).fill(SECRET);
    await page.getByRole('button', { name: 'Salvar segredo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Segredo trocado.' })).toBeVisible();
    expect(state.calls[0]).toMatchObject({
      method: 'PUT',
      body: { secret: SECRET },
    });
    expect(await page.locator('body').innerText()).not.toContain(SECRET);

    await page.getByRole('button', { name: 'Desativar' }).click();
    await page.getByRole('button', { name: 'Confirmar: desativar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Conexão desativada.' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Desativada' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reativar' })).toBeVisible();
  });

  test('recifrar com a chave atual mostra o resultado', async ({ page }) => {
    const state = await stub(page, ADMIN);
    state.reauthDone = true;
    await page.goto('/staff/videos');
    await page.getByRole('button', { name: 'Recifrar com a chave atual' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Recifragem: 1 recifrado(s), 0 já na chave atual, 0 com falha.',
    );
  });

  test('cofre de chaves ausente no ambiente (503) mostra um aviso claro e não perde o formulário', async ({
    page,
  }) => {
    await stub(page, ADMIN);
    await page.route('**/api/staff/video/connections', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { connections: [] } });
        return;
      }
      await route.fulfill({
        status: 503,
        json: { error: { code: 'video_secrets_not_configured' } },
      });
    });
    await page.goto('/staff/videos');
    await page.getByLabel('Nome da conta').fill('Conta');
    await page.getByLabel(/^Segredo da conta/).fill('x');
    await page.getByRole('button', { name: 'Cadastrar conexão' }).click();
    await expect(page.getByRole('alert')).toContainText('cofre de chaves do ambiente');
    await expect(page.getByLabel('Nome da conta')).toHaveValue('Conta');
  });

  test('acessibilidade (WCAG 2.2 AA) no claro e no escuro, e sem rolagem horizontal no celular', async ({
    page,
  }) => {
    await stub(page, ADMIN);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/staff/videos');
      await expect(page.getByRole('heading', { level: 1, name: 'Vídeo' })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations, scheme).toEqual([]);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/staff/videos');
    await expect(page.getByRole('heading', { level: 1, name: 'Vídeo' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });
});
