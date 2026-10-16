import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { mockApi, newBackend, openLesson, savedCount } from './support/offline-mock';

/**
 * Diagnóstico do aparelho (`/diagnostico`, M8-04): a tela que o roteiro do iPhone usa para PROVAR o que o app guardou. Aqui
 * contra o Chromium real: ela mostra só nomes e contagens e acompanha o aparelho (guardou, saiu, ficou vazio).
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('aparelho limpo: build, rede e "nenhum" banco e cache de usuário; copiar entrega o texto', async ({
  page,
  context,
  browserName,
}) => {
  // O WebKit do Playwright não conhece as permissões de área de transferência: lá a cópia é conferida só pela mensagem da tela.
  if (browserName !== 'webkit')
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/diagnostico');
  const report = page.getByLabel('Relatório do aparelho');
  await expect(report).toContainText('Rede: online');
  await expect(report).toContainText('Bancos IndexedDB (0):');
  await expect(report).toContainText('nenhum');
  await expect(report).toContainText(/Build: [0-9a-f]{7,}|Build: dev/);
  await page.getByRole('button', { name: 'Copiar relatório' }).click();
  await expect(page.getByText('Relatório copiado.')).toBeVisible();
  if (browserName === 'webkit') return;
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Relatório do aparelho');
  expect(copied).toContain('Bancos IndexedDB (0):');
});

test('acompanha o aparelho: depois de estudar lista o banco da conta com contagens; depois de sair, fica vazio', async ({
  page,
  context,
}) => {
  const backend = newBackend();
  await mockApi(context, backend);
  await openLesson(page, 1);
  await expect.poll(() => savedCount(page)).toBe(1);

  await page.goto('/diagnostico');
  const report = page.getByLabel('Relatório do aparelho');
  await expect(report).toContainText(/hub-offline-[0-9a-f]{32}: .*lessons=1/);
  await expect(report).toContainText('hub-offline-index');
  // Só nomes (com o hash do id) e contagens: nenhum dado da pessoa aparece.
  const text = (await report.textContent()) ?? '';
  expect(text).not.toMatch(/aluna|example\.test|Conteúdo secreto/);

  await page.goto('/conta');
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/diagnostico');
  await expect(page.getByLabel('Relatório do aparelho')).toContainText('Bancos IndexedDB (0):');
  await expect(page.getByLabel('Relatório do aparelho')).not.toContainText('hub-offline-');
});

test('o pedido de armazenamento persistente mostra o resultado, sem quebrar a tela', async ({
  page,
}) => {
  await page.goto('/diagnostico');
  await page.getByRole('button', { name: 'Pedir armazenamento persistente' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /armazenamento persistente/ }),
  ).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`acessibilidade (WCAG 2.2 AA) no tema ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/diagnostico');
    await expect(page.getByLabel('Relatório do aparelho')).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
}

test('o app instalado não tem barra de endereço: o link do rodapé leva ao diagnóstico de qualquer página', async ({
  page,
}) => {
  for (const path of ['/', '/sobre', '/cursos']) {
    await page.goto(path);
    await page.getByRole('link', { name: 'Diagnóstico do aparelho' }).click();
    await expect(page).toHaveURL(/\/diagnostico$/);
    await expect(page.getByLabel('Relatório do aparelho')).toBeVisible();
  }
});
