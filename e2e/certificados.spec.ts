import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '00000000-0000-4000-8000-000000000c01';
const MEDIA_ID = '00000000-0000-4000-8000-000000000c02';

interface Call {
  method: string;
  path: string;
  body: Record<string, any>;
}

async function stubStaff(
  page: Page,
  options: {
    forbidden?: boolean;
    issuer?: Record<string, unknown> | null;
    signatory?: Record<string, unknown> | null;
    reject?: { status: number; code: string };
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: {
        roles: ['student', 'admin'],
        capabilities: ['staff.read', 'staff.manage'],
        recentAuth: false,
      },
    }),
  );
  // A assinatura privada só sai por esta rota autorizada.
  await page.route('**/api/media/*/content', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      ),
    }),
  );
  const calls: Call[] = [];
  await page.route('**/api/staff/courses', (route) =>
    route.fulfill({
      json: {
        courses: [
          {
            id: COURSE_ID,
            slug: 'demo',
            title: 'Curso Demonstrativo',
            sequenceMode: 'guided',
            status: 'published',
            firstPublishedAt: null,
            publishedVersion: 1,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
            offers: [],
          },
        ],
      },
    }),
  );
  let issuer = options.issuer ?? null;
  await page.route('**/api/staff/certificate/issuer', (route) => {
    if (options.forbidden) {
      return route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } });
    }
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, any>;
      calls.push({ method: 'PUT', path: new URL(request.url()).pathname, body });
      if (options.reject) {
        return route.fulfill({
          status: options.reject.status,
          json: { error: { code: options.reject.code } },
        });
      }
      const digits = String(body.cnpj).replaceAll(/\D/g, '');
      issuer = {
        legalName: body.legalName,
        cnpj: digits,
        cnpjFormatted: digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
        updatedAt: new Date().toISOString(),
      };
      return route.fulfill({ json: { issuer } });
    }
    return route.fulfill({ json: { issuer } });
  });
  let signatory = options.signatory ?? null;
  await page.route(`**/api/staff/courses/${COURSE_ID}/certificate/signatory`, (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, any>;
      calls.push({ method: 'PUT', path: new URL(request.url()).pathname, body });
      signatory = { courseId: COURSE_ID, ...body, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { signatory } });
    }
    return route.fulfill({ json: { signatory } });
  });
  return { calls };
}

test.describe('certificados: emitente e signatário (M7-06)', () => {
  test('sem permissão (403) a tela avisa, sem mostrar formulário', async ({ page }) => {
    await stubStaff(page, { forbidden: true });
    await page.goto('/staff/certificados');
    await expect(page.getByRole('alert')).toHaveText(
      'Só o Admin gerencia o emitente e o signatário.',
    );
    await expect(page.getByRole('button', { name: 'Salvar emitente' })).toHaveCount(0);
  });

  test('o Admin salva o emitente e o servidor devolve o CNPJ com máscara', async ({ page }) => {
    const { calls } = await stubStaff(page);
    await page.goto('/staff/certificados');
    await expect(page.getByRole('heading', { level: 1, name: 'Certificados' })).toBeVisible();
    await page.getByLabel('Razão social').fill('Neuro Capacitar LTDA');
    await page.getByLabel('CNPJ').fill('11222333000181');
    await page.getByRole('button', { name: 'Salvar emitente' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Emitente salvo.' })).toBeVisible();
    expect(calls).toEqual([
      {
        method: 'PUT',
        path: '/api/staff/certificate/issuer',
        body: { legalName: 'Neuro Capacitar LTDA', cnpj: '11222333000181' },
      },
    ]);
    await expect(page.getByLabel('CNPJ')).toHaveValue('11.222.333/0001-81');
  });

  test('CNPJ recusado pelo servidor mostra a mensagem, sem perder o que foi digitado', async ({
    page,
  }) => {
    await stubStaff(page, { reject: { status: 400, code: 'invalid_request' } });
    await page.goto('/staff/certificados');
    await page.getByLabel('Razão social').fill('Neuro Capacitar LTDA');
    await page.getByLabel('CNPJ').fill('11222333000182');
    await page.getByRole('button', { name: 'Salvar emitente' }).click();
    await expect(page.getByRole('alert')).toContainText('o CNPJ precisa ser válido');
    await expect(page.getByLabel('CNPJ')).toHaveValue('11222333000182');
  });

  test('o signatário é por curso: escolhe o curso, preenche e salva (assinatura opcional)', async ({
    page,
  }) => {
    const { calls } = await stubStaff(page);
    await page.goto('/staff/certificados');
    await expect(page.getByText('Nenhuma assinatura cadastrada.')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Curso' }).selectOption(COURSE_ID);
    await page.getByLabel('Nome do signatário').fill('Dra. Ana Lima');
    await page.getByLabel('Cargo').fill('Diretora Acadêmica');
    await expect(page.getByText('Nenhuma assinatura cadastrada.')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar signatário' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Signatário salvo.' })).toBeVisible();
    expect(calls.at(-1)).toEqual({
      method: 'PUT',
      path: `/api/staff/courses/${COURSE_ID}/certificate/signatory`,
      body: { name: 'Dra. Ana Lima', title: 'Diretora Acadêmica', signatureMediaId: null },
    });
  });

  test('com assinatura cadastrada ela aparece por rota autorizada e "Remover" a tira antes de salvar', async ({
    page,
  }) => {
    const { calls } = await stubStaff(page, {
      signatory: {
        courseId: COURSE_ID,
        name: 'Dra. Ana Lima',
        title: 'Diretora Acadêmica',
        signatureMediaId: MEDIA_ID,
        updatedAt: '2026-10-14T00:00:00.000Z',
      },
    });
    await page.goto('/staff/certificados');
    await page.getByRole('combobox', { name: 'Curso' }).selectOption(COURSE_ID);
    const image = page.getByRole('img', { name: 'Assinatura de Dra. Ana Lima' });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', `/api/media/${MEDIA_ID}/content`);
    await page.getByRole('button', { name: 'Remover a assinatura' }).click();
    await expect(page.getByText('Nenhuma assinatura cadastrada.')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar signatário' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Signatário salvo.' })).toBeVisible();
    expect(calls.at(-1)?.body.signatureMediaId).toBeNull();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade e sem rolagem horizontal no celular (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubStaff(page, {
        issuer: {
          legalName: 'Neuro Capacitar LTDA',
          cnpj: '11222333000181',
          cnpjFormatted: '11.222.333/0001-81',
          updatedAt: '2026-10-14T00:00:00.000Z',
        },
      });
      await page.goto('/staff/certificados');
      await page.getByRole('combobox', { name: 'Curso' }).selectOption(COURSE_ID);
      await expect(page.getByLabel('Nome do signatário')).toBeVisible();
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
