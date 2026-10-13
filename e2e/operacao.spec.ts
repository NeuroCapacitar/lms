import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const ADMIN = {
  roles: ['student', 'admin'],
  capabilities: ['staff.read', 'ops.queue', 'system.maintenance', 'staff.manage'],
  recentAuth: false,
};
const SUPPORT_OPS = {
  roles: ['student', 'support'],
  capabilities: ['staff.read', 'ops.queue'],
  recentAuth: false,
};
const SUPPORT_READ = {
  roles: ['student', 'support'],
  capabilities: ['staff.read'],
  recentAuth: false,
};

const ITEM_ID = '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10';

const snapshot = () => ({
  outbox: [
    { queue: 'general', state: 'pending', count: 2 },
    { queue: 'general', state: 'dead', count: 1 },
    { queue: 'finance', state: 'delivered', count: 7 },
  ],
  oldestOpenAgeSeconds: { finance: null, general: 4200 },
  problems: [
    {
      id: ITEM_ID,
      kind: 'email.send',
      queue: 'general',
      state: 'dead',
      attempts: 8,
      lastErrorCode: 'provider_503',
      finishedAt: '2026-10-13T12:00:00.000Z',
      correlationId: 'c-1',
    },
  ],
  inbox: [
    { provider: 'resend', lastReceivedAt: '2026-10-13T11:00:00.000Z', pending: 1, problems: 0 },
  ],
  jobs: [
    {
      name: 'outbox.republish',
      lastStatus: 'ok',
      lastCount: 2,
      lastDurationMs: 2500,
      lastErrorCode: null,
      lastFinishedAt: '2026-10-13T12:30:00.000Z',
      running: false,
    },
    {
      name: 'async.purge',
      lastStatus: 'error',
      lastCount: 0,
      lastDurationMs: 400,
      lastErrorCode: 'job_failed',
      lastFinishedAt: '2026-10-13T12:30:00.000Z',
      running: false,
    },
  ],
  cronAgeSeconds: 600,
  quota: {
    today: 42,
    month: 420,
    last7Days: 300,
    dailyLimit: 100,
    monthlyLimit: 3000,
    upgradeSignal: false,
  },
  email: [
    { state: 'accepted', count: 40 },
    { state: 'bounced', count: 1 },
  ],
  suppressedRecipients: 1,
  emailAcceptedLast24h: 5,
  paused: { finance: false, general: false },
});

const ALERTS = [
  {
    code: 'queue_slow:general',
    severity: 'P2',
    message: 'Fila "general" atrasada: há item aberto há mais de 1 hora.',
  },
  {
    code: 'dead_letter:general',
    severity: 'P2',
    message: 'Fila "general": 1 item(ns) esgotaram as tentativas (DLQ) e esperam decisão.',
  },
];

async function stub(
  page: Page,
  access: unknown,
  options: { operations?: unknown; status?: number } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) => route.fulfill({ json: access }));
  const state = {
    reauthDone: false,
    calls: [] as { path: string; body: unknown }[],
    paused: false,
    requeued: false,
  };
  await page.route('**/api/staff/operations', (route) => {
    if (options.status)
      return route.fulfill({ status: options.status, json: { error: { code: 'forbidden' } } });
    const data = snapshot();
    if (state.requeued) {
      data.problems = [];
      data.outbox = data.outbox.filter((row) => row.state !== 'dead');
    }
    data.paused.general = state.paused;
    return route.fulfill({
      json: options.operations ?? {
        snapshot: data,
        alerts: state.requeued ? [] : ALERTS,
      },
    });
  });
  const guard = (route: Route) => {
    state.calls.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    if (!state.reauthDone) {
      void route.fulfill({ status: 403, json: { error: { code: 'reauth_required' } } });
      return false;
    }
    return true;
  };
  await page.route('**/api/staff/operations/outbox/*/requeue', async (route) => {
    if (!guard(route)) return;
    state.requeued = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/staff/operations/queues/*/pause', async (route) => {
    if (!guard(route)) return;
    state.paused = (route.request().postDataJSON() as { paused: boolean }).paused;
    await route.fulfill({ json: { ok: true } });
  });
  return state;
}

test.describe('Operação (Staff)', () => {
  test('mostra alertas, filas, itens com problema, Cron, webhooks e e-mail, sem dado pessoal', async ({
    page,
  }) => {
    await stub(page, SUPPORT_READ);
    await page.goto('/staff/operacao');
    await expect(page.getByRole('heading', { level: 1, name: 'Operação' })).toBeVisible();

    const alerts = page.getByRole('region', { name: 'Alertas' });
    await expect(alerts.getByText('P2 atenção').first()).toBeVisible();
    await expect(alerts.getByText(/Fila "general" atrasada/)).toBeVisible();

    const filas = page.getByRole('region', { name: 'Filas' });
    await expect(filas.getByRole('table', { name: 'Itens por fila e estado' })).toBeVisible();
    await expect(filas.getByText(/item aberto mais antigo há 70 min/)).toBeVisible();

    const problemas = page.getByRole('region', { name: 'Itens com problema' });
    await expect(problemas.getByRole('rowheader', { name: ITEM_ID.slice(0, 8) })).toBeVisible();
    await expect(problemas.getByRole('cell', { name: 'provider_503' })).toBeVisible();

    const cron = page.getByRole('region', { name: 'Execuções do Cron' });
    await expect(cron.getByText('erro (job_failed)')).toBeVisible();
    await expect(cron.getByText(/Último ciclo: há 10 min/)).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Webhooks recebidos' }).getByText('resend'),
    ).toBeVisible();
    await expect(page.getByText('42 de 100')).toBeVisible();
    await expect(page.getByText(/Endereços suprimidos.*: 1\./)).toBeVisible();

    // Nada de payload, endereço ou nome na página.
    const text = (await page.locator('main').innerText()).toLowerCase();
    for (const leaked of ['@', 'payload', 'emailmessageid']) expect(text).not.toContain(leaked);
  });

  test('Suporte SEM grant só lê: nenhuma ação aparece', async ({ page }) => {
    await stub(page, SUPPORT_READ);
    await page.goto('/staff/operacao');
    await expect(page.getByText('sem permissão')).toBeVisible();
    await expect(page.getByRole('button', { name: /Reenfileirar/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Pausar|Retomar/ })).toHaveCount(0);
  });

  test('Suporte com "operar fila" vê Reenfileirar mas NÃO pausa fila', async ({ page }) => {
    await stub(page, SUPPORT_OPS);
    await page.goto('/staff/operacao');
    await expect(page.getByRole('button', { name: /Reenfileirar o item/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Pausar/ })).toHaveCount(0);
  });

  test('reenfileirar: pede o motivo, pede reautenticação e depois conclui e atualiza a lista', async ({
    page,
  }) => {
    const state = await stub(page, SUPPORT_OPS);
    await page.goto('/staff/operacao');
    await page.getByRole('button', { name: /Reenfileirar o item/ }).click();
    await page.getByLabel(/Motivo \(vai para a auditoria\)/).fill('o provider voltou ao ar');
    await page.getByRole('button', { name: 'Confirmar' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'confirme primeiro a sua identidade' }),
    ).toBeVisible();
    expect(state.calls[0]).toMatchObject({
      path: `/api/staff/operations/outbox/${ITEM_ID}/requeue`,
      body: { reason: 'o provider voltou ao ar' },
    });

    state.reauthDone = true;
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Item reenfileirado.' })).toBeVisible();
    await expect(page.getByText('Nenhum item com problema.')).toBeVisible();
    await expect(page.getByText('Nenhum alerta no momento.')).toBeVisible();
  });

  test('Admin pausa e retoma a fila com motivo; o estado aparece na tela', async ({ page }) => {
    const state = await stub(page, ADMIN);
    state.reauthDone = true;
    await page.goto('/staff/operacao');
    await page.getByRole('button', { name: 'Pausar a fila geral' }).click();
    await page.getByLabel(/Motivo para pausar a fila geral/).fill('incidente no Resend');
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Fila pausada.' })).toBeVisible();
    expect(state.calls[0]).toMatchObject({
      path: '/api/staff/operations/queues/general/pause',
      body: { paused: true, reason: 'incidente no Resend' },
    });
    await expect(page.getByText(/PAUSADA/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retomar a fila geral' })).toBeVisible();
  });

  test('motivo recusado pelo servidor (400) mostra o aviso e mantém o formulário', async ({
    page,
  }) => {
    await stub(page, SUPPORT_OPS);
    await page.route('**/api/staff/operations/outbox/*/requeue', (route) =>
      route.fulfill({ status: 400, json: { error: { code: 'invalid_request' } } }),
    );
    await page.goto('/staff/operacao');
    await page.getByRole('button', { name: /Reenfileirar o item/ }).click();
    await page.getByLabel(/Motivo \(vai para a auditoria\)/).fill('x');
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Informe o motivo' })).toBeVisible();
    await expect(page.getByLabel(/Motivo \(vai para a auditoria\)/)).toBeVisible();
  });

  test('sem permissão (403) mostra o aviso, sem dados', async ({ page }) => {
    await stub(page, SUPPORT_READ, { status: 403 });
    await page.goto('/staff/operacao');
    await expect(page.getByRole('alert')).toHaveText('Você não tem permissão para ver esta área.');
  });

  test('o item "Operação" aparece no menu da Staff', async ({ page }) => {
    await stub(page, SUPPORT_READ);
    await page.goto('/staff');
    await page
      .getByRole('navigation', { name: 'Área da equipe' })
      .getByRole('link', { name: 'Operação' })
      .click();
    await expect(page).toHaveURL(/\/staff\/operacao$/);
  });

  test('acessibilidade (WCAG 2.2 AA) com dados, no claro e no escuro, e sem rolagem horizontal no celular', async ({
    page,
  }) => {
    await stub(page, ADMIN);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/staff/operacao');
      await expect(page.getByRole('heading', { level: 1, name: 'Operação' })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations, scheme).toEqual([]);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/staff/operacao');
    await expect(page.getByRole('heading', { level: 1, name: 'Operação' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
