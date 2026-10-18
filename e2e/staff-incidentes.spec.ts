import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { IncidentDto } from '../src/features/privacy/incident';

/**
 * Registro de incidentes com dados pessoais (`/staff/incidentes`, M9-06) contra o build de produção, com a API simulada:
 * o aviso de que não se escreve dado pessoal, o formulário, a lista, o pedido de reautenticação, a recusa do servidor por
 * dado pessoal e por encerrar sem decisão, o encerrado somente leitura, e acessibilidade nos dois temas e no celular.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const incident = (overrides: Partial<IncidentDto> = {}): IncidentDto => ({
  id: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  title: 'Segredo exposto em um commit',
  description: 'Uma chave de teste apareceu em um commit e foi trocada no mesmo dia.',
  category: 'exposure',
  dataKinds: ['credentials'],
  affectedCount: 0,
  detectedAt: '2026-10-17T15:30:00.000Z',
  occurredAt: null,
  status: 'open',
  riskAssessment: 'not_assessed',
  communication: 'pending',
  communicatedAt: null,
  actionsTaken: null,
  containedAt: null,
  closedAt: null,
  createdAt: '2026-10-17T15:31:00.000Z',
  updatedAt: '2026-10-17T15:31:00.000Z',
  ...overrides,
});

async function stubAccess(page: Page, capabilities = ['staff.read', 'staff.manage']) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({ json: { roles: ['student', 'admin'], capabilities, recentAuth: true } }),
  );
}

async function stubList(page: Page, items: IncidentDto[]) {
  await page.route('**/api/staff/privacy/incidents', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
    return route.fallback();
  });
}

test('mostra o aviso de que NÃO se escreve dado pessoal e a lista com o estado de cada incidente', async ({
  page,
}) => {
  await stubAccess(page);
  await stubList(page, [
    incident(),
    incident({
      id: 'b',
      title: 'Outro incidente',
      status: 'closed',
      riskAssessment: 'low',
      communication: 'not_required',
      closedAt: '2026-10-18T10:00:00.000Z',
    }),
  ]);
  await page.goto('/staff/incidentes');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Incidentes com dados pessoais' }),
  ).toBeVisible();
  await expect(page.getByText('Não escreva dado pessoal de quem foi afetado')).toBeVisible();
  await expect(page.getByText('não pode ser apagado')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Segredo exposto em um commit' })).toBeVisible();
  // O encerrado é somente leitura; o aberto tem o formulário de atualização.
  await expect(page.getByText('Encerrado: este registro não muda mais.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(1);
});

test('lista vazia mostra o estado vazio', async ({ page }) => {
  await stubAccess(page);
  await stubList(page, []);
  await page.goto('/staff/incidentes');
  await expect(page.getByText('Nenhum incidente registrado.')).toBeVisible();
});

test('registrar: envia o corpo certo (datas em ISO, tipos e dados marcados) e confirma', async ({
  page,
}) => {
  await stubAccess(page);
  let items: IncidentDto[] = [];
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/staff/privacy/incidents', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
    sent = route.request().postDataJSON() as Record<string, unknown>;
    items = [incident({ title: String(sent.title) })];
    return route.fulfill({ status: 201, json: { item: items[0] } });
  });
  await page.goto('/staff/incidentes');
  await page.getByLabel('Título').fill('Backup na pasta errada');
  await page
    .getByLabel('O que aconteceu')
    .fill('Um backup cifrado foi copiado para a pasta errada por duas horas.');
  await page.getByLabel('Tipo').selectOption('misdelivery');
  await page.getByLabel('Credenciais ou sessão').first().check();
  await page.getByLabel('Quantas pessoas (estimativa)').fill('3');
  await page.getByRole('button', { name: 'Registrar incidente' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Incidente registrado.' })).toBeVisible();
  expect(sent).toMatchObject({
    title: 'Backup na pasta errada',
    category: 'misdelivery',
    dataKinds: ['credentials'],
    affectedCount: 3,
    occurredAt: null,
  });
  await expect(page.getByRole('article', { name: 'Backup na pasta errada' })).toBeVisible();
});

test('sem reautenticação recente pede o link de confirmação em vez de registrar', async ({
  page,
}) => {
  await stubAccess(page);
  await page.route('**/api/staff/privacy/incidents', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 403, json: { error: { code: 'reauth_required' } } });
  });
  await page.goto('/staff/incidentes');
  await page.getByLabel('Título').fill('Incidente qualquer');
  await page
    .getByLabel('O que aconteceu')
    .fill('Descrição longa o bastante para passar da validação.');
  await page.getByRole('button', { name: 'Registrar incidente' }).click();
  await expect(page.getByText('confirme primeiro a sua identidade')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar link de confirmação' })).toBeVisible();
});

test('o servidor recusa dado pessoal no texto e a tela explica sem repetir o texto', async ({
  page,
}) => {
  await stubAccess(page);
  await page.route('**/api/staff/privacy/incidents', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 400, json: { error: { code: 'personal_data_in_text' } } });
  });
  await page.goto('/staff/incidentes');
  await page.getByLabel('Título').fill('Vazamento');
  await page
    .getByLabel('O que aconteceu')
    .fill('A conta de alguem foi exposta por duas horas seguidas.');
  await page.getByRole('button', { name: 'Registrar incidente' }).click();
  await expect(page.getByRole('alert')).toContainText('parece conter dado pessoal');
});

test('encerrar sem a decisão registrada: a tela mostra o motivo; a etapa não oferece voltar', async ({
  page,
}) => {
  await stubAccess(page);
  await stubList(page, [
    incident({ status: 'contained', containedAt: '2026-10-17T16:00:00.000Z' }),
  ]);
  await page.route('**/api/staff/privacy/incidents/*', (route) =>
    route.fulfill({ status: 409, json: { error: { code: 'decision_required' } } }),
  );
  await page.goto('/staff/incidentes');
  const etapa = page.getByLabel('Etapa (Segredo exposto em um commit)');
  await expect(etapa.locator('option')).toHaveText(['Contido', 'Encerrado']);
  await etapa.selectOption('closed');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('alert')).toContainText('registre antes a avaliação do risco');
});

test('"Comunicado" pede a data da comunicação', async ({ page }) => {
  await stubAccess(page);
  await stubList(page, [incident()]);
  await page.goto('/staff/incidentes');
  await expect(page.getByLabel('Comunicado em (Segredo exposto em um commit)')).toHaveCount(0);
  await page.getByLabel('Comunicação (Segredo exposto em um commit)').selectOption('communicated');
  await expect(page.getByLabel('Comunicado em (Segredo exposto em um commit)')).toBeVisible();
});

test('sem a permissão (403) mostra o aviso, sem dados', async ({ page }) => {
  await stubAccess(page, ['staff.read']);
  await page.route('**/api/staff/privacy/incidents', (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } }),
  );
  await page.goto('/staff/incidentes');
  await expect(page.getByText('Você não tem permissão para ver esta área.')).toBeVisible();
});

test('o menu NÃO oferece "Incidentes" a quem não tem staff.manage', async ({ page }) => {
  await stubAccess(page, ['staff.read']);
  await page.route('**/api/staff/privacy/incidents', (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } }),
  );
  await page.goto('/staff/incidentes');
  await expect(page.getByText('Você não tem permissão para ver esta área.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Incidentes' })).toHaveCount(0);
});

test('o item "Incidentes" aparece no menu só com staff.manage', async ({ page }) => {
  await stubAccess(page);
  await stubList(page, []);
  await page.goto('/staff/incidentes');
  await expect(page.getByRole('link', { name: 'Incidentes' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`acessibilidade (WCAG 2.2 AA) com dados, no tema ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await stubAccess(page);
    await stubList(page, [
      incident(),
      incident({
        id: 'c',
        title: 'Encerrado',
        status: 'closed',
        riskAssessment: 'relevant',
        communication: 'communicated',
        communicatedAt: '2026-10-18T12:00:00.000Z',
        closedAt: '2026-10-18T13:00:00.000Z',
      }),
    ]);
    await page.goto('/staff/incidentes');
    await expect(page.getByRole('article', { name: 'Segredo exposto em um commit' })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(violations).toEqual([]);
  });
}

test('no celular de 375 px não há rolagem horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubAccess(page);
  await stubList(page, [incident()]);
  await page.goto('/staff/incidentes');
  await expect(page.getByRole('article', { name: 'Segredo exposto em um commit' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
