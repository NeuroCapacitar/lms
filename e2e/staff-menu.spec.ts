import { expect, test, type Page } from '@playwright/test';

/**
 * Menu da Staff por capacidade (M9-01): o que aparece segue `docs/spec/staff-matrix.md`. É só conveniência (o servidor protege cada
 * rota), mas um item que a API aceita e o menu esconde deixa a pessoa sem caminho até a tela.
 */
async function openStaff(page: Page, roles: string[], capabilities: string[]) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({ json: { roles, capabilities, recentAuth: false } }),
  );
  await page.goto('/staff');
  return page.getByRole('navigation', { name: 'Área da equipe' });
}

test('Suporte com certificate.reissue ou ops.queue chega à lista de emitidos, sem ver o que é só do Admin', async ({
  page,
}) => {
  const nav = await openStaff(page, ['student', 'support'], ['staff.read', 'certificate.reissue']);
  await expect(nav.getByRole('link', { name: 'Certificados emitidos' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Certificados', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Banners' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Financeiro' })).toHaveCount(0);
});

test('Suporte só com leitura básica não vê Certificados em nenhuma forma', async ({ page }) => {
  const nav = await openStaff(page, ['student', 'support'], ['staff.read']);
  await expect(nav.getByRole('link', { name: /Certificados/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Operação' })).toBeVisible();
});

test('Admin vê "Certificados" e também "Certificados emitidos"', async ({ page }) => {
  const nav = await openStaff(
    page,
    ['student', 'admin'],
    ['staff.read', 'staff.manage', 'certificate.reissue', 'ops.queue'],
  );
  await expect(nav.getByRole('link', { name: 'Certificados', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Certificados emitidos' })).toBeVisible();
});
