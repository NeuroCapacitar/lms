import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TOKEN = 'convite-de-teste-com-mais-de-16-caracteres';
const URL = `/convite#token=${TOKEN}`;
const ACCEPT = '**/api/staff/invitations/accept';

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

test.describe('aceite do convite de Staff (/convite)', () => {
  test('abrir a página não consome o convite: o POST só acontece no clique, e o token sai da URL', async ({
    page,
  }) => {
    const posts: unknown[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/staff/invitations/accept')) {
        posts.push(request.postDataJSON());
      }
    });
    await page.route(ACCEPT, (route) => route.fulfill({ status: 200, json: { status: 'ok' } }));
    await page.goto(URL);
    await expect(page.getByRole('button', { name: 'Aceitar convite' })).toBeVisible();
    expect(page.url(), 'o token foi removido da barra de endereço').not.toContain('token');
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(posts, 'nenhum POST antes do clique').toHaveLength(0);

    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page.getByRole('status')).toContainText('Convite aceito');
    expect(posts).toEqual([{ token: TOKEN }]);
    await expect(page.getByRole('main').getByRole('link', { name: 'Entrar' })).toBeVisible();
  });

  test('sem sessão (401) explica que é preciso entrar com o e-mail convidado', async ({ page }) => {
    await page.route(ACCEPT, (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto(URL);
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page.getByRole('alert')).toContainText('entre primeiro com o mesmo e-mail');
    await expect(page.getByRole('main').getByRole('link', { name: 'Entrar' })).toBeVisible();
  });

  test('convite inválido, expirado ou de outro e-mail mostra um aviso único', async ({ page }) => {
    await page.route(ACCEPT, (route) =>
      route.fulfill({
        status: 400,
        json: { error: { code: 'invalid_or_expired_invitation' } },
      }),
    );
    await page.goto(URL);
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page.getByRole('alert')).toContainText('expirou, foi revogado');
  });

  test('conta suspensa e e-mail não confirmado têm avisos próprios', async ({ page }) => {
    await page.route(ACCEPT, (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'email_not_verified' } } }),
    );
    await page.goto(URL);
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page.getByRole('alert')).toContainText('ainda não foi confirmado');
  });

  test('sem token no endereço, a página avisa', async ({ page }) => {
    await page.goto('/convite');
    await expect(page.getByRole('alert')).toContainText('incompleto');
  });

  test('cabeçalhos: Referrer-Policy único (no-referrer), no-store e CSP', async ({ page }) => {
    const response = await page.goto('/convite');
    const headers = response?.headers() ?? {};
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
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
    await page.goto(URL);
    await page.locator('main').waitFor();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /convite, pronto e com erro (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route(ACCEPT, (route) =>
        route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
      );
      await page.goto(URL);
      await page.getByRole('button', { name: 'Aceitar convite' }).waitFor();
      await expectNoViolations(page, `/convite pronto (${scheme})`);
      await page.getByRole('button', { name: 'Aceitar convite' }).click();
      await page.getByRole('alert').waitFor();
      await expectNoViolations(page, `/convite erro (${scheme})`);
    });
  }
});
