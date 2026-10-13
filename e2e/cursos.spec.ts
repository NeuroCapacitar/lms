import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = ['staff.read', 'staff.manage', 'course.create', 'course.edit', 'offer.manage'];
const EDITOR = ['staff.read', 'course.edit'];
const READER = ['staff.read'];

const doc = (text: string, bold = false) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }],
    },
  ],
});

interface State {
  course: Record<string, unknown>;
  draft: {
    rev: number;
    publishedVersion: number;
    details: Record<string, unknown>;
    modules: unknown[];
  };
  preview: Record<string, unknown>;
  calls: { method: string; path: string; body: unknown }[];
  conflictNext: boolean;
  courses: Record<string, unknown>[];
}

function newState(): State {
  const course = {
    id: COURSE_ID,
    slug: 'protea-r',
    title: 'PROTEA-R interno',
    sequenceMode: 'guided',
    status: 'draft',
    firstPublishedAt: null,
    publishedVersion: 0,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    offers: [] as Record<string, unknown>[],
  };
  return {
    course,
    draft: {
      rev: 0,
      publishedVersion: 0,
      details: { displayTitle: 'PROTEA-R interno', description: null, workloadHours: null },
      modules: [],
    },
    preview: {
      rev: 0,
      publishedVersion: 0,
      hasChanges: true,
      problems: [{ code: 'no_modules', path: 'modules' }],
      diff: { details: true, added: [], changed: [], retired: [] },
    },
    calls: [],
    conflictNext: false,
    courses: [course],
  };
}

async function stub(page: Page, capabilities: string[], state = newState()) {
  const record = (route: Route) =>
    state.calls.push({
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      body: route.request().postData() ? route.request().postDataJSON() : undefined,
    });
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/access', (route) =>
    route.fulfill({ json: { roles: ['student', 'admin'], capabilities, recentAuth: false } }),
  );
  await page.route('**/api/staff/courses', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { courses: state.courses } });
    record(route);
    const body = route.request().postDataJSON() as { slug: string };
    if (body.slug === 'ja-existe') {
      return route.fulfill({ status: 409, json: { error: { code: 'slug_taken' } } });
    }
    return route.fulfill({ status: 201, json: { id: COURSE_ID } });
  });
  await page.route(`**/api/staff/courses/${COURSE_ID}`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: state.course });
    record(route);
    Object.assign(state.course, route.request().postDataJSON());
    return route.fulfill({ json: { status: 'ok' } });
  });
  await page.route(`**/api/staff/courses/${COURSE_ID}/draft`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: state.draft });
    record(route);
    const body = route.request().postDataJSON() as {
      expectedRev: number;
      details: object;
      modules: unknown[];
    };
    if (state.conflictNext || body.expectedRev !== state.draft.rev) {
      state.conflictNext = false;
      return route.fulfill({
        status: 409,
        json: { error: { code: 'draft_conflict', currentRev: state.draft.rev + 1 } },
      });
    }
    let counter = state.draft.rev * 100;
    const withIds = (modules: unknown[]) =>
      (modules as { id?: string; lessons: { id?: string }[] }[]).map((module) => ({
        ...module,
        id: module.id ?? `m-${(counter += 1)}`,
        lessons: module.lessons.map((lesson) => ({
          ...lesson,
          id: lesson.id ?? `l-${(counter += 1)}`,
        })),
      }));
    state.draft = {
      ...state.draft,
      rev: state.draft.rev + 1,
      details: body.details as Record<string, unknown>,
      modules: withIds(body.modules),
    };
    return route.fulfill({ json: state.draft });
  });
  await page.route(`**/api/staff/courses/${COURSE_ID}/publish-preview`, (route) =>
    route.fulfill({ json: state.preview }),
  );
  await page.route(`**/api/staff/courses/${COURSE_ID}/publish`, (route) => {
    record(route);
    const unchanged = state.preview.hasChanges === false;
    state.draft.publishedVersion = unchanged
      ? state.draft.publishedVersion
      : state.draft.publishedVersion + 1;
    state.preview = {
      ...state.preview,
      publishedVersion: state.draft.publishedVersion,
      hasChanges: false,
      diff: { details: false, added: [], changed: [], retired: [] },
    };
    return route.fulfill({
      json: {
        status: unchanged ? 'unchanged' : 'published',
        version: state.draft.publishedVersion,
      },
    });
  });
  await page.route(`**/api/staff/courses/${COURSE_ID}/status`, (route) => {
    record(route);
    state.course.status = (route.request().postDataJSON() as { status: string }).status;
    if (state.course.status === 'published')
      state.course.firstPublishedAt = '2026-10-11T00:00:00.000Z';
    return route.fulfill({ json: { status: 'ok' } });
  });
  await page.route(`**/api/staff/courses/${COURSE_ID}/offers`, (route) => {
    record(route);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if ((body.priceCents as number) === 13) {
      return route.fulfill({
        status: 400,
        json: { error: { code: 'invalid_request', fields: ['priceCents'] } },
      });
    }
    (state.course.offers as unknown[]).push({
      id: `o-${(state.course.offers as unknown[]).length + 1}`,
      status: 'draft',
      currency: 'BRL',
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
      ...body,
    });
    return route.fulfill({ status: 201, json: { id: 'o-x' } });
  });
  await page.route(new RegExp(`/api/staff/courses/${COURSE_ID}/offers/[^/]+/status$`), (route) => {
    record(route);
    const id = route.request().url().split('/offers/')[1]!.split('/')[0];
    const offer = (state.course.offers as { id: string; status: string }[]).find(
      (o) => o.id === id,
    )!;
    offer.status = (route.request().postDataJSON() as { status: string }).status;
    return route.fulfill({ json: { status: 'ok' } });
  });
  return state;
}

const asAdmin = (page: Page, state?: State) => stub(page, ADMIN, state);
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const editorUrl = `/staff/cursos/${COURSE_ID}`;

async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('lista e criação de cursos', () => {
  test('o Admin vê a lista e o formulário de criar; quem só lê vê a lista sem o formulário', async ({
    page,
  }) => {
    await asAdmin(page);
    await page.goto('/staff/cursos');
    await expect(page.getByRole('link', { name: 'PROTEA-R interno' })).toBeVisible();
    await expect(page.getByText('currículo ainda não publicado')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Novo curso' })).toBeVisible();
    await page.unrouteAll();
    await stub(page, READER);
    await page.goto('/staff/cursos');
    await expect(page.getByRole('link', { name: 'PROTEA-R interno' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Novo curso' })).toHaveCount(0);
  });

  test('criar curso: erros em português por campo, sequência sem opção pré-marcada e erro do servidor no campo', async ({
    page,
  }) => {
    const state = await asAdmin(page);
    await page.goto('/staff/cursos');
    await expect(page.getByRole('radio', { name: /Guiada/ })).not.toBeChecked();
    await expect(page.getByRole('radio', { name: /Livre/ })).not.toBeChecked();
    await page.getByRole('button', { name: 'Criar curso' }).click();
    await expect(page.getByText('Informe o título interno.')).toBeVisible();
    await expect(page.getByText('O endereço precisa ter ao menos 3 caracteres.')).toBeVisible();
    await expect(page.getByText('Escolha como as aulas se liberam.')).toBeVisible();

    await page.getByLabel('Título interno').fill('Curso novo');
    await page.getByLabel('Endereço (slug)').fill('Mau Slug');
    await page.getByRole('radio', { name: /Livre/ }).check();
    await page.getByRole('button', { name: 'Criar curso' }).click();
    await expect(page.getByText('Use só letras minúsculas, números e hífens')).toBeVisible();

    await page.getByLabel('Endereço (slug)').fill('ja-existe');
    await page.getByRole('button', { name: 'Criar curso' }).click();
    await expect(page.getByText('Já existe um curso com este endereço.')).toBeVisible();

    await page.getByLabel('Endereço (slug)').fill('curso-novo');
    await page.getByRole('button', { name: 'Criar curso' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/cursos/${COURSE_ID}$`));
    expect(state.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/staff/courses',
      body: { title: 'Curso novo', slug: 'curso-novo', sequenceMode: 'free' },
    });
  });

  test('XSS no título não executa: aparece como texto', async ({ page }) => {
    const state = newState();
    state.course.title = '<img src=x onerror=alert(1)> Curso';
    await asAdmin(page, state);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('/staff/cursos');
    await expect(
      page.getByRole('link', { name: '<img src=x onerror=alert(1)> Curso' }),
    ).toBeVisible();
    expect(await page.locator('main img').count()).toBe(0);
    await page.goto(editorUrl);
    await expect(
      page.getByRole('heading', { name: '<img src=x onerror=alert(1)> Curso' }),
    ).toBeVisible();
    expect(await page.locator('main img').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('editor: abas e permissões', () => {
  test('o Admin vê as 5 abas; quem edita o curso mas não a oferta não vê "Oferta"; leitura não vê o salvar', async ({
    page,
  }) => {
    await asAdmin(page);
    await page.goto(editorUrl);
    for (const name of ['Detalhes', 'Currículo', 'Oferta', 'Pré-visualização', 'Publicar']) {
      await expect(tab(page, name)).toBeVisible();
    }
    await page.unrouteAll();
    await stub(page, EDITOR);
    await page.goto(editorUrl);
    await expect(tab(page, 'Detalhes')).toBeVisible();
    await expect(tab(page, 'Oferta')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Salvar rascunho' })).toBeVisible();
    await page.unrouteAll();
    await stub(page, READER);
    await page.goto(editorUrl);
    await expect(page.getByText('Você tem acesso só de leitura')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar rascunho' })).toHaveCount(0);
    await expect(page.getByLabel('Título interno')).toBeDisabled();
    await tab(page, 'Currículo').click();
    await expect(page.getByRole('button', { name: 'Adicionar módulo' })).toHaveCount(0);
  });

  test('abas por teclado: setas, Home e End trocam de aba (roving tabindex)', async ({ page }) => {
    await asAdmin(page);
    await page.goto(editorUrl);
    await tab(page, 'Detalhes').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Currículo')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Currículo')).toBeFocused();
    await page.keyboard.press('End');
    await expect(tab(page, 'Publicar')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Detalhes')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Currículo')).toHaveAttribute('tabindex', '-1');
  });
});

test.describe('currículo: editar, reordenar, salvar', () => {
  async function seed(page: Page) {
    const state = newState();
    state.draft = {
      rev: 4,
      publishedVersion: 0,
      details: { displayTitle: 'Curso', description: null, workloadHours: null },
      modules: [
        {
          id: 'm-a',
          title: 'Módulo A',
          dripDays: 0,
          lessons: [
            { id: 'l-1', title: 'Aula 1', isOptional: false, body: null },
            { id: 'l-2', title: 'Aula 2', isOptional: true, body: doc('Texto da aula 2', true) },
          ],
        },
        {
          id: 'm-b',
          title: 'Módulo B',
          dripDays: 7,
          lessons: [{ id: 'l-3', title: 'Aula 3', isOptional: false, body: null }],
        },
      ],
    };
    await asAdmin(page, state);
    await page.goto(editorUrl);
    await tab(page, 'Currículo').click();
    return state;
  }

  test('subir e descer por botões anunciam por aria-live e o foco acompanha o item', async ({
    page,
  }) => {
    await seed(page);
    const live = page.locator('p[aria-live="polite"]');
    await page.getByRole('button', { name: 'Descer o módulo 1' }).click();
    await expect(live).toContainText('Módulo "Módulo A" movido para a posição 2 de 2.');
    await expect(page.getByLabel('Título do módulo 1')).toHaveValue('Módulo B');
    await expect(page.getByRole('button', { name: 'Descer o módulo 2' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Subir o módulo 2' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Subir o módulo 1' })).toBeDisabled();

    await page.getByRole('button', { name: 'Subir a aula 2 do módulo 2' }).click();
    await expect(live).toContainText('Aula "Aula 2" movida para a posição 1 de 2 no módulo 2.');
    await expect(page.getByLabel('Título da aula 1 do módulo 2')).toHaveValue('Aula 2');
  });

  test('mover aula para outro módulo, adicionar e remover com confirmação; nada vai ao servidor antes de salvar', async ({
    page,
  }) => {
    const state = await seed(page);
    await page
      .getByLabel('Mover a aula 1 do módulo 1 para')
      .selectOption({ label: 'Módulo 2: Módulo B' });
    await expect(page.getByLabel('Título da aula 2 do módulo 2')).toHaveValue('Aula 1');
    await page.getByRole('button', { name: 'Adicionar aula ao módulo 1' }).click();
    await page.getByLabel('Título da aula 2 do módulo 1').fill('Aula nova');
    await page.getByRole('button', { name: 'Remover a aula 1 do módulo 2' }).click();
    await page.getByRole('button', { name: 'Confirmar remoção da aula' }).click();
    await page.getByRole('button', { name: 'Adicionar módulo' }).click();
    await page.getByLabel('Título do módulo 3').fill('Módulo C');
    await expect(page.getByText('Alterações não salvas.')).toBeVisible();
    expect(state.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  test('salvar envia o rascunho inteiro com o expectedRev lido; ids só nos itens existentes; depois fica salvo', async ({
    page,
  }) => {
    const state = await seed(page);
    await page.getByRole('button', { name: 'Descer a aula 1 do módulo 1' }).click();
    await page.getByRole('button', { name: 'Adicionar módulo' }).click();
    await page.getByLabel('Título do módulo 3').fill('Módulo C');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByText('Rascunho salvo.')).toBeVisible();
    const put = state.calls.find((c) => c.method === 'PUT')!;
    const body = put.body as {
      expectedRev: number;
      modules: { id?: string; title: string; lessons: { id?: string; title: string }[] }[];
    };
    expect(body.expectedRev).toBe(4);
    expect(body.modules.map((m) => m.id)).toEqual(['m-a', 'm-b', undefined]);
    expect(body.modules[0]!.lessons.map((l) => l.id)).toEqual(['l-2', 'l-1']);
    expect(JSON.stringify(body)).not.toContain('"key"');
    // o contador novo vale para o próximo salvamento
    await page.getByLabel('Título do módulo 3').fill('Módulo C2');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByText('Rascunho salvo.')).toBeVisible();
    expect(
      (state.calls.filter((c) => c.method === 'PUT').at(-1)!.body as { expectedRev: number })
        .expectedRev,
    ).toBe(5);
  });

  test('quiz: transformar a aula, montar a questão com a resposta certa e salvar manda o quiz inteiro (kind + gabarito)', async ({
    page,
  }) => {
    const state = await seed(page);
    await page.getByRole('button', { name: 'Transformar a aula 1 do módulo 1 em quiz' }).click();
    await expect(page.getByRole('group', { name: 'Quiz da aula 1 do módulo 1' })).toBeVisible();
    await page.getByLabel('Nota mínima para aprovar (%), quiz da aula 1 do módulo 1').fill('80');
    await page.getByLabel('Máximo de tentativas, quiz da aula 1 do módulo 1').fill('3');
    await page
      .getByRole('button', { name: 'Adicionar questão ao quiz da aula 1 do módulo 1' })
      .click();
    await page.getByLabel('Enunciado da questão 1 (aula 1 do módulo 1)').fill('Qual é a capital?');
    await page.getByLabel('Texto da opção 1 (questão 1)').fill('Brasília');
    await page.getByLabel('Texto da opção 2 (questão 1)').fill('São Paulo');
    await page.getByLabel('A opção 1 da questão 1 é correta').check();
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByText('Rascunho salvo.')).toBeVisible();
    const body = state.calls.find((c) => c.method === 'PUT')!.body as {
      modules: { lessons: { kind?: string; quiz?: any }[] }[];
    };
    const [first, second] = body.modules[0]!.lessons;
    expect(first!.kind).toBe('quiz');
    expect(first!.quiz).toMatchObject({
      minScorePercent: 80,
      maxAttempts: 3,
      feedback: 'immediate',
      shuffle: false,
    });
    expect(first!.quiz.questions).toHaveLength(1);
    expect(first!.quiz.questions[0]).toMatchObject({
      prompt: 'Qual é a capital?',
      kind: 'single',
      points: 1,
    });
    expect(first!.quiz.questions[0].options.map((o: any) => [o.text, o.correct])).toEqual([
      ['Brasília', true],
      ['São Paulo', false],
    ]);
    // a aula que não foi mexida não manda tipo (o servidor mantém o que tem)
    expect(second!.kind).toBeUndefined();
    expect(second!.quiz).toBeUndefined();
  });

  test('quiz: na escolha única só uma opção fica correta; converter em texto pede confirmação e apaga o quiz', async ({
    page,
  }) => {
    const state = await seed(page);
    await page.getByRole('button', { name: 'Transformar a aula 1 do módulo 1 em quiz' }).click();
    await page
      .getByRole('button', { name: 'Adicionar questão ao quiz da aula 1 do módulo 1' })
      .click();
    await page.getByLabel('A opção 1 da questão 1 é correta').check();
    await page.getByLabel('A opção 2 da questão 1 é correta').check();
    await expect(page.getByLabel('A opção 1 da questão 1 é correta')).not.toBeChecked();
    await page.getByLabel('Tipo da questão 1').selectOption('multiple');
    await page.getByLabel('A opção 1 da questão 1 é correta').check();
    await expect(page.getByLabel('A opção 2 da questão 1 é correta')).toBeChecked();

    await page.getByRole('button', { name: 'Converter a aula 1 do módulo 1 em texto' }).click();
    await page
      .getByRole('button', { name: 'Confirmar: apagar o quiz e virar aula de texto' })
      .click();
    await expect(page.getByRole('group', { name: 'Quiz da aula 1 do módulo 1' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByText('Rascunho salvo.')).toBeVisible();
    const body = state.calls.find((c) => c.method === 'PUT')!.body as {
      modules: { lessons: { kind?: string; quiz?: unknown }[] }[];
    };
    expect(body.modules[0]!.lessons[0]).toMatchObject({ kind: 'text' });
    expect(body.modules[0]!.lessons[0]!.quiz).toBeUndefined();
  });

  test('quiz: o editor passa na acessibilidade (WCAG 2.2 AA)', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: 'Transformar a aula 1 do módulo 1 em quiz' }).click();
    await page
      .getByRole('button', { name: 'Adicionar questão ao quiz da aula 1 do módulo 1' })
      .click();
    await page.getByRole('button', { name: 'Adicionar opção à questão 1' }).click();
    await expectNoViolations(page, 'editor de quiz');
  });

  test('conflito 409: avisa, não sobrescreve e oferece recarregar o rascunho atual', async ({
    page,
  }) => {
    const state = await seed(page);
    state.conflictNext = true;
    await page.getByLabel('Título do módulo 1').fill('Minha edição');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Outra pessoa salvou este rascunho' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Recarregar o rascunho atual' }).click();
    await expect(page.getByLabel('Título do módulo 1')).toHaveValue('Módulo A');
    await expect(page.getByText('Rascunho sem alterações.')).toBeVisible();
  });

  test('sair com alterações não salvas pede confirmação (cancelar fica; confirmar sai)', async ({
    page,
  }) => {
    await seed(page);
    const messages: string[] = [];
    let accept = false;
    page.on('dialog', (dialog) => {
      messages.push(dialog.message());
      void (accept ? dialog.accept() : dialog.dismiss());
    });
    await page.getByLabel('Título do módulo 1').fill('Mudou');
    await page.getByRole('link', { name: '← Cursos' }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/cursos/${COURSE_ID}$`));
    expect(messages[0]).toContain('alterações não salvas');
    accept = true;
    await page.getByRole('link', { name: '← Cursos' }).click();
    await expect(page).toHaveURL(/\/staff\/cursos$/);
  });

  test('o texto da aula abre o editor rico; XSS no título e no texto aparece como texto na pré-visualização', async ({
    page,
  }) => {
    await seed(page);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByLabel('Título da aula 1 do módulo 1').fill('<img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Editar o texto da aula 1 do módulo 1' }).click();
    const editor = page.getByRole('textbox', { name: 'Texto da aula 1 do módulo 1' });
    await editor.click();
    await page.keyboard.type('<script>alert(1)</script>');
    await tab(page, 'Pré-visualização').click();
    const preview = page.getByRole('article', { name: 'Pré-visualização do curso' });
    await expect(preview.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    await expect(preview.getByText('<script>alert(1)</script>')).toBeVisible();
    await expect(preview.locator('strong')).toHaveText('Texto da aula 2');
    expect(await preview.locator('img, script').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });
});

test.describe('publicar', () => {
  test('mostra os problemas, depois o resumo (adicionadas, alteradas, aposentadas) e publica', async ({
    page,
  }) => {
    const state = newState();
    state.draft.rev = 2;
    await asAdmin(page, state);
    await page.goto(editorUrl);
    await tab(page, 'Publicar').click();
    await expect(page.getByText('Falta resolver para publicar')).toBeVisible();
    await expect(page.getByText('O curso precisa de pelo menos um módulo.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar currículo' })).toBeDisabled();

    state.preview = {
      rev: 2,
      publishedVersion: 1,
      hasChanges: true,
      problems: [],
      diff: {
        details: true,
        added: [{ id: 'a', kind: 'lesson', title: 'Aula nova' }],
        changed: [{ id: 'b', kind: 'module', title: 'Módulo A renomeado' }],
        retired: [{ id: 'c', kind: 'lesson', title: 'Aula velha' }],
      },
    };
    await page.reload();
    await tab(page, 'Publicar').click();
    await expect(page.getByRole('region', { name: 'Adicionadas' })).toContainText(
      'Aula: Aula nova',
    );
    await expect(page.getByRole('region', { name: 'Alteradas' })).toContainText(
      'Módulo: Módulo A renomeado',
    );
    await expect(page.getByRole('region', { name: 'Aposentadas' })).toContainText(
      'Aula: Aula velha',
    );
    await expect(page.getByText('Os textos públicos do curso')).toBeVisible();
    await page.getByRole('button', { name: 'Publicar currículo' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Currículo publicado (versão 1).' }),
    ).toBeVisible();
    expect(state.calls.some((c) => c.path.endsWith('/publish'))).toBe(true);
    await expect(
      page.getByText('Não há mudanças: o currículo publicado já é igual ao rascunho salvo.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar currículo' })).toBeDisabled();
  });

  test('com alterações não salvas o resumo avisa e o botão fica desabilitado', async ({ page }) => {
    const state = newState();
    state.preview = {
      ...state.preview,
      hasChanges: true,
      problems: [],
      diff: { details: false, added: [], changed: [], retired: [] },
    };
    await asAdmin(page, state);
    await page.goto(editorUrl);
    await page.getByLabel('Título público').fill('Mudou');
    await tab(page, 'Publicar').click();
    await expect(page.getByText('Há alterações não salvas. Salve o rascunho')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar currículo' })).toBeDisabled();
  });

  test('quem só edita ou só lê não confunde: leitor vê o resumo sem o botão de publicar', async ({
    page,
  }) => {
    await stub(page, READER);
    await page.goto(editorUrl);
    await tab(page, 'Publicar').click();
    await expect(page.getByRole('region', { name: 'Resumo do que muda' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar currículo' })).toHaveCount(0);
  });
});

test.describe('oferta (só Admin)', () => {
  test('cria oferta paga com preço em reais enviado em centavos e erros em português no campo', async ({
    page,
  }) => {
    const state = await asAdmin(page);
    await page.goto(editorUrl);
    await tab(page, 'Oferta').click();
    await page.getByLabel('Nome da oferta').fill('Anual');
    await page.getByRole('button', { name: 'Criar oferta' }).click();
    await expect(page.getByText('Escolha gratuita ou paga.')).toBeVisible();
    await page.getByRole('radio', { name: 'Paga' }).check();
    await page.getByRole('button', { name: 'Criar oferta' }).click();
    await expect(page.getByText('Informe um preço maior que zero (ex.: 197,00).')).toBeVisible();
    await page.getByLabel('Preço (R$)').fill('197,00');
    await page.getByLabel('Prazo de acesso (meses)').fill('0');
    await page.getByRole('button', { name: 'Criar oferta' }).click();
    await expect(page.getByText('O prazo é de pelo menos 1 mês.')).toBeVisible();
    await page.getByLabel('Prazo de acesso (meses)').fill('12');
    await page.getByLabel('Máximo de parcelas').fill('12');
    await page.getByRole('button', { name: 'Criar oferta' }).click();
    await expect(page.getByText('Oferta criada.')).toBeVisible();
    expect(state.calls.find((c) => c.path.endsWith('/offers'))!.body).toEqual({
      name: 'Anual',
      kind: 'paid',
      priceCents: 19_700,
      accessMonths: 12,
      maxInstallments: 12,
    });
    await expect(
      page.getByText('R$ 197,00 · acesso por 12 meses · até 12x sem juros'),
    ).toBeVisible();
  });

  test('a oferta gratuita não tem preço nem parcelas; erro do servidor cai no campo', async ({
    page,
  }) => {
    await asAdmin(page);
    await page.goto(editorUrl);
    await tab(page, 'Oferta').click();
    await page.getByLabel('Nome da oferta').fill('Gratuita');
    await page.getByRole('radio', { name: 'Gratuita' }).check();
    await expect(page.getByLabel('Preço (R$)')).toHaveCount(0);
    await page.getByLabel('Máximo de parcelas').fill('3');
    await page.getByRole('button', { name: 'Criar oferta' }).click();
    await expect(page.getByText('A oferta gratuita não parcela: use 1.')).toBeVisible();
    await page.getByLabel('Máximo de parcelas').fill('1');
    await page.getByRole('radio', { name: 'Paga' }).check();
    await page.getByLabel('Preço (R$)').fill('0,13');
    await page.getByLabel('Máximo de parcelas').fill('1');
    await page.getByRole('button', { name: 'Criar oferta' }).click();
    await expect(page.getByText('Preço inválido para esta modalidade.')).toBeVisible();
  });

  test('ativar, pausar, reativar e arquivar (com confirmação)', async ({ page }) => {
    const state = newState();
    (state.course.offers as unknown[]).push({
      id: 'o-1',
      name: 'Anual',
      kind: 'paid',
      priceCents: 19_700,
      accessMonths: 12,
      maxInstallments: 12,
      status: 'draft',
      currency: 'BRL',
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
    });
    await asAdmin(page, state);
    await page.goto(editorUrl);
    await tab(page, 'Oferta').click();
    await page.getByRole('button', { name: 'Ativar Anual' }).click();
    await expect(page.getByText('Oferta ativada.')).toBeVisible();
    await page.getByRole('button', { name: 'Pausar Anual' }).click();
    await expect(page.getByText('Oferta pausada.')).toBeVisible();
    await page.getByRole('button', { name: 'Reativar Anual' }).click();
    await expect(page.getByText('Oferta reativada.')).toBeVisible();
    await page.getByRole('button', { name: 'Arquivar Anual' }).click();
    await page.getByRole('button', { name: 'Confirmar arquivamento' }).click();
    await expect(page.getByText('Oferta arquivada.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar Anual' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ativar Anual' })).toHaveCount(0);
  });
});

test.describe('detalhes e visibilidade', () => {
  test('publicar no catálogo trava o endereço; arquivar pede confirmação', async ({ page }) => {
    const state = await asAdmin(page);
    await page.goto(editorUrl);
    await expect(page.getByLabel('Endereço (slug)')).toBeEnabled();
    await page.getByRole('button', { name: 'Publicar no catálogo' }).click();
    await expect(page.getByText('Curso publicado no catálogo.')).toBeVisible();
    await expect(page.getByLabel('Endereço (slug)')).toBeDisabled();
    await expect(page.getByText('Bloqueado: o curso já foi publicado')).toBeVisible();
    await page.getByRole('button', { name: 'Arquivar o curso' }).click();
    await page.getByRole('button', { name: 'Confirmar arquivamento' }).click();
    await expect(page.getByText('Curso arquivado.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Republicar no catálogo' })).toBeVisible();
    expect(
      state.calls
        .filter((c) => c.path.endsWith('/status'))
        .map((c) => (c.body as { status: string }).status),
    ).toEqual(['published', 'archived']);
  });
});

test.describe('acessibilidade e CSP', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações na lista e em todas as abas (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const state = newState();
      state.draft.modules = [
        {
          id: 'm-a',
          title: 'Módulo A',
          dripDays: 0,
          lessons: [{ id: 'l-1', title: 'Aula 1', isOptional: false, body: doc('Olá') }],
        },
      ];
      (state.course.offers as unknown[]).push({
        id: 'o-1',
        name: 'Anual',
        kind: 'paid',
        priceCents: 19_700,
        accessMonths: 12,
        maxInstallments: 12,
        status: 'active',
        currency: 'BRL',
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '2026-10-11T00:00:00.000Z',
      });
      await asAdmin(page, state);
      await page.goto('/staff/cursos');
      await page.getByRole('heading', { name: 'Novo curso' }).waitFor();
      await expectNoViolations(page, `lista (${scheme})`);
      await page.goto(editorUrl);
      for (const name of ['Detalhes', 'Currículo', 'Oferta', 'Pré-visualização', 'Publicar']) {
        await tab(page, name).click();
        await page.getByRole('tabpanel').waitFor();
        await page.waitForTimeout(250);
        await expectNoViolations(page, `${name} (${scheme})`);
      }
    });
  }

  test('nenhuma violação de CSP no editor com o texto rico aberto', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    const state = newState();
    state.draft.modules = [
      {
        id: 'm-a',
        title: 'Módulo A',
        dripDays: 0,
        lessons: [{ id: 'l-1', title: 'Aula 1', isOptional: false, body: null }],
      },
    ];
    await asAdmin(page, state);
    await page.goto(editorUrl);
    await tab(page, 'Currículo').click();
    await page.getByRole('button', { name: 'Editar o texto da aula 1 do módulo 1' }).click();
    const editor = page.getByRole('textbox', { name: 'Texto da aula 1 do módulo 1' });
    await editor.click();
    await page.keyboard.type('Texto sob a CSP');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });
});
