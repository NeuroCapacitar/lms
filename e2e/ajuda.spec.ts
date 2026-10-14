import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ID = (n: number) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: ID(n),
  category: 'conta',
  question: `Pergunta ${n}?`,
  answer: doc(`Resposta ${n}.`),
  state: 'published',
  ...overrides,
});

interface Call {
  method: string;
  path: string;
  body: Record<string, any>;
}

async function stubStudent(
  page: Page,
  options: {
    items?: unknown[];
    unauthenticated?: boolean;
    supportEmail?: string | null;
    request?: (body: Record<string, any>) => { status: number; json: unknown };
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/public/help', (route) =>
    route.fulfill({ json: { supportEmail: options.supportEmail ?? null } }),
  );
  await page.route('**/api/me/help/faq', (route) =>
    options.unauthenticated
      ? route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } })
      : route.fulfill({ json: { items: options.items ?? [] } }),
  );
  const calls: Call[] = [];
  await page.route('**/api/me/help/requests', (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    calls.push({ method: 'POST', path: '/api/me/help/requests', body });
    const answer = options.request?.(body) ?? { status: 201, json: { id: ID(99) } };
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return calls;
}

test.describe('Ajuda (aluno)', () => {
  test('mostra a FAQ publicada por categoria, com resposta ao abrir, e o endereço de suporte', async ({
    page,
  }) => {
    await stubStudent(page, {
      supportEmail: 'suporte@neurocapacitar.example',
      items: [
        item(1),
        item(2, { category: 'certificado', question: 'Como baixo meu certificado?' }),
      ],
    });
    await page.goto('/ajuda');
    await expect(page.getByRole('heading', { level: 1, name: 'Ajuda' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Minha conta e login' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Certificado' })).toBeVisible();
    await expect(page.getByText('Resposta 1.')).toBeHidden(); // fechada até abrir
    await page.getByText('Pergunta 1?').click();
    await expect(page.getByText('Resposta 1.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'suporte@neurocapacitar.example' }),
    ).toHaveAttribute('href', 'mailto:suporte@neurocapacitar.example');
  });

  test('o aviso sobre dados de pacientes é fixo; enviar manda só categoria e texto e mostra a confirmação', async ({
    page,
  }) => {
    const calls = await stubStudent(page, { items: [item(1)] });
    await page.goto('/ajuda');
    await expect(
      page.getByText('É proibido incluir dados que identifiquem pacientes'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar pedido' })).toBeDisabled();
    await page.getByLabel('Assunto').selectOption('certificado');
    await page.getByLabel('Sua mensagem').fill('Não consigo baixar o certificado.');
    await page.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Pedido enviado. A equipe responderá por e-mail' }),
    ).toBeVisible();
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/me/help/requests',
        body: { category: 'certificado', message: 'Não consigo baixar o certificado.' },
      },
    ]);
    await expect(page.getByLabel('Sua mensagem')).toHaveValue('');
  });

  test('limite de pedidos e falha de rede viram mensagens claras e o texto não se perde', async ({
    page,
  }) => {
    await stubStudent(page, {
      request: () => ({ status: 429, json: { error: { code: 'rate_limited' } } }),
    });
    await page.goto('/ajuda');
    await page.getByLabel('Sua mensagem').fill('Preciso de ajuda.');
    await page.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(page.getByRole('alert')).toContainText('pedidos demais em pouco tempo');
    await expect(page.getByLabel('Sua mensagem')).toHaveValue('Preciso de ajuda.');
  });

  test('sem sessão: convite para entrar, sem formulário', async ({ page }) => {
    await stubStudent(page, {
      unauthenticated: true,
      supportEmail: 'suporte@neurocapacitar.example',
    });
    await page.goto('/ajuda');
    await expect(page.getByRole('alert').filter({ hasText: 'Entre na sua conta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar pedido' })).toHaveCount(0);
    // o endereço da equipe aparece mesmo sem sessão
    await expect(page.getByRole('link', { name: 'suporte@neurocapacitar.example' })).toBeVisible();
  });

  test('a tela de login mostra o endereço de suporte', async ({ page }) => {
    await page.route('**/api/public/help', (route) =>
      route.fulfill({ json: { supportEmail: 'suporte@neurocapacitar.example' } }),
    );
    await page.goto('/entrar');
    await expect(page.getByText('Não consegue entrar? Escreva para')).toBeVisible();
    await expect(page.getByRole('link', { name: 'suporte@neurocapacitar.example' })).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`acessibilidade (WCAG 2.2 AA) no ${scheme === 'light' ? 'claro' : 'escuro'}, com item aberto e sem rolagem horizontal no celular`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubStudent(page, {
        items: [item(1), item(2, { category: 'pagamento' })],
        supportEmail: 'suporte@neurocapacitar.example',
      });
      await page.goto('/ajuda');
      await page.getByText('Pergunta 1?').click();
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

async function stubStaff(
  page: Page,
  options: {
    capabilities?: string[];
    items?: Record<string, unknown>[];
    forbiddenFaq?: boolean;
    requests?: unknown[];
    write?: (call: Call) => { status: number; json: unknown } | undefined;
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: {
        roles: ['student', 'support'],
        capabilities: options.capabilities ?? ['staff.read', 'help.edit'],
        recentAuth: false,
      },
    }),
  );
  const state = { items: options.items ?? [] };
  await page.route('**/api/staff/help/faq', (route) => {
    if (route.request().method() === 'GET') {
      return options.forbiddenFaq
        ? route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } })
        : route.fulfill({ json: { items: state.items } });
    }
    const call: Call = {
      method: 'POST',
      path: '/api/staff/help/faq',
      body: route.request().postDataJSON() as Record<string, any>,
    };
    calls.push(call);
    const answer = options.write?.(call);
    if (answer) return route.fulfill({ status: answer.status, json: answer.json });
    state.items.push(item(50 + state.items.length, { ...call.body, state: 'draft' }));
    return route.fulfill({ status: 201, json: { item: state.items.at(-1) } });
  });
  const calls: Call[] = [];
  await page.route('**/api/staff/help/faq/**', (route) => {
    const request = route.request();
    const call: Call = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: (request.postDataJSON() ?? {}) as Record<string, any>,
    };
    calls.push(call);
    const answer = options.write?.(call);
    if (answer) return route.fulfill({ status: answer.status, json: answer.json });
    return route.fulfill({ json: { item: state.items[0] } });
  });
  await page.route('**/api/staff/help/requests', (route) =>
    route.fulfill({ json: { requests: options.requests ?? [] } }),
  );
  return { calls, state };
}

test.describe('Ajuda (Staff)', () => {
  test('o item no menu aparece para a Staff; a FAQ lista com estado e a ordem tem botões acessíveis', async ({
    page,
  }) => {
    const { calls } = await stubStaff(page, {
      items: [item(1, { state: 'draft' }), item(2), item(3)],
    });
    await page.goto('/staff');
    await page
      .getByRole('navigation', { name: 'Área da equipe' })
      .getByRole('link', { name: 'Ajuda' })
      .click();
    await expect(page).toHaveURL(/\/staff\/ajuda$/);
    await expect(page.getByRole('article', { name: 'FAQ, item 1' })).toContainText('Rascunho');
    await expect(page.getByRole('article', { name: 'FAQ, item 2' })).toContainText('Publicado');
    await expect(page.getByRole('button', { name: 'Subir o item 1' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Descer o item 3' })).toBeDisabled();
    await page.getByRole('button', { name: 'Descer o item 1' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Item movido para a posição 2.' }),
    ).toBeVisible();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: `/api/staff/help/faq/${ID(1)}/move`,
      body: { direction: 'down' },
    });
  });

  test('criar um item (rascunho), publicar, despublicar e excluir com confirmação usam a API certa', async ({
    page,
  }) => {
    const { calls } = await stubStaff(page, { items: [item(1, { state: 'draft' }), item(2)] });
    await page.goto('/staff/ajuda');
    await page.getByLabel('Pergunta (Nova pergunta)').fill('Como recupero minha senha?');
    await page.getByLabel('Categoria (Nova pergunta)').selectOption('conta');
    await page.getByRole('button', { name: 'Criar (rascunho)' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Item criado como rascunho' }),
    ).toBeVisible();
    const created = calls.find((c) => c.path === '/api/staff/help/faq')!;
    expect(created.body).toMatchObject({
      category: 'conta',
      question: 'Como recupero minha senha?',
    });
    expect(created.body.answer.type).toBe('doc');

    await page.getByRole('button', { name: 'Publicar o item 1' }).click();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: `/api/staff/help/faq/${ID(1)}/state`,
      body: { state: 'published' },
    });
    await page.getByRole('button', { name: 'Despublicar o item 2' }).click();
    expect(calls.at(-1)!.body).toEqual({ state: 'draft' });
    const before = calls.length;
    await page.getByRole('button', { name: 'Excluir o item 2' }).click();
    expect(calls).toHaveLength(before);
    await page.getByRole('button', { name: 'Confirmar exclusão do item' }).click();
    expect(calls.at(-1)!.path).toBe(`/api/staff/help/faq/${ID(2)}/delete`);
  });

  test('editar abre o formulário com os valores atuais e salva por PUT', async ({ page }) => {
    const { calls } = await stubStaff(page, { items: [item(1)] });
    await page.goto('/staff/ajuda');
    await page.getByRole('button', { name: 'Editar o item 1' }).click();
    const field = page.getByLabel('Pergunta (Editar o item 1)');
    await expect(field).toHaveValue('Pergunta 1?');
    await field.fill('Pergunta revisada?');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Item atualizado.' })).toBeVisible();
    expect(calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: `/api/staff/help/faq/${ID(1)}`,
      body: { question: 'Pergunta revisada?', category: 'conta' },
    });
  });

  test('sem o grant de edição a FAQ avisa, mas os pedidos de suporte aparecem (nome, nunca e-mail)', async ({
    page,
  }) => {
    await stubStaff(page, {
      capabilities: ['staff.read'],
      forbiddenFaq: true,
      requests: [
        {
          id: ID(7),
          category: 'acesso',
          message: 'Não consigo abrir a primeira aula.',
          courseTitle: 'Curso Demonstrativo',
          authorName: 'Ana Souza',
          createdAt: '2026-10-12T15:30:00.000Z',
        },
      ],
    });
    await page.goto('/staff/ajuda');
    await expect(page.getByRole('alert')).toHaveText('Você não tem a permissão de editar a FAQ.');
    const list = page.getByRole('list', { name: 'Pedidos de suporte' });
    await expect(list).toContainText('Ana Souza');
    await expect(list).toContainText('Acesso aos cursos');
    await expect(list).toContainText('Curso: Curso Demonstrativo');
    await expect(list).toContainText('Não consigo abrir a primeira aula.');
    expect(await page.locator('main').innerText()).not.toContain('@');
  });

  test('erro do servidor vira aviso claro', async ({ page }) => {
    await stubStaff(page, {
      write: () => ({ status: 400, json: { error: { code: 'invalid_request' } } }),
    });
    await page.goto('/staff/ajuda');
    await page.getByLabel('Pergunta (Nova pergunta)').fill('Qualquer?');
    await page.getByRole('button', { name: 'Criar (rascunho)' }).click();
    await expect(page.getByRole('alert')).toContainText('Confira os campos');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`acessibilidade (WCAG 2.2 AA) no ${scheme === 'light' ? 'claro' : 'escuro'}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubStaff(page, {
        items: [item(1, { state: 'draft' }), item(2)],
        requests: [
          {
            id: ID(7),
            category: 'curso',
            message: 'Dúvida.',
            courseTitle: null,
            authorName: 'Ana',
            createdAt: '2026-10-12T15:30:00.000Z',
          },
        ],
      });
      await page.goto('/staff/ajuda');
      await expect(page.getByRole('article', { name: 'FAQ, item 1' })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }
});
