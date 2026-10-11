import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function open(page: Page) {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto('/texto-rico');
  const editor = page.getByRole('textbox', { name: 'Conteúdo de exemplo' });
  await editor.waitFor();
  return { editor, dialogs };
}

const jsonOf = async (page: Page) =>
  JSON.parse((await page.getByTestId('json').textContent()) ?? 'null');
const tool = (page: Page, name: string) =>
  page
    .getByRole('toolbar', { name: 'Formatação do texto' })
    .getByRole('button', { name, exact: true });

/** Clica numa ferramenta e espera o foco voltar ao editor (o `focus()` do Tiptap é assíncrono). */
async function apply(page: Page, name: string) {
  await tool(page, name).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo de exemplo' })).toBeFocused();
}

test.describe('editor de texto rico (/texto-rico)', () => {
  test('digita, aplica negrito, título e lista; o JSON só tem nós e marcas da allowlist', async ({
    page,
  }) => {
    const { editor } = await open(page);
    await editor.click();
    await page.keyboard.type('Olá ');
    await apply(page, 'Negrito');
    await expect(tool(page, 'Negrito')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('forte');
    await apply(page, 'Negrito');
    await page.keyboard.type(' fim');
    await page.keyboard.press('Enter');
    await apply(page, 'Título 2');
    await page.keyboard.type('Um título');
    await page.keyboard.press('Enter');
    await apply(page, 'Lista');
    await page.keyboard.type('primeiro item');

    const preview = page.getByTestId('preview');
    await expect(preview.locator('strong')).toHaveText('forte');
    await expect(preview.locator('h2')).toHaveText('Um título');
    await expect(preview.locator('ul li')).toHaveText('primeiro item');

    // só depois de a tela refletir tudo: o JSON tem SÓ nós e marcas da allowlist
    const collect = (node: unknown, found = new Set<string>()): Set<string> => {
      if (Array.isArray(node)) node.forEach((item) => collect(item, found));
      else if (node && typeof node === 'object') {
        const { type, content, marks } = node as {
          type?: string;
          content?: unknown;
          marks?: unknown;
        };
        if (type) found.add(type);
        collect(content, found);
        collect(marks, found);
      }
      return found;
    };
    expect(collect(await jsonOf(page))).toEqual(
      new Set(['doc', 'paragraph', 'text', 'bold', 'heading', 'bulletList', 'listItem']),
    );
  });

  test('link: só http, https e mailto; externo abre com rel seguro; esquema perigoso é recusado', async ({
    page,
  }) => {
    const { editor } = await open(page);
    await editor.click();
    await page.keyboard.type('visite o site');
    await page.keyboard.press('Shift+ArrowLeft');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowLeft');
    await tool(page, 'Link').click();
    await page.getByLabel('Endereço do link').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Aplicar link' }).click();
    await expect(page.getByText('Use um endereço que comece com')).toBeVisible();
    expect(JSON.stringify(await jsonOf(page))).not.toContain('javascript');
    await expect(page.getByTestId('preview').locator('a')).toHaveCount(0);

    await page.getByLabel('Endereço do link').fill('https://example.com/pagina');
    await page.getByRole('button', { name: 'Aplicar link' }).click();
    const link = page.getByTestId('preview').locator('a');
    await expect(link).toHaveAttribute('href', 'https://example.com/pagina');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(link).toHaveAttribute('target', '_blank');
    const doc = await jsonOf(page);
    expect(JSON.stringify(doc)).toContain('"href":"https://example.com/pagina"');
  });

  test('HTML e scripts digitados aparecem como TEXTO: nada executa e nenhum elemento é criado', async ({
    page,
  }) => {
    const { editor, dialogs } = await open(page);
    await editor.click();
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg onload=alert(1)>',
    ];
    for (const payload of payloads) {
      await page.keyboard.type(payload);
      await page.keyboard.press('Enter');
    }
    const preview = page.getByTestId('preview');
    for (const payload of payloads) await expect(preview).toContainText(payload);
    expect(await preview.locator('script, img, svg, iframe, [onerror], [onload]').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test('ida e volta: o JSON do editor, colado, produz exatamente a mesma visualização', async ({
    page,
  }) => {
    const { editor } = await open(page);
    await editor.click();
    await page.keyboard.type('Texto ');
    await apply(page, 'Itálico');
    await page.keyboard.type('inclinado');
    await apply(page, 'Itálico');
    await page.keyboard.press('Enter');
    await apply(page, 'Citação');
    await page.keyboard.type('uma citação');
    await expect(page.getByTestId('preview')).toContainText('uma citação');
    await expect(page.getByTestId('preview').locator('blockquote')).toBeVisible();
    const json = await page.getByTestId('json').textContent();
    await page.getByLabel('JSON do documento').fill(json ?? '');
    const original = await page.getByTestId('preview').innerHTML();
    const pasted = await page.getByTestId('pasted-preview').innerHTML();
    expect(pasted).toBe(original);
    expect(original).toContain('<em>inclinado</em>');
    expect(original).toContain('<blockquote');
  });

  test('corpus de XSS em JSON: o que sai da allowlist não é exibido (e o aviso aparece)', async ({
    page,
  }) => {
    const { dialogs } = await open(page);
    const doc = (...content: unknown[]) => JSON.stringify({ type: 'doc', content });
    const p = (...content: unknown[]) => ({ type: 'paragraph', content });
    const text = (value: string, marks?: unknown[]) => ({
      type: 'text',
      text: value,
      ...(marks ? { marks } : {}),
    });
    const link = (href: string, extra: object = {}) =>
      text('clique', [{ type: 'link', attrs: { href, ...extra } }]);
    const corpus = [
      doc(p(link('javascript:alert(1)'))),
      doc(p(link('JaVaScRiPt:alert(1)'))),
      doc(p(link('data:text/html,<script>alert(1)</script>'))),
      doc(p(link('https://example.com', { onclick: 'alert(1)' }))),
      doc({ type: 'image', attrs: { src: 'x', onerror: 'alert(1)' } }),
      doc({ type: 'codeBlock', content: [text('<b>x</b>')] }),
      JSON.stringify('<img src=x onerror=alert(1)>'),
      '<script>alert(1)</script>',
      '{ isto não é JSON',
    ];
    const area = page.getByLabel('JSON do documento');
    for (const item of corpus) {
      await area.fill(item);
      await expect(page.getByText('Documento inválido: há algo fora da allowlist')).toBeVisible();
      const shown = page.getByTestId('pasted-preview');
      expect(await shown.locator('a, img, script, svg, iframe').count(), item).toBe(0);
      expect((await shown.textContent())?.trim(), item).toBe('');
    }
    // e um documento VÁLIDO com HTML como texto é exibido como texto
    await area.fill(doc(p(text('<script>alert(1)</script>'), link('https://example.com'))));
    await expect(page.getByText('Documento inválido')).toHaveCount(0);
    const shown = page.getByTestId('pasted-preview');
    await expect(shown).toContainText('<script>alert(1)</script>');
    expect(await shown.locator('script').count()).toBe(0);
    await expect(shown.locator('a')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test('só com teclado: a barra de ferramentas é alcançável e o editor tem rótulo', async ({
    page,
  }) => {
    const { editor } = await open(page);
    await expect(editor).toHaveAttribute('aria-multiline', 'true');
    await page.getByRole('link', { name: 'Início' }).focus();
    let reached = false;
    for (let i = 0; i < 20 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await tool(page, 'Negrito').evaluate(
        (element) => element === document.activeElement,
      );
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Space');
    await expect(tool(page, 'Negrito')).toHaveAttribute('aria-pressed', 'true');
  });

  test('nenhuma violação de CSP (o Tiptap não injeta <style>)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    const { editor } = await open(page);
    await editor.click();
    await page.keyboard.type('Digitando com a CSP ligada');
    await apply(page, 'Negrito');
    await apply(page, 'Lista');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações em /texto-rico (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const { editor } = await open(page);
      await editor.click();
      await page.keyboard.type('Conteúdo para a verificação de acessibilidade');
      await apply(page, 'Título 2');
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        `violações axe em /texto-rico (${scheme})`,
      ).toEqual([]);
    });
  }
});
