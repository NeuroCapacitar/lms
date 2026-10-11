import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ADMIN_ACCESS = {
  roles: ['student', 'admin'],
  capabilities: ['staff.read', 'staff.manage', 'course.edit'],
  recentAuth: false,
};
const SUPPORT_ACCESS = {
  roles: ['student', 'support'],
  capabilities: ['staff.read'],
  recentAuth: false,
};

const MEMBERS = () => [
  {
    id: 'admin-1',
    name: 'Ana Admin',
    email: 'ana@example.com',
    roles: ['admin'],
    grants: [],
    suspended: false,
  },
  {
    id: 'sup-1',
    name: 'Beto Suporte',
    email: 'beto@example.com',
    roles: ['support'],
    grants: ['help.edit', 'audit.view'],
    suspended: false,
  },
];

async function stubBase(page: Page, access: unknown = ADMIN_ACCESS) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) => route.fulfill({ json: access }));
}

/** API da equipe com estado: convites, grants e suspensão mudam o que a tela recebe depois. */
async function stubTeam(page: Page) {
  const state = {
    members: MEMBERS(),
    invitations: [] as Record<string, unknown>[],
    reauthDone: false,
    calls: [] as { path: string; body: unknown }[],
  };
  const guard = (route: import('@playwright/test').Route) => {
    state.calls.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    if (!state.reauthDone) {
      void route.fulfill({ status: 403, json: { error: { code: 'reauth_required' } } });
      return false;
    }
    return true;
  };
  await page.route('**/api/staff/team', (route) =>
    route.fulfill({ json: { members: state.members } }),
  );
  await page.route('**/api/staff/invitations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { invitations: state.invitations } });
      return;
    }
    if (!guard(route)) return;
    const body = route.request().postDataJSON() as { email: string; grants: string[] };
    state.invitations = [
      {
        id: 'inv-1',
        email: body.email,
        status: 'pending',
        grants: body.grants,
        expiresAt: '2026-10-18T00:00:00.000Z',
        createdAt: '2026-10-11T00:00:00.000Z',
      },
    ];
    await route.fulfill({ status: 201, json: { id: 'inv-1', status: 'pending' } });
  });
  await page.route('**/api/staff/users/*/grants/revoke', async (route) => {
    if (!guard(route)) return;
    const { capability } = route.request().postDataJSON() as { capability: string };
    state.members[1]!.grants = state.members[1]!.grants.filter((g) => g !== capability);
    await route.fulfill({ json: { status: 'ok', changed: true } });
  });
  await page.route('**/api/staff/users/*/suspend', async (route) => {
    if (!guard(route)) return;
    state.members[1]!.suspended = true;
    await route.fulfill({ json: { status: 'ok', changed: true } });
  });
  await page.route('**/api/auth/reauth/request', async (route) => {
    state.reauthDone = true;
    await route.fulfill({ json: { status: 'ok' } });
  });
  return state;
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

test.describe('casca da Staff (/staff)', () => {
  test('o Admin vê Início e Equipe na barra lateral e navega até a equipe', async ({ page }) => {
    await stubBase(page);
    await stubTeam(page);
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: 'Área da equipe' });
    await expect(nav.getByRole('link', { name: 'Início' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Equipe' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gerir a equipe' })).toBeVisible();
    await nav.getByRole('link', { name: 'Equipe' }).click();
    await expect(page).toHaveURL(/\/staff\/equipe$/);
    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
    // a casca da Staff não carrega a navegação pública do aluno
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
  });

  test('o Suporte vê a casca sem o item Equipe; direto na tela, a API recusa (403) e a tela avisa', async ({
    page,
  }) => {
    await stubBase(page, SUPPORT_ACCESS);
    await page.route('**/api/staff/team', (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } }),
    );
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: 'Área da equipe' });
    await expect(nav.getByRole('link', { name: 'Início' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
    await expect(page.getByText('A gestão de pessoas é só do administrador.')).toBeVisible();
    await page.goto('/staff/equipe');
    await expect(page.getByRole('alert')).toContainText('não tem permissão para gerir a equipe');
  });

  test('sem sessão e sem papel de Staff, a área não aparece', async ({ page }) => {
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.route('**/api/me/access', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto('/staff');
    await expect(page.getByText('Entre para acessar a área da equipe.')).toBeVisible();

    await page.unroute('**/api/me/access');
    await page.unroute('**/api/me/legal');
    await stubBase(page, { roles: ['student'], capabilities: [], recentAuth: false });
    await page.goto('/staff');
    await expect(page.getByRole('alert')).toContainText('Esta área é só para a equipe.');
    await expect(page.getByRole('navigation', { name: 'Área da equipe' })).toHaveCount(0);
  });

  test('no celular a barra vira gaveta: abre pelo botão, navega e fecha com Escape', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await stubBase(page);
    await stubTeam(page);
    await page.goto('/staff');
    await expect(page.getByRole('navigation', { name: 'Área da equipe' })).toHaveCount(0);
    const open = page.getByRole('button', { name: 'Abrir o menu da equipe' });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Menu da equipe' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();

    await open.click();
    await dialog.getByRole('link', { name: 'Equipe' }).click();
    await expect(page).toHaveURL(/\/staff\/equipe$/);
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('tela Equipe (/staff/equipe)', () => {
  test('o Admin convida (com reautenticação), retira um grant e suspende, tudo pela interface', async ({
    page,
  }) => {
    await stubBase(page);
    const state = await stubTeam(page);
    await page.goto('/staff/equipe');
    await expect(page.getByText('Nenhum convite ainda.')).toBeVisible();
    await expect(page.getByText('O administrador tem todas as permissões.')).toBeVisible();

    // convidar: o servidor pede a reautenticação, a tela mostra o painel, envia o link e repete
    await page.getByLabel('E-mail da pessoa').fill('carla@example.com');
    await page
      .getByRole('group', { name: 'Permissões iniciais (opcional)' })
      .getByLabel('Ver a auditoria')
      .check();
    await page.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(page.getByRole('alert')).toContainText('confirme primeiro a sua identidade');
    await page.getByRole('button', { name: 'Enviar link de confirmação' }).click();
    await expect(page.getByRole('status')).toContainText('Enviamos um link de confirmação');
    await page.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Convite enviado.' })).toBeVisible();
    await expect(page.getByText('carla@example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('Pendente')).toBeVisible();
    expect(state.calls.filter((c) => c.path === '/api/staff/invitations').at(-1)!.body).toEqual({
      email: 'carla@example.com',
      grants: ['audit.view'],
    });

    // retirar um grant da Beto
    const betoGrants = page.getByRole('group', { name: 'Permissões de Beto Suporte' });
    await expect(betoGrants.getByLabel('Editar a central de ajuda')).toBeChecked();
    // A caixa só muda depois da resposta do servidor (a tela mostra o que o servidor confirmou).
    await betoGrants.getByLabel('Editar a central de ajuda').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Permissões de Beto Suporte atualizadas' }),
    ).toContainText('entrar de novo');
    await expect(betoGrants.getByLabel('Editar a central de ajuda')).not.toBeChecked();
    await expect(betoGrants.getByLabel('Ver a auditoria')).toBeChecked();
    expect(state.calls.at(-1)).toEqual({
      path: '/api/staff/users/sup-1/grants/revoke',
      body: { capability: 'help.edit' },
    });

    // suspender exige confirmar
    await page.getByRole('button', { name: 'Suspender Beto Suporte' }).click();
    expect(state.calls.at(-1)!.path).toBe('/api/staff/users/sup-1/grants/revoke');
    await page.getByRole('button', { name: 'Confirmar suspensão' }).click();
    await expect(page.getByText('Conta suspensa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reativar Beto Suporte' })).toBeVisible();
  });

  test('"Cancelar" na confirmação não suspende', async ({ page }) => {
    await stubBase(page);
    const state = await stubTeam(page);
    state.reauthDone = true;
    await page.goto('/staff/equipe');
    await page.getByRole('button', { name: 'Tirar Beto Suporte do Suporte' }).click();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: 'Tirar Beto Suporte do Suporte' })).toBeVisible();
    expect(state.calls).toHaveLength(0);
  });

  test('erro de carregamento mostra a mensagem e uma nova tentativa', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/staff/team', (route) => route.fulfill({ status: 500, body: '' }));
    await page.goto('/staff/equipe');
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a equipe');
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  });

  test('nenhuma violação de CSP', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await stubBase(page);
    await stubTeam(page);
    await page.goto('/staff/equipe');
    await page.getByRole('heading', { name: 'Equipe', exact: true }).waitFor();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /staff, /staff/equipe e na gaveta (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubBase(page);
      await stubTeam(page);
      await page.goto('/staff');
      await page.getByRole('heading', { name: 'Área da equipe' }).waitFor();
      await expectNoViolations(page, `/staff (${scheme})`);
      await page.goto('/staff/equipe');
      await page.getByRole('heading', { name: 'Pessoas da equipe' }).waitFor();
      await expectNoViolations(page, `/staff/equipe (${scheme})`);
      await page.setViewportSize({ width: 375, height: 800 });
      await page.getByRole('button', { name: 'Abrir o menu da equipe' }).click();
      await page.getByRole('dialog', { name: 'Menu da equipe' }).waitFor();
      await expectNoViolations(page, `gaveta (${scheme})`);
    });
  }
});
