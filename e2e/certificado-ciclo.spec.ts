import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

interface Call {
  method: string;
  path: string;
  body: Record<string, any>;
}

const mine = (n: number, status: string, title = `Curso ${n}`) => ({
  id: ID(n),
  courseTitle: title,
  status,
  code: `AbCdEfGhIjKlMnOpQrSt${String(n).padStart(2, '0')}`,
  readyAt: status === 'ready' ? '2026-10-14T12:00:00.000Z' : null,
  canDownload: status === 'ready',
});

const staffRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: ID(n),
  courseId: ID(90),
  courseTitle: 'Curso Demonstrativo',
  holderName: `Aluna ${n}`,
  holderEmail: `aluna${n}@example.test`,
  status: 'ready',
  code: `AbCdEfGhIjKlMnOpQrSt${String(n).padStart(2, '0')}`,
  failureCode: null,
  readyAt: '2026-10-14T12:00:00.000Z',
  revokedAt: null,
  revocationCategory: null,
  predecessorId: null,
  createdAt: '2026-10-14T11:00:00.000Z',
  refundedAt: null,
  hasSuccessor: false,
  ...overrides,
});

async function stubBase(page: Page) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
}

async function stubStaff(
  page: Page,
  options: {
    forbidden?: boolean;
    rows?: unknown[];
    answer?: (call: Call) => { status: number; json: unknown } | undefined;
  } = {},
) {
  await stubBase(page);
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: {
        roles: ['student', 'admin'],
        capabilities: ['staff.read', 'staff.manage', 'certificate.reissue', 'ops.queue'],
        recentAuth: false,
      },
    }),
  );
  const calls: Call[] = [];
  await page.route('**/api/staff/certificates**', (route) => {
    if (options.forbidden) {
      return route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } });
    }
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({ json: { certificates: options.rows ?? [] } });
    }
    const call: Call = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: (request.postDataJSON() ?? {}) as Record<string, any>,
    };
    calls.push(call);
    const answer = options.answer?.(call);
    if (answer) return route.fulfill({ status: answer.status, json: answer.json });
    return route.fulfill({
      status: call.path.endsWith('/reissue') ? 201 : 200,
      json: call.path.endsWith('/reissue') ? { certificateId: ID(80) } : { ok: true },
    });
  });
  return { calls };
}

test.describe('meus certificados (conta do aluno)', () => {
  async function stubStudent(page: Page, certificates: unknown[]) {
    await stubBase(page);
    await page.route('**/api/me/profile', (route) =>
      route.fulfill({
        json: {
          displayName: 'Maria Souza',
          certificateName: null,
          certificateNameConfirmed: false,
          theme: 'system',
          autoAdvance: false,
        },
      }),
    );
    await page.route('**/api/me/course-interests**', (route) =>
      route.fulfill({ json: { interests: [] } }),
    );
    await page.route('**/api/me/certificates', (route) =>
      route.fulfill({ json: { certificates } }),
    );
  }

  test('só o pronto tem "Baixar o PDF", apontando para a rota autenticada; revogado e em preparação, não', async ({
    page,
  }) => {
    await stubStudent(page, [
      mine(1, 'ready', 'Curso Pronto'),
      mine(2, 'queued', 'Curso na Fila'),
      mine(3, 'revoked', 'Curso Revogado'),
    ]);
    await page.goto('/conta');
    const list = page.getByRole('list', { name: 'Certificados' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(3);
    const link = page.getByRole('link', { name: /Baixar o PDF/ });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', `/api/me/certificates/${ID(1)}/download`);
    await expect(list).toContainText('Em preparação');
    await expect(list).toContainText('Revogado');
    // o motivo interno nunca chega à tela: o servidor nem o devolve
    await expect(list).not.toContainText('Nota');
  });

  test('sem certificado, a seção nem aparece', async ({ page }) => {
    await stubStudent(page, []);
    await page.goto('/conta');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meus certificados' })).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubStudent(page, [mine(1, 'ready', 'Curso Pronto')]);
      await page.goto('/conta');
      await expect(page.getByRole('heading', { name: 'Meus certificados' })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});

test.describe('certificados emitidos (Staff)', () => {
  test('sem permissão (403) avisa e não lista', async ({ page }) => {
    await stubStaff(page, { forbidden: true });
    await page.goto('/staff/certificados/emitidos');
    await expect(page.getByRole('alert')).toHaveText(
      'Você não tem permissão para ver os certificados.',
    );
  });

  test('cada linha mostra a pessoa, o estado e o reembolso; as ações dependem do estado', async ({
    page,
  }) => {
    await stubStaff(page, {
      rows: [
        staffRow(1),
        staffRow(2, { status: 'failed', failureCode: 'renderer_not_configured', readyAt: null }),
        staffRow(3, {
          status: 'revoked',
          revokedAt: '2026-10-14T13:00:00.000Z',
          revocationCategory: 'wrong_data',
        }),
        staffRow(4, { status: 'superseded', hasSuccessor: true }),
        staffRow(5, { refundedAt: '2026-10-13T12:00:00.000Z' }),
      ],
    });
    await page.goto('/staff/certificados/emitidos');
    const row = (n: number) => page.getByRole('listitem', { name: new RegExp(`Aluna ${n},`) });
    await expect(row(1).getByRole('button', { name: 'Revogar' })).toBeVisible();
    await expect(row(1).getByRole('button', { name: 'Reemitir' })).toBeVisible();
    await expect(row(2)).toContainText('Falhou (renderer_not_configured)');
    await expect(row(2).getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    await expect(row(2).getByRole('button', { name: 'Revogar' })).toHaveCount(0);
    await expect(row(3)).toContainText('Revogado: Dado incorreto no certificado');
    await expect(row(3).getByRole('button', { name: 'Reemitir' })).toBeVisible();
    await expect(row(3).getByRole('button', { name: 'Revogar' })).toHaveCount(0);
    await expect(row(4)).toContainText('Substituído');
    await expect(row(4).getByRole('button')).toHaveCount(0);
    await expect(row(5)).toContainText('Acesso reembolsado em');
    await expect(row(5)).toContainText('o certificado continua válido');
  });

  test('revogar: categoria e nota vão ao servidor; só confirma com nota de 5+ caracteres', async ({
    page,
  }) => {
    const { calls } = await stubStaff(page, { rows: [staffRow(1)] });
    await page.goto('/staff/certificados/emitidos');
    await page.getByRole('button', { name: 'Revogar' }).click();
    const confirm = page.getByRole('button', { name: 'Confirmar a revogação' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Categoria').selectOption('issued_in_error');
    await page.getByLabel('Nota interna').fill('Emitido para a pessoa errada');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Certificado revogado.' }),
    ).toBeVisible();
    expect(calls).toEqual([
      {
        method: 'POST',
        path: `/api/staff/certificates/${ID(1)}/revoke`,
        body: { category: 'issued_in_error', note: 'Emitido para a pessoa errada' },
      },
    ]);
  });

  test('revogar sem reautenticação recente: explica o que fazer e mantém o formulário', async ({
    page,
  }) => {
    await stubStaff(page, {
      rows: [staffRow(1)],
      answer: () => ({ status: 403, json: { error: { code: 'reauth_required' } } }),
    });
    await page.goto('/staff/certificados/emitidos');
    await page.getByRole('button', { name: 'Revogar' }).click();
    await page.getByLabel('Nota interna').fill('Nome escrito errado no certificado');
    await page.getByRole('button', { name: 'Confirmar a revogação' }).click();
    await expect(page.getByRole('alert')).toContainText('confirme sua identidade de novo');
    await expect(page.getByLabel('Nota interna')).toHaveValue('Nome escrito errado no certificado');
  });

  test('reemitir envia o motivo; "tentar de novo" chama a rota certa', async ({ page }) => {
    const { calls } = await stubStaff(page, {
      rows: [staffRow(1), staffRow(2, { status: 'failed', failureCode: 'x', readyAt: null })],
    });
    await page.goto('/staff/certificados/emitidos');
    await page
      .getByRole('listitem', { name: /Aluna 1,/ })
      .getByRole('button', { name: 'Reemitir' })
      .click();
    await page.getByLabel('Motivo da reemissão').fill('Correção do nome pedida pela aluna');
    await page.getByRole('button', { name: 'Confirmar a reemissão' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Certificado reemitido.' }),
    ).toBeVisible();
    await page
      .getByRole('listitem', { name: /Aluna 2,/ })
      .getByRole('button', { name: 'Tentar de novo' })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Nova tentativa pedida.' }),
    ).toBeVisible();
    expect(calls.map((call) => call.path.split('/').slice(-1)[0])).toEqual(['reissue', 'retry']);
    expect(calls[0]!.body).toEqual({ reason: 'Correção do nome pedida pela aluna' });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade e sem rolagem horizontal no celular (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubStaff(page, {
        rows: [staffRow(1), staffRow(2, { status: 'failed', readyAt: null })],
      });
      await page.goto('/staff/certificados/emitidos');
      await page.getByRole('button', { name: 'Revogar' }).click();
      await expect(page.getByLabel('Nota interna')).toBeVisible();
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
