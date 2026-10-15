import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

const dto = (overrides: Record<string, unknown> = {}) => ({
  state: 'valid',
  courseTitle: 'Curso Demonstrativo',
  workloadHours: 20,
  issuedAt: '2026-10-14T12:00:00.000Z',
  issuerName: 'Neuro Capacitar LTDA',
  ...overrides,
});

async function stub(page: Page, answer: { status: number; json: unknown }) {
  const calls: string[] = [];
  await page.route('**/api/public/certificates/*', (route) => {
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return calls;
}

test.describe('validação pública do certificado (M7-08)', () => {
  test('válido: estado, curso, carga horária, data e emitente; nenhum nome, e-mail nem link de PDF', async ({
    page,
  }) => {
    const calls = await stub(page, { status: 200, json: dto() });
    await page.goto(`/certificados/${CODE}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Validação de certificado' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Certificado válido' })).toBeVisible();
    await expect(page.getByText('Curso Demonstrativo')).toBeVisible();
    await expect(page.getByText('20 horas')).toBeVisible();
    await expect(page.getByText('14 de outubro de 2026')).toBeVisible();
    await expect(page.getByText('Neuro Capacitar LTDA')).toBeVisible();
    await expect(page.getByText('Titular')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /pdf|baixar|download/i })).toHaveCount(0);
    expect(calls).toEqual([`/api/public/certificates/${CODE}`]);
  });

  test('com o modo do nome ligado o servidor devolve o titular e a tela o mostra', async ({
    page,
  }) => {
    await stub(page, { status: 200, json: dto({ holderName: 'Maria A. S.' }) });
    await page.goto(`/certificados/${CODE}`);
    await expect(page.getByText('Titular')).toBeVisible();
    await expect(page.getByText('Maria A. S.')).toBeVisible();
  });

  test('revogado e substituído: mensagem própria e sem sugerir aceitação', async ({ page }) => {
    await stub(page, { status: 200, json: dto({ state: 'revoked' }) });
    await page.goto(`/certificados/${CODE}`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Certificado revogado' }),
    ).toBeVisible();
    await expect(page.getByText('não deve ser aceito')).toBeVisible();
    await page.unroute('**/api/public/certificates/*');
    await stub(page, { status: 200, json: dto({ state: 'superseded' }) });
    await page.goto(`/certificados/${CODE}`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Certificado substituído' }),
    ).toBeVisible();
  });

  test('código desconhecido: a mesma mensagem e nenhum dado', async ({ page }) => {
    await stub(page, { status: 404, json: { error: { code: 'not_found' } } });
    await page.goto('/certificados/qualquer-coisa');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Certificado não encontrado' }),
    ).toBeVisible();
    await expect(page.getByText('Curso Demonstrativo')).toHaveCount(0);
  });

  test('excesso de consultas (429) e erro do servidor têm aviso próprio', async ({ page }) => {
    await stub(page, { status: 429, json: { error: { code: 'rate_limited' } } });
    await page.goto(`/certificados/${CODE}`);
    await expect(page.getByRole('alert')).toContainText('Muitas consultas em pouco tempo');
    await page.unroute('**/api/public/certificates/*');
    await stub(page, { status: 500, json: {} });
    await page.goto(`/certificados/${CODE}`);
    await expect(page.getByRole('alert')).toContainText(
      'Não foi possível conferir o certificado agora',
    );
  });

  test('a página sai com noindex (cabeçalho e meta) e a meta nunca ecoa o código recebido', async ({
    page,
  }) => {
    await stub(page, { status: 404, json: { error: { code: 'not_found' } } });
    const response = await page.goto('/certificados/Zzzzzzzzzzzzzzzzzzzzzz');
    expect(response?.headers()['x-robots-tag']).toBe('noindex');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    const head = await page.locator('head').innerHTML();
    expect(head).not.toContain('Zzzzzzzzzzzzzzzzzzzzzz');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade e sem rolagem horizontal no celular (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stub(page, { status: 200, json: dto() });
      await page.goto(`/certificados/${CODE}`);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Certificado válido' }),
      ).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
      await page.setViewportSize({ width: 375, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
});
