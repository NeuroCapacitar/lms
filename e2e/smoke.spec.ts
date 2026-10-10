import { expect, test } from '@playwright/test';

test('abre a página inicial e mostra o serviço disponível', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Boas-vindas ao Hub NeuroCapacitar' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Serviço disponível.');
});

test('navega para /sobre pelo link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sobre' }).click();
  await expect(page).toHaveURL(/\/sobre$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sobre' })).toBeVisible();
});

test('rota profunda aberta direto no navegador recarrega a SPA sem 404', async ({ page }) => {
  const response = await page.goto('/sobre');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Sobre' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Sobre' })).toBeVisible();
});

test('a API responde JSON e /api desconhecida não devolve HTML', async ({ request }) => {
  const live = await request.get('/api/health/live');
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: 'ok', releaseId: expect.any(String) });
  const missing = await request.get('/api/nada');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
});
