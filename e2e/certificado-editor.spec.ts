import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { defaultLayout } from '../src/features/certificate/layout.ts';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '00000000-0000-4000-8000-000000000c01';

interface Call {
  method: string;
  path: string;
  body: Record<string, any>;
}

async function stubEditor(
  page: Page,
  options: {
    forbidden?: boolean;
    draft?: Record<string, unknown> | null;
    published?: Record<string, unknown> | null;
    saveStatus?: { status: number; json: unknown };
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
  await page.route('**/api/staff/courses/*/certificate/signatory', (route) =>
    route.fulfill({ json: { signatory: null } }),
  );
  const calls: Call[] = [];
  const dto = (status: string, version: number) => ({
    id: `00000000-0000-4000-8000-0000000000${status === 'draft' ? '0d' : '0e'}`,
    status,
    layout: defaultLayout(),
    backgroundMediaId: null,
    version,
    publishedAt: status === 'draft' ? null : '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-14T12:00:00.000Z',
  });
  let version = options.draft ? (options.draft.version as number) : 0;
  await page.route('**/api/staff/courses/*/certificate/template**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (options.forbidden) {
      return route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } });
    }
    if (request.method() === 'GET') {
      return route.fulfill({
        json: {
          draft: options.draft === undefined ? null : options.draft,
          published: options.published ?? null,
        },
      });
    }
    const body = (request.postDataJSON() ?? {}) as Record<string, any>;
    calls.push({ method: request.method(), path, body });
    if (options.saveStatus) {
      return route.fulfill({ status: options.saveStatus.status, json: options.saveStatus.json });
    }
    if (path.endsWith('/publish')) {
      return route.fulfill({ json: { published: dto('published', 1) } });
    }
    if (path.endsWith('/discard')) return route.fulfill({ json: { discarded: true } });
    version += 1;
    return route.fulfill({
      json: { draft: { ...dto('draft', version), layout: body.layout } },
    });
  });
  return { calls };
}

const field = (page: Page, id: string) => page.locator(`[data-field="${id}"]`);
const panel = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const pageBox = (page: Page) => page.getByTestId('certificate-page');

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/staff/certificados/${COURSE_ID}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Template do certificado' }),
  ).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Campo selecionado' })).toBeVisible();
}

test.describe('editor do template do certificado (M7-03)', () => {
  test('sem permissão (403) avisa e não mostra o editor', async ({ page }) => {
    await stubEditor(page, { forbidden: true });
    await page.goto(`/staff/certificados/${COURSE_ID}`);
    await expect(page.getByRole('alert')).toHaveText('Só o Admin edita o template do certificado.');
    await expect(page.getByTestId('certificate-page')).toHaveCount(0);
  });

  test('começa pelo modelo padrão, com todos os campos e sem avisos', async ({ page }) => {
    await stubEditor(page);
    await open(page);
    for (const id of [
      'title',
      'intro',
      'holderName',
      'body',
      'signature',
      'signatory',
      'issuer',
      'qr',
      'code',
    ]) {
      await expect(field(page, id)).toHaveCount(1);
    }
    await expect(page.getByText('Nenhum problema encontrado.')).toBeVisible();
    await expect(page.getByText('Ainda não há template publicado')).toBeVisible();
  });

  test('painel numérico (alternativa a arrastar): muda a posição, atualiza o nome acessível e salva o rascunho', async ({
    page,
  }) => {
    const { calls } = await stubEditor(page);
    await open(page);
    await field(page, 'holderName').click();
    await panel(page, 'Esquerda (mm)').fill('40');
    await expect(field(page, 'holderName')).toHaveAttribute('aria-label', /40 mm da esquerda/);
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Rascunho salvo (versão 1)' }),
    ).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      body: { backgroundMediaId: null, expectedVersion: null },
    });
    const saved = calls[0]!.body.layout.fields.find((item: any) => item.id === 'holderName');
    expect(saved.x).toBe(40);
  });

  test('só com teclado: setas movem 1 mm, Shift 5 mm, Alt redimensiona; Ctrl+Z desfaz e Ctrl+Y refaz', async ({
    page,
  }) => {
    await stubEditor(page);
    await open(page);
    const target = field(page, 'holderName');
    await target.focus();
    await expect(panel(page, 'Esquerda (mm)')).toHaveValue('22');
    await page.keyboard.press('ArrowRight');
    await expect(panel(page, 'Esquerda (mm)')).toHaveValue('23');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(panel(page, 'Topo (mm)')).toHaveValue('59');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(panel(page, 'Largura (mm)')).toHaveValue('254');
    await page.keyboard.press('Control+z');
    await expect(panel(page, 'Largura (mm)')).toHaveValue('253');
    await page.keyboard.press('Control+y');
    await expect(panel(page, 'Largura (mm)')).toHaveValue('254');
    await expect(page.getByText('Desfazer', { exact: true })).toHaveCount(1);
  });

  test('só com ponteiro: arrastar o campo move em milímetros e redimensionar pela alça muda a largura', async ({
    page,
  }) => {
    await stubEditor(page);
    await open(page);
    const box = (await pageBox(page).boundingBox())!;
    const unit = box.width / 297;
    const target = field(page, 'holderName');
    const rect = (await target.boundingBox())!;
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + unit * 10, startY + unit * 4, { steps: 5 });
    await page.mouse.up();
    const x = Number(await panel(page, 'Esquerda (mm)').inputValue());
    const y = Number(await panel(page, 'Topo (mm)').inputValue());
    expect(x).toBeGreaterThanOrEqual(31);
    expect(x).toBeLessThanOrEqual(33);
    expect(y).toBeGreaterThanOrEqual(57);
    expect(y).toBeLessThanOrEqual(59);

    const handle = page.locator('[data-resize="holderName"]');
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 - unit * 20, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.up();
    const width = Number(await panel(page, 'Largura (mm)').inputValue());
    expect(width).toBeLessThan(253);
    expect(width).toBeGreaterThan(228);
  });

  test('campo fora da página é ERRO: aparece na lista e a publicação fica desabilitada até corrigir', async ({
    page,
  }) => {
    await stubEditor(page);
    await open(page);
    await field(page, 'title').click();
    await panel(page, 'Esquerda (mm)').fill('200');
    await expect(page.getByText('Erro: Título está fora da página.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    await expect(page.getByText('Corrija os erros para publicar.')).toBeVisible();
    await panel(page, 'Esquerda (mm)').fill('22');
    await expect(page.getByText('Nenhum problema encontrado.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeEnabled();
  });

  test('sobreposição e texto que não cabe são AVISOS e a publicação continua liberada', async ({
    page,
  }) => {
    await stubEditor(page);
    await open(page);
    await field(page, 'intro').click();
    await panel(page, 'Topo (mm)').fill('56');
    await expect(page.getByText(/Aviso: Abertura se sobrepõe a Nome do titular\./)).toBeVisible();
    await field(page, 'holderName').click();
    await panel(page, 'Altura (mm)').fill('8');
    await panel(page, 'Largura (mm)').fill('40');
    await expect(
      page.getByText(/Aviso: Nome do titular não cabe com o nome mais longo\./),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeEnabled();
  });

  test('publicar salva o rascunho e publica com a versão salva', async ({ page }) => {
    const { calls } = await stubEditor(page);
    await open(page);
    await field(page, 'title').click();
    await panel(page, 'Topo (mm)').fill('22');
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Template publicado.' })).toBeVisible();
    expect(calls.map((call) => `${call.method} ${call.path.split('/').slice(-1)[0]}`)).toEqual([
      'PUT template',
      'POST publish',
    ]);
    expect(calls[1]!.body).toEqual({ expectedVersion: 1 });
  });

  test('conflito de versão (outro Admin salvou antes): mensagem clara e nada some da tela', async ({
    page,
  }) => {
    await stubEditor(page, {
      saveStatus: { status: 409, json: { error: { code: 'conflict', currentVersion: 4 } } },
    });
    await open(page);
    await field(page, 'title').click();
    await panel(page, 'Topo (mm)').fill('22');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByRole('alert')).toContainText('Outro Admin alterou este rascunho');
    await expect(panel(page, 'Topo (mm)')).toHaveValue('22');
  });

  test('em tela estreita o editor é só leitura: sem painel, sem botões de edição e sem rolagem horizontal', async ({
    page,
  }) => {
    await stubEditor(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/staff/certificados/${COURSE_ID}`);
    await expect(page.getByRole('note')).toContainText('só mostra o layout');
    await expect(page.getByRole('complementary', { name: 'Campo selecionado' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Salvar rascunho' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desfazer' })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`sem violações de acessibilidade (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubEditor(page);
      await open(page);
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }
});
