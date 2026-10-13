import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = ['/', '/sobre', '/base-visual'];

async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
  expect(summary, `violações axe em ${context}`).toEqual([]);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`tema do sistema: ${colorScheme}`, () => {
    test.use({ colorScheme });

    for (const path of PAGES) {
      test(`axe sem violações em ${path}`, async ({ page }) => {
        await page.goto(path);
        await page.locator('main').waitFor();
        await expectNoViolations(page, `${path} (${colorScheme})`);
      });
    }
  });
}

for (const theme of ['Claro', 'Escuro']) {
  test(`axe sem violações no tema forçado ${theme}, inclusive com erro de formulário`, async ({
    page,
  }) => {
    await page.goto('/base-visual');
    await page.getByRole('button', { name: theme }).click();
    await expectNoViolations(page, `/base-visual (${theme})`);

    await page.getByLabel('E-mail').fill('sem-arroba');
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
    await expectNoViolations(page, `/base-visual com erro (${theme})`);
  });
}

test('fluxo só com teclado: pular conteúdo, tema, formulário com erro e sucesso', async ({
  page,
}) => {
  await page.goto('/base-visual');
  await page.locator('main').waitFor();

  // O primeiro Tab cai no link "Pular para o conteúdo", que só aparece com foco.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Pular para o conteúdo' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  // Navegação e alternância de tema, na ordem visual.
  for (const name of [
    'Início',
    'Cursos',
    'Ajuda',
    'Sobre',
    'Base visual',
    'Entrar',
    'Minha conta',
  ]) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sistema' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Claro' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Escuro' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Escuro' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Formulário: campo, envio inválido (erro anunciado), correção e envio válido.
  await page.keyboard.press('Tab');
  const email = page.getByLabel('E-mail');
  await expect(email).toBeFocused();
  await page.keyboard.type('sem-arroba');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Informe um e-mail válido.')).toBeVisible();
  await expect(email).toHaveAttribute('aria-invalid', 'true');

  await page.keyboard.press('Control+a');
  await page.keyboard.type('pessoa@example.com');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Link enviado (simulação).');
});

test('o foco é sempre visível: o contorno do elemento focado tem espessura e cor próprias', async ({
  page,
}) => {
  await page.goto('/base-visual');
  await page.locator('main').waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(outline.style).not.toBe('none');
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

test('a escolha de tema persiste ao recarregar e "Sistema" volta a seguir o navegador', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Escuro' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Sistema' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});

test('o tema "Sistema" segue prefers-color-scheme sem script inline', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const dark = await page.evaluate(() => getComputedStyle(document.body).color);
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await page.evaluate(() => getComputedStyle(document.body).color);
  expect(dark).not.toBe(light);
  expect(await page.locator('script:not([src])').count()).toBe(0);
});

test('tudo é servido da própria origem: fonte autohospedada, sem CDN', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect([...origins]).toEqual(['http://localhost:4173']);
  const font = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check("1rem 'Lexend Deca Variable'");
  });
  expect(font).toBe(true);
});

test('WCAG 2.2.2: nenhuma animação em andamento nas páginas', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await page.locator('main').waitFor();
    const running = await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === 'running').length,
    );
    expect(running, `animações em ${path}`).toBe(0);
  }
});
