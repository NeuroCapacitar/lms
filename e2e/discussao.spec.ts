import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const LESSON = '00000000-0000-4000-8000-000000000001';
const P = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const textLesson = {
  course: { id: COURSE_ID, title: 'Curso Demonstrativo' },
  lesson: { id: LESSON, title: 'Aula com discussão', isOptional: false, body: doc('Conteúdo.') },
  completed: false,
  previous: null,
  next: null,
};

const post = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: P(n),
  authorName: 'Ana Souza',
  authorRole: 'student',
  body: `Mensagem ${n}`,
  createdAt: '2026-10-12T15:30:00.000Z',
  editedAt: null,
  mine: false,
  ...overrides,
});

interface Call {
  method: string;
  path: string;
  body: Record<string, any>;
}

async function stub(
  page: Page,
  options: {
    threads?: () => unknown[];
    write?: (call: Call) => { status: number; json: unknown } | undefined;
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      json: {
        displayName: 'Bia',
        certificateName: null,
        certificateNameConfirmedAt: null,
        theme: 'system',
        autoAdvance: false,
      },
    }),
  );
  await page.route('**/api/lessons/*', (route) => route.fulfill({ json: textLesson }));
  await page.route('**/api/courses/*/outline', (route) => route.fulfill({ status: 404, json: {} }));
  const calls: Call[] = [];
  await page.route('**/api/lessons/*/discussion', (route) =>
    route.fulfill({ json: { threads: options.threads?.() ?? [] } }),
  );
  await page.route('**/api/lessons/*/discussion/posts**', (route) => {
    const request = route.request();
    const call: Call = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: (request.postDataJSON() ?? {}) as Record<string, any>,
    };
    calls.push(call);
    const answer = options.write?.(call) ?? {
      status: 201,
      json: { post: post(99, { mine: true, authorName: 'Bia' }) },
    };
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return calls;
}

const open = async (page: Page) => {
  await page.goto(`/estudar/${COURSE_ID}/aulas/${LESSON}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Aula com discussão' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Discussão' })).toBeVisible();
};

const conversation = () => [
  {
    post: post(1, { body: 'Como funciona a liberação?' }),
    replies: [
      post(2, { authorName: 'Dra. Admin', authorRole: 'staff', body: 'Por módulo, em D+N.' }),
      post(3, { authorName: 'Bia', mine: true, body: 'Obrigada!' }),
    ],
  },
  {
    post: post(4, { body: null, placeholder: 'hidden' }),
    replies: [post(5, { body: 'Resposta órfã' })],
  },
];

test.describe('discussão da aula (aluno)', () => {
  test('mostra o aviso fixo sobre dados de pacientes e o estado vazio', async ({ page }) => {
    await stub(page);
    await open(page);
    await expect(
      page.getByText('É proibido incluir dados que identifiquem pacientes'),
    ).toBeVisible();
    await expect(page.getByText('Ainda não há mensagens nesta aula.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar pergunta' })).toBeDisabled();
  });

  test('publica uma pergunta e mostra o texto como TEXTO (HTML não é interpretado)', async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const calls = await stub(page);
    await open(page);
    const xss = '<img src=x onerror=alert(1)> **negrito**';
    await page.getByLabel('Escreva sua pergunta').fill(xss);
    await expect(page.getByText(`${xss.length} de 2000 caracteres`)).toBeVisible();
    await page.getByRole('button', { name: 'Publicar pergunta' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pergunta publicada.' })).toBeVisible();
    expect(calls).toEqual([
      { method: 'POST', path: `/api/lessons/${LESSON}/discussion/posts`, body: { body: xss } },
    ]);
    await expect(page.getByLabel('Escreva sua pergunta')).toHaveValue('');
    expect(await page.locator('main img').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('conversa: nomes, marca Equipe, mensagem removida no lugar e ações só onde cabem', async ({
    page,
  }) => {
    await stub(page, { threads: conversation });
    await open(page);
    const first = page.getByRole('article', { name: /Mensagem de Ana Souza/ }).first();
    await expect(first).toContainText('Como funciona a liberação?');
    await expect(page.getByText('Equipe', { exact: true })).toBeVisible();
    await expect(page.getByText('Por módulo, em D+N.')).toBeVisible();
    await expect(page.getByText('Mensagem removida pela moderação.')).toBeVisible();
    await expect(page.getByText('Resposta órfã')).toBeVisible();
    // da pessoa: editar e excluir; dos outros: denunciar
    await expect(page.getByRole('button', { name: 'Editar a mensagem de Bia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Excluir a mensagem de Bia' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Denunciar a mensagem de Ana Souza' }).first(),
    ).toBeVisible();
    // não há "Responder" na mensagem removida; há na conversa normal
    await expect(page.getByRole('button', { name: /Responder a Ana Souza/ })).toHaveCount(1);
  });

  test('responder envia o parentId; editar usa PATCH; excluir e denunciar pedem confirmação', async ({
    page,
  }) => {
    const calls = await stub(page, { threads: conversation });
    await open(page);
    await page.getByRole('button', { name: 'Responder a Ana Souza' }).click();
    await page.getByLabel('Sua resposta a Ana Souza').fill('Concordo.');
    await page.getByRole('button', { name: 'Publicar resposta' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Resposta publicada.' })).toBeVisible();
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      body: { body: 'Concordo.', parentId: P(1) },
    });

    await page.getByRole('button', { name: 'Editar a mensagem de Bia' }).click();
    await page.getByLabel('Editar a mensagem de Bia').fill('Obrigada, entendi!');
    await page.getByRole('button', { name: 'Salvar alteração' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Mensagem alterada.' })).toBeVisible();
    expect(calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: `/api/lessons/${LESSON}/discussion/posts/${P(3)}`,
      body: { body: 'Obrigada, entendi!' },
    });

    const before = calls.length;
    await page.getByRole('button', { name: 'Excluir a mensagem de Bia' }).click();
    expect(calls).toHaveLength(before); // só pediu confirmação
    await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Mensagem excluída.' })).toBeVisible();
    expect(calls.at(-1)!.path).toBe(`/api/lessons/${LESSON}/discussion/posts/${P(3)}/delete`);

    await page.getByRole('button', { name: 'Denunciar a mensagem de Ana Souza' }).first().click();
    await page.getByRole('button', { name: 'Confirmar denúncia' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Denúncia enviada à equipe.' }),
    ).toBeVisible();
    expect(calls.at(-1)!.path).toBe(`/api/lessons/${LESSON}/discussion/posts/${P(1)}/report`);
  });

  test('erros do servidor viram mensagens claras (limite de frequência, conexão)', async ({
    page,
  }) => {
    let code = 'rate_limited';
    await stub(page, {
      write: () => ({ status: code === 'rate_limited' ? 429 : 403, json: { error: { code } } }),
    });
    await open(page);
    await page.getByLabel('Escreva sua pergunta').fill('Pergunta');
    await page.getByRole('button', { name: 'Publicar pergunta' }).click();
    await expect(page.getByRole('alert')).toContainText('muitas mensagens ou denúncias');
    // o texto digitado não se perde no erro
    await expect(page.getByLabel('Escreva sua pergunta')).toHaveValue('Pergunta');
    code = 'access_denied';
    await page.getByRole('button', { name: 'Publicar pergunta' }).click();
    await expect(page.getByRole('alert')).toContainText('não permite participar');
  });

  test('na prévia da Staff a discussão não aparece', async ({ page }) => {
    await stub(page);
    await page.route('**/api/staff/preview/courses/*/lessons/*', (route) =>
      route.fulfill({ json: { ...textLesson, preview: true } }),
    );
    await page.route('**/api/me/access', (route) =>
      route.fulfill({
        json: { roles: ['student', 'admin'], capabilities: ['staff.read'], recentAuth: false },
      }),
    );
    await page.goto(`/staff/previa/${COURSE_ID}/aulas/${LESSON}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Aula com discussão' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Discussão' })).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`acessibilidade (WCAG 2.2 AA) no ${scheme === 'light' ? 'claro' : 'escuro'}, com respostas abertas e sem rolagem horizontal no celular`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stub(page, { threads: conversation });
      await open(page);
      await page.getByRole('button', { name: 'Responder a Ana Souza' }).click();
      await page.getByRole('button', { name: 'Editar a mensagem de Bia' }).click();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (item) => `${item.id}: ${item.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
      await page.setViewportSize({ width: 375, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
});

/* ---------------- Staff ---------------- */

const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: P(n),
  lessonId: LESSON,
  lessonTitle: 'Boas-vindas',
  courseTitle: 'Curso Demonstrativo',
  authorName: 'Ana Souza',
  authorRole: 'student',
  state: 'visible',
  isReply: false,
  body: `Texto da mensagem ${n}`,
  createdAt: '2026-10-12T15:30:00.000Z',
  openReports: 0,
  staffReplies: 0,
  ...overrides,
});

async function staffStub(
  page: Page,
  options: {
    capabilities?: string[];
    reported?: unknown[];
    unanswered?: unknown[];
    forbidden?: boolean;
    write?: (
      path: string,
      body: Record<string, any>,
    ) => { status: number; json: unknown } | undefined;
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({
      json: {
        roles: ['student', 'support'],
        capabilities: options.capabilities ?? ['staff.read', 'discussion.moderate'],
        recentAuth: false,
      },
    }),
  );
  await page.route('**/api/staff/discussions?*', (route) => {
    if (options.forbidden) {
      return route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } });
    }
    const view = new URL(route.request().url()).searchParams.get('view');
    return route.fulfill({
      json: {
        view,
        items: view === 'unanswered' ? (options.unanswered ?? []) : (options.reported ?? []),
      },
    });
  });
  const calls: { path: string; body: Record<string, any> }[] = [];
  await page.route('**/api/staff/discussions/posts/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, any>;
    calls.push({ path, body });
    const answer = options.write?.(path, body) ?? { status: 200, json: { state: 'hidden' } };
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return calls;
}

test.describe('moderação das discussões (Staff)', () => {
  test('o item no menu só aparece com o grant; sem ele a rota avisa', async ({ page }) => {
    await staffStub(page, { capabilities: ['staff.read'], forbidden: true });
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: 'Área da equipe' });
    await expect(nav.getByRole('link', { name: 'Discussões' })).toHaveCount(0);
    await page.goto('/staff/discussoes');
    await expect(page.getByRole('alert')).toHaveText(
      'Você não tem a permissão de moderar discussões.',
    );
  });

  test('com o grant: o item aparece, a fila mostra o contexto, e ocultar exige motivo', async ({
    page,
  }) => {
    const calls = await staffStub(page, {
      reported: [item(1, { openReports: 2, body: 'Contém o nome de um paciente' })],
    });
    await page.goto('/staff');
    await page
      .getByRole('navigation', { name: 'Área da equipe' })
      .getByRole('link', { name: 'Discussões' })
      .click();
    await expect(page).toHaveURL(/\/staff\/discussoes$/);
    const article = page.getByRole('article', { name: /Mensagem de Ana Souza/ });
    await expect(article).toContainText('Curso Demonstrativo › Boas-vindas');
    await expect(article).toContainText('Contém o nome de um paciente');
    await expect(article).toContainText('2 denúncias abertas');

    const hide = page.getByRole('button', { name: /Ocultar a mensagem de Ana Souza/ });
    await expect(hide).toBeDisabled();
    await page.getByLabel(/Motivo da moderação/).fill('ab');
    await expect(hide).toBeDisabled();
    await page.getByLabel(/Motivo da moderação/).fill('Dado de paciente');
    await hide.click();
    await expect(page.getByRole('status').filter({ hasText: 'Mensagem ocultada.' })).toBeVisible();
    expect(calls).toEqual([
      {
        path: `/api/staff/discussions/posts/${P(1)}/moderate`,
        body: { action: 'hide', reason: 'Dado de paciente' },
      },
    ]);
  });

  test('restaurar só aparece no oculto; excluir não aparece no excluído; descartar denúncias é direto', async ({
    page,
  }) => {
    const calls = await staffStub(page, {
      reported: [
        item(1, { state: 'hidden', openReports: 1 }),
        item(2, { state: 'deleted', openReports: 1, authorName: 'Carla Dias' }),
      ],
    });
    await page.goto('/staff/discussoes');
    await expect(
      page.getByRole('button', { name: /Restaurar a mensagem de Ana Souza/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Restaurar a mensagem de Carla Dias/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Excluir a mensagem de Carla Dias/ }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Ocultar a mensagem de Ana Souza/ })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: /Descartar as denúncias de Ana Souza/ }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Denúncias descartadas.' }),
    ).toBeVisible();
    expect(calls[0]).toEqual({
      path: `/api/staff/discussions/posts/${P(1)}/dismiss`,
      body: {},
    });
  });

  test('a fila "sem resposta" deixa responder como equipe', async ({ page }) => {
    const calls = await staffStub(page, { unanswered: [item(3, { body: 'Qual o prazo?' })] });
    await page.goto('/staff/discussoes');
    await expect(page.getByText('Nenhuma denúncia aberta.')).toBeVisible();
    await page.getByRole('button', { name: 'Sem resposta da equipe' }).click();
    await expect(page.getByText('Qual o prazo?')).toBeVisible();
    await page.getByRole('button', { name: /Responder a Ana Souza/ }).click();
    await page.getByLabel(/Resposta da equipe a Ana Souza/).fill('O acesso dura 12 meses.');
    await page.getByRole('button', { name: 'Publicar resposta da equipe' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Resposta publicada.' })).toBeVisible();
    expect(calls[0]).toEqual({
      path: `/api/staff/discussions/posts/${P(3)}/reply`,
      body: { body: 'O acesso dura 12 meses.' },
    });
  });

  test('erro do servidor vira aviso claro e a tela segue utilizável', async ({ page }) => {
    await staffStub(page, {
      reported: [item(1, { openReports: 1 })],
      write: () => ({ status: 409, json: { error: { code: 'invalid_transition' } } }),
    });
    await page.goto('/staff/discussoes');
    await page.getByLabel(/Motivo da moderação/).fill('Motivo válido');
    await page.getByRole('button', { name: /Ocultar a mensagem de Ana Souza/ }).click();
    await expect(page.getByRole('alert')).toContainText('não vale para o estado atual');
    await expect(page.getByLabel(/Motivo da moderação/)).toHaveValue('Motivo válido');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`acessibilidade (WCAG 2.2 AA) no ${scheme === 'light' ? 'claro' : 'escuro'}, com a resposta aberta`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await staffStub(page, { reported: [item(1, { openReports: 1 })] });
      await page.goto('/staff/discussoes');
      await page.getByRole('button', { name: /Responder a Ana Souza/ }).click();
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
