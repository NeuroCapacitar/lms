import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = [
  'staff.read',
  'staff.manage',
  'course.create',
  'course.edit',
  'offer.manage',
  'access.grant',
  'enrollment.support_edit',
];
const GRANTER = ['staff.read', 'course.edit', 'access.grant'];
const EDITOR = ['staff.read', 'enrollment.support_edit'];
const READER = ['staff.read'];

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'user-aaaaaaaa',
  name: 'Ana Ativa',
  email: 'ana@example.test',
  status: 'active',
  expiresAt: '2027-10-11T12:00:00.000Z',
  anchorAt: '2026-10-11T12:00:00.000Z',
  suspendedReason: null,
  progress: { completed: 2, total: 5, percent: 40 },
  courseCompletedAt: null,
  manualGrant: null,
  ...over,
});
const ROWS = [
  row(),
  row({
    userId: 'user-bbbbbbbb',
    name: 'Bia Manual',
    email: 'bia@example.test',
    manualGrant: {
      entitlementId: '33333333-3333-4333-8333-333333333333',
      expiresAt: '2027-04-20T12:00:00.000Z',
    },
  }),
  row({
    userId: 'user-cccccccc',
    name: 'Caio Suspenso',
    email: 'caio@example.test',
    status: 'suspended',
    suspendedReason: 'Uso indevido',
  }),
  row({
    userId: 'user-dddddddd',
    name: 'Duda Expirada',
    email: 'duda@example.test',
    status: 'expired',
    expiresAt: '2026-02-01T12:00:00.000Z',
    courseCompletedAt: '2026-01-20T12:00:00.000Z',
    progress: { completed: 5, total: 5, percent: 100 },
  }),
];

interface State {
  rows: Record<string, unknown>[];
  total?: number;
  calls: { method: string; path: string; body: unknown }[];
  next: { status: number; json: unknown } | null;
}

async function setup(page: Page, capabilities: string[], rows = ROWS) {
  const state: State = { rows: [...rows], calls: [], next: null };
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({ json: { roles: ['student', 'support'], capabilities, recentAuth: false } }),
  );
  await page.route(`**/api/staff/courses/${COURSE_ID}`, (route) =>
    route.fulfill({
      json: {
        id: COURSE_ID,
        slug: 'demo',
        title: 'Curso Demonstrativo',
        sequenceMode: 'guided',
        status: 'published',
        firstPublishedAt: '2026-10-11T00:00:00.000Z',
        publishedVersion: 1,
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '2026-10-11T00:00:00.000Z',
        offers: [],
      },
    }),
  );
  await page.route(`**/api/staff/courses/${COURSE_ID}/draft`, (route) =>
    route.fulfill({
      json: {
        rev: 1,
        publishedVersion: 1,
        details: { displayTitle: 'Curso', description: null, workloadHours: null },
        modules: [],
      },
    }),
  );
  await page.route(`**/api/staff/courses/${COURSE_ID}/enrollments?*`, (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
    return route.fulfill({
      json: {
        items: state.rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: state.total ?? state.rows.length,
        page: pageNumber,
        pageSize,
      },
    });
  });
  const write = (route: import('@playwright/test').Route, fallback: unknown) => {
    state.calls.push({
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    const next = state.next;
    state.next = null;
    return route.fulfill(next ?? { status: 200, json: fallback });
  };
  await page.route('**/api/staff/enrollments', (route) =>
    write(route, { status: 'enrolled', userId: 'user-new', expiresAt: '2027-04-20T12:00:00.000Z' }),
  );
  await page.route(
    new RegExp(`/api/staff/courses/${COURSE_ID}/enrollments/[^/]+/(suspend|reinstate)$`),
    (route) =>
      write(route, {
        status: route.request().url().endsWith('suspend') ? 'suspended' : 'reinstated',
      }),
  );
  await page.route('**/api/staff/entitlements/*/adjust', (route) =>
    write(route, {
      status: 'adjusted',
      entitlementId: 'novo',
      expiresAt: '2027-10-20T12:00:00.000Z',
    }),
  );
  return state;
}

const open = async (page: Page) => {
  await page.goto(`/staff/cursos/${COURSE_ID}`);
  await page.getByRole('tab', { name: 'Pessoas inscritas', exact: true }).click();
};
async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('lista', () => {
  test('qualquer Staff vê a lista (nome, e-mail, situação, acesso até, progresso) sem nenhuma ação', async ({
    page,
  }) => {
    await setup(page, READER);
    await open(page);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Pessoas inscritas (4)' }),
    ).toBeVisible();
    const table = page.getByRole('table', { name: 'Pessoas inscritas neste curso' });
    await expect(table.getByRole('row')).toHaveCount(5);
    const ana = table.getByRole('row').filter({ hasText: 'Ana Ativa' });
    await expect(ana).toContainText('ana@example.test');
    await expect(ana).toContainText('Ativa');
    await expect(ana).toContainText('11/10/2027');
    await expect(ana).toContainText('40% (2/5)');
    await expect(table.getByRole('row').filter({ hasText: 'Caio Suspenso' })).toContainText(
      'Motivo: Uso indevido',
    );
    await expect(table.getByRole('row').filter({ hasText: 'Duda Expirada' })).toContainText(
      'Concluiu em 20/01/2026',
    );
    // leitura básica: nada de formulário nem botão de ação
    await expect(page.getByRole('form', { name: 'Matricular pessoa' })).toHaveCount(0);
    await expect(table.getByRole('button')).toHaveCount(0);
  });

  test('vazio, erro com "Tentar novamente" e permissão negada', async ({ page }) => {
    await setup(page, READER, []);
    await open(page);
    await expect(page.getByText('Ninguém se inscreveu neste curso ainda.')).toBeVisible();

    await page.unrouteAll();
    await setup(page, READER);
    let fail = true;
    await page.route(`**/api/staff/courses/${COURSE_ID}/enrollments?*`, (route) =>
      fail ? route.fulfill({ status: 500, json: {} }) : route.fallback(),
    );
    await open(page);
    await expect(page.getByRole('alert')).toContainText(
      'Não foi possível carregar as pessoas inscritas agora.',
    );
    fail = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByRole('table')).toBeVisible();

    await page.unrouteAll();
    await setup(page, READER);
    await page.route(`**/api/staff/courses/${COURSE_ID}/enrollments?*`, (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } }),
    );
    await open(page);
    await expect(page.getByRole('alert')).toHaveText(
      'Você não tem permissão para ver as pessoas inscritas.',
    );
  });

  test('paginação: Anterior e Próxima, com a página atual', async ({ page }) => {
    const many = Array.from({ length: 30 }, (_, index) =>
      row({
        userId: `user-${String(index).padStart(8, '0')}`,
        name: `Pessoa ${index + 1}`,
        email: `p${index + 1}@example.test`,
      }),
    );
    await setup(page, READER, many);
    await open(page);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await expect(page.getByRole('row')).toHaveCount(26);
    await page.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  });

  test('XSS em nome e e-mail aparece como texto', async ({ page }) => {
    await setup(page, READER, [
      row({ name: '<img src=x onerror=alert(1)>', email: '<script>alert(2)</script>@x.test' }),
    ]);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await open(page);
    await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(await page.locator('main img, main script').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });
});

test.describe('matricular (access.grant)', () => {
  test('envia o e-mail, o prazo, o motivo e uma chave de idempotência; mostra o acesso e limpa o formulário', async ({
    page,
  }) => {
    const state = await setup(page, GRANTER);
    await open(page);
    await page.getByLabel('E-mail da pessoa').fill('nova@example.test');
    await page.getByLabel('Prazo (meses)').fill('6');
    await page.getByLabel('Motivo').fill('Cortesia da turma piloto');
    await page.getByRole('button', { name: 'Matricular', exact: true }).click();
    await expect(page.getByText('Pessoa matriculada. Acesso até 20/04/2027.')).toBeVisible();
    const call = state.calls[0]!;
    expect(call.path).toBe('/api/staff/enrollments');
    expect(call.body).toMatchObject({
      email: 'nova@example.test',
      courseId: COURSE_ID,
      months: 6,
      reason: 'Cortesia da turma piloto',
    });
    expect((call.body as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByLabel('E-mail da pessoa')).toHaveValue('');
  });

  test('um segundo envio usa OUTRA chave (a tela troca depois do sucesso)', async ({ page }) => {
    const state = await setup(page, GRANTER);
    await open(page);
    for (const email of ['um@example.test', 'dois@example.test']) {
      await page.getByLabel('E-mail da pessoa').fill(email);
      await page.getByLabel('Motivo').fill('Motivo válido');
      await page.getByRole('button', { name: 'Matricular', exact: true }).click();
      await expect(page.getByText(/Pessoa matriculada/)).toBeVisible();
      await page.getByText(/Pessoa matriculada/).waitFor({ state: 'visible' });
    }
    const ids = state.calls.map((c) => (c.body as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(2);
  });

  for (const [code, status, text] of [
    ['user_not_found', 404, 'Não há conta com este e-mail.'],
    ['course_not_found', 404, 'Este curso não existe mais.'],
    ['request_id_conflict', 409, 'Este envio já foi usado para outra pessoa.'],
    ['invalid_request', 400, 'Confira os campos'],
    ['forbidden', 403, 'Você não tem permissão para esta ação.'],
  ] as const) {
    test(`erro "${code}" aparece em português`, async ({ page }) => {
      const state = await setup(page, GRANTER);
      await open(page);
      state.next = { status, json: { error: { code } } };
      await page.getByLabel('E-mail da pessoa').fill('x@example.test');
      await page.getByLabel('Motivo').fill('Motivo válido');
      await page.getByRole('button', { name: 'Matricular', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      await expect(page.getByLabel('E-mail da pessoa')).toHaveValue('x@example.test');
    });
  }
});

test.describe('suspender, reativar e ajustar', () => {
  test('suspender pede o motivo, envia e confirma; reativar vale para a pessoa suspensa', async ({
    page,
  }) => {
    const state = await setup(page, GRANTER);
    await open(page);
    await page.getByRole('button', { name: 'Suspender Ana Ativa' }).click();
    const form = page.getByRole('form', { name: 'Suspender Ana Ativa' });
    await form.getByLabel('Motivo').fill('Compartilhou a senha');
    await form.getByRole('button', { name: 'Confirmar suspensão' }).click();
    await expect(page.getByText('Acesso de Ana Ativa suspenso.')).toBeVisible();
    expect(state.calls[0]).toMatchObject({
      path: `/api/staff/courses/${COURSE_ID}/enrollments/user-aaaaaaaa/suspend`,
      body: { reason: 'Compartilhou a senha' },
    });
    // a pessoa suspensa não tem "Suspender", tem "Reativar"
    await expect(page.getByRole('button', { name: 'Suspender Caio Suspenso' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reativar Caio Suspenso' }).click();
    await expect(page.getByText('Acesso de Caio Suspenso reativado.')).toBeVisible();
    expect(state.calls[1]!.path).toBe(
      `/api/staff/courses/${COURSE_ID}/enrollments/user-cccccccc/reinstate`,
    );
  });

  test('cancelar fecha o formulário sem enviar nada', async ({ page }) => {
    const state = await setup(page, GRANTER);
    await open(page);
    await page.getByRole('button', { name: 'Suspender Ana Ativa' }).click();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('form', { name: 'Suspender Ana Ativa' })).toHaveCount(0);
    expect(state.calls).toEqual([]);
  });

  test('ajustar o prazo: só para matrícula manual e só com enrollment.support_edit', async ({
    page,
  }) => {
    const state = await setup(page, EDITOR);
    await open(page);
    // quem só ajusta não matricula nem suspende
    await expect(page.getByRole('form', { name: 'Matricular pessoa' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Suspender|Reativar/ })).toHaveCount(0);
    // só a Bia tem matrícula manual
    await expect(page.getByRole('button', { name: /Ajustar prazo de/ })).toHaveCount(1);
    await page.getByRole('button', { name: 'Ajustar prazo de Bia Manual' }).click();
    const form = page.getByRole('form', { name: 'Ajustar prazo de Bia Manual' });
    await form.getByLabel('Novo prazo total (meses)').fill('12');
    await form.getByLabel('Motivo').fill('Ampliação combinada');
    await form.getByRole('button', { name: 'Confirmar ajuste' }).click();
    await expect(page.getByText('Prazo de Bia Manual ajustado.')).toBeVisible();
    expect(state.calls[0]).toMatchObject({
      path: '/api/staff/entitlements/33333333-3333-4333-8333-333333333333/adjust',
      body: { months: 12, reason: 'Ampliação combinada' },
    });
  });

  test('erro do servidor no ajuste aparece no formulário', async ({ page }) => {
    const state = await setup(page, EDITOR);
    await open(page);
    state.next = { status: 409, json: { error: { code: 'not_adjustable' } } };
    await page.getByRole('button', { name: 'Ajustar prazo de Bia Manual' }).click();
    await page.getByLabel('Motivo').fill('Ampliação combinada');
    await page.getByRole('button', { name: 'Confirmar ajuste' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Só a matrícula manual ainda ativa' }),
    ).toBeVisible();
  });

  test('o Admin vê todas as ações', async ({ page }) => {
    await setup(page, ADMIN);
    await open(page);
    await expect(page.getByRole('form', { name: 'Matricular pessoa' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspender Ana Ativa' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajustar prazo de Bia Manual' })).toBeVisible();
  });
});

test.describe('acessibilidade', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações: lista, formulário e ações abertas (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await setup(page, ADMIN);
      await open(page);
      await page.getByRole('table').waitFor();
      await expectNoViolations(page, `lista (${scheme})`);
      await page.getByRole('button', { name: 'Suspender Ana Ativa' }).click();
      await page.getByRole('form', { name: 'Suspender Ana Ativa' }).waitFor();
      await expectNoViolations(page, `suspender aberto (${scheme})`);
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await page.getByRole('button', { name: 'Ajustar prazo de Bia Manual' }).click();
      await page.getByRole('form', { name: 'Ajustar prazo de Bia Manual' }).waitFor();
      await expectNoViolations(page, `ajustar aberto (${scheme})`);
    });
  }

  test('no celular (375 px) a tabela rola por dentro, sem rolagem horizontal da página', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, ADMIN);
    await open(page);
    await page.getByRole('table').waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
