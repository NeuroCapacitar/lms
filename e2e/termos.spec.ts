import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PROFILE = {
  displayName: 'Maria',
  certificateName: null,
  certificateNameConfirmedAt: null,
  certificateNameConfirmed: false,
  theme: 'system',
  autoAdvance: false,
};
const DOCUMENTS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'terms',
    version: 'provisorio-1',
    body: 'TEXTO PROVISÓRIO: aguarda a redação do advogado do cliente.\n\nTermos de Uso (teste).',
    effectiveFrom: '2026-10-10T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'privacy',
    version: 'provisorio-1',
    body: 'TEXTO PROVISÓRIO: aguarda a redação do advogado do cliente.\n\nPolítica (teste).',
    effectiveFrom: '2026-10-10T00:00:00.000Z',
  },
];

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

test.describe('aceite dos termos e declaração 18+ (área logada)', () => {
  test('sem aceite, /conta mostra a tela de aceite no lugar do conteúdo e não chama o perfil', async ({
    page,
  }) => {
    const profileCalls: string[] = [];
    await page.route('**/api/me/profile', (route) => {
      profileCalls.push(route.request().url());
      return route.fulfill({ json: PROFILE });
    });
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: false, documents: DOCUMENTS } }),
    );
    await page.goto('/conta');
    await expect(page.getByRole('heading', { name: 'Antes de continuar' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('provisórios');
    await expect(page.getByRole('heading', { name: /Termos de Uso/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Política de Privacidade/ })).toBeVisible();
    expect(profileCalls, 'o conteúdo nem é montado antes do aceite').toHaveLength(0);
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toHaveCount(0);
  });

  test('o botão só habilita com o aceite E a declaração de 18+; envia os IDs vistos e libera o conteúdo', async ({
    page,
  }) => {
    let accepted = false;
    let posted: unknown;
    await page.route('**/api/me/profile', (route) => route.fulfill({ json: PROFILE }));
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted, documents: DOCUMENTS } }),
    );
    await page.route('**/api/me/legal/accept', (route) => {
      posted = route.request().postDataJSON();
      accepted = true;
      return route.fulfill({ json: { status: 'ok' } });
    });
    await page.goto('/conta');
    const button = page.getByRole('button', { name: 'Aceitar e continuar' });
    await expect(button).toBeDisabled();
    await page.getByLabel('Li e aceito os Termos de Uso e a Política de Privacidade.').check();
    await expect(button).toBeDisabled();
    await page.getByLabel('Declaro ter 18 anos ou mais.').check();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
    expect(posted).toEqual({
      adultDeclaration: true,
      documentVersionIds: DOCUMENTS.map((doc) => doc.id),
    });
  });

  test('versão nova no meio do caminho (409): recarrega os documentos para ler de novo', async ({
    page,
  }) => {
    const second = [
      { ...DOCUMENTS[0]!, id: '33333333-3333-4333-8333-333333333333', version: 'v2' },
      DOCUMENTS[1]!,
    ];
    let documents = DOCUMENTS;
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: false, documents } }),
    );
    await page.route('**/api/me/legal/accept', (route) => {
      documents = second;
      return route.fulfill({ status: 409, json: { error: { code: 'terms_changed' } } });
    });
    await page.goto('/conta');
    await page.getByLabel('Li e aceito os Termos de Uso e a Política de Privacidade.').check();
    await page.getByLabel('Declaro ter 18 anos ou mais.').check();
    await page.getByRole('button', { name: 'Aceitar e continuar' }).click();
    await expect(page.getByText('(versão v2)')).toBeVisible();
  });

  test('sem sessão (401) o conteúdo aparece normalmente e pede o login', async ({ page }) => {
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.route('**/api/me/profile', (route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
    );
    await page.goto('/conta');
    await expect(page.getByText('Entre para ver e editar o seu perfil.')).toBeVisible();
  });

  test('o convite protege o fragmento: a tela de aceite aparece antes e o token segue na URL', async ({
    page,
  }) => {
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: false, documents: DOCUMENTS } }),
    );
    await page.goto('/convite#token=convite-qualquer-token-de-teste-1234');
    await expect(page.getByRole('heading', { name: 'Antes de continuar' })).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toContain('token=');
  });

  test('falha ao verificar mostra erro com nova tentativa (nunca libera o conteúdo)', async ({
    page,
  }) => {
    await page.route('**/api/me/legal', (route) => route.fulfill({ status: 500, body: '' }));
    await page.goto('/conta');
    await expect(page.getByRole('alert')).toContainText('Não foi possível verificar');
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toHaveCount(0);
  });

  test('nenhuma violação de CSP na tela de aceite', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await page.route('**/api/me/legal', (route) =>
      route.fulfill({ json: { accepted: false, documents: DOCUMENTS } }),
    );
    await page.goto('/conta');
    await page.getByRole('heading', { name: 'Antes de continuar' }).waitFor();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações na tela de aceite (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route('**/api/me/legal', (route) =>
        route.fulfill({ json: { accepted: false, documents: DOCUMENTS } }),
      );
      await page.goto('/conta');
      await page.getByRole('heading', { name: 'Antes de continuar' }).waitFor();
      await expectNoViolations(page, `/conta aceite (${scheme})`);
    });
  }
});
