import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const L = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const OUTLINE = {
  course: { id: COURSE_ID, title: 'Curso Demonstrativo', sequenceMode: 'guided' },
  access: { hasAccess: true, reason: 'ok', expiresAt: '2027-01-10T12:00:00.000Z' },
  progress: { completed: 1, total: 3, percent: 33 },
  completedAt: null,
  modules: [
    {
      id: 'm1',
      title: 'Primeiros passos',
      releasesAt: '2026-10-11T03:00:00.000Z',
      lessons: [
        {
          id: L(1),
          title: 'Boas-vindas',
          isOptional: false,
          completed: true,
          locked: null,
          releasesAt: null,
        },
        {
          id: L(2),
          title: 'Como estudar aqui',
          isOptional: false,
          completed: false,
          locked: null,
          releasesAt: null,
        },
        {
          id: L(3),
          title: 'Leitura extra',
          isOptional: true,
          completed: false,
          locked: 'sequence_locked',
          releasesAt: null,
        },
      ],
    },
    {
      id: 'm2',
      title: 'Aprofundando',
      releasesAt: '2026-10-18T03:00:00.000Z',
      lessons: [
        {
          id: L(4),
          title: 'Conceito central',
          isOptional: false,
          completed: false,
          locked: 'drip_locked',
          releasesAt: '2026-10-18T03:00:00.000Z',
        },
      ],
    },
  ],
};

const LESSON = {
  course: { id: COURSE_ID, title: 'Curso Demonstrativo' },
  lesson: {
    id: L(2),
    title: 'Como estudar aqui',
    isOptional: false,
    body: doc('Texto da aula sobre a rotina de estudo.'),
  },
  completed: false,
  previous: { id: L(1), title: 'Boas-vindas' },
  next: { id: L(4), title: 'Conceito central' },
};

async function stub(page: Page) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
}
const outlineApi = (page: Page, status: number, json: unknown) =>
  page.route('**/api/courses/*/outline', (route) => route.fulfill({ status, json }));
const lessonApi = (page: Page, status: number, json: unknown) =>
  page.route('**/api/lessons/*', (route) => route.fulfill({ status, json }));
const denied = (reason: string) => ({ error: { code: 'access_denied', reason } });

async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('mapa do curso', () => {
  test('aula liberada é link; bloqueada é texto com o motivo e a data; módulo futuro mostra quando libera', async ({
    page,
  }) => {
    await stub(page);
    await outlineApi(page, 200, OUTLINE);
    await page.clock.setFixedTime(new Date('2026-10-12T15:00:00Z'));
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    await expect(
      page.getByText('Sequência guiada: as aulas obrigatórias abrem em ordem.'),
    ).toBeVisible();
    await expect(page.getByText(/Acesso até 10\/01\/2027/)).toBeVisible();

    await expect(page.getByRole('link', { name: /Boas-vindas/ })).toHaveAttribute(
      'href',
      `/estudar/${COURSE_ID}/aulas/${L(1)}`,
    );
    await expect(page.getByText('(concluída)')).toBeVisible();
    await expect(page.getByRole('link', { name: /Como estudar aqui/ })).toBeVisible();
    // bloqueadas: sem link
    await expect(page.getByRole('link', { name: /Leitura extra/ })).toHaveCount(0);
    await expect(
      page.getByText('— Conclua as aulas obrigatórias anteriores para abrir esta aula.'),
    ).toBeVisible();
    await expect(page.getByText('(opcional)')).toBeVisible();
    await expect(page.getByRole('link', { name: /Conceito central/ })).toHaveCount(0);
    await expect(page.getByText('— Libera em 18/10/2026.')).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: /Módulo 2: Aprofundando \(libera em 18\/10\/2026\)/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Módulo 1: Primeiros passos' }),
    ).toBeVisible();
  });

  test('relógio controlado: depois da data de liberação o módulo deixa de mostrar "libera em"', async ({
    page,
  }) => {
    await stub(page);
    await outlineApi(page, 200, OUTLINE);
    await page.clock.setFixedTime(new Date('2026-10-18T02:59:59Z'));
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(
      page.getByRole('heading', { level: 2, name: /libera em 18\/10\/2026/ }),
    ).toBeVisible();
    await page.clock.setFixedTime(new Date('2026-10-18T03:00:01Z'));
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Módulo 2: Aprofundando' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /libera em/ })).toHaveCount(0);
  });

  test('curso livre explica a sequência livre', async ({ page }) => {
    await stub(page);
    await outlineApi(page, 200, {
      ...OUTLINE,
      course: { ...OUTLINE.course, sequenceMode: 'free' },
    });
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(page.getByText(/Sequência livre/)).toBeVisible();
  });

  for (const [reason, text] of [
    ['no_access', 'Você não tem inscrição neste curso.'],
    [
      'expired',
      'Seu acesso a este curso terminou. Inscreva-se de novo para continuar de onde parou.',
    ],
    ['suspended', 'Seu acesso a este curso está suspenso. Fale com o suporte.'],
  ] as const) {
    test(`sem acesso (${reason}): mensagem clara e caminho para os cursos, sem mapa`, async ({
      page,
    }) => {
      await stub(page);
      await outlineApi(page, 403, denied(reason));
      await page.goto(`/estudar/${COURSE_ID}`);
      await expect(page.getByRole('alert')).toHaveText(text);
      await expect(page.getByRole('link', { name: 'Ver os cursos' })).toBeVisible();
      await expect(page.getByRole('list')).toHaveCount(0);
    });
  }

  test('sem sessão: pede o login com retorno ao curso', async ({ page }) => {
    await stub(page);
    await outlineApi(page, 401, { error: { code: 'unauthenticated' } });
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(page.getByRole('link', { name: 'Entrar', exact: true }).last()).toHaveAttribute(
      'href',
      `/entrar?returnTo=%2Festudar%2F${COURSE_ID}`,
    );
  });

  test('erro do servidor: mensagem e "Tentar novamente"', async ({ page }) => {
    await stub(page);
    let fail = true;
    await page.route('**/api/courses/*/outline', (route) =>
      fail
        ? route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } })
        : route.fulfill({ json: OUTLINE }),
    );
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar o curso agora.');
    fail = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
  });

  test('XSS em títulos aparece como texto e não executa', async ({ page }) => {
    await stub(page);
    await outlineApi(page, 200, {
      ...OUTLINE,
      course: { ...OUTLINE.course, title: '<img src=x onerror=alert(1)> Curso' },
      modules: [
        {
          ...OUTLINE.modules[0],
          title: '<script>alert(2)</script>',
          lessons: [{ ...OUTLINE.modules[0]!.lessons[1]!, title: '<svg onload=alert(3)>' }],
        },
      ],
    });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(
      page.getByRole('heading', { level: 1, name: '<img src=x onerror=alert(1)> Curso' }),
    ).toBeVisible();
    await expect(page.getByText('<svg onload=alert(3)>')).toBeVisible();
    expect(await page.locator('main img, main svg, main script').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });
});

test.describe('aula', () => {
  test('liberada: mostra o conteúdo e as aulas vizinhas; seguir para a próxima funciona', async ({
    page,
  }) => {
    await stub(page);
    await outlineApi(page, 200, OUTLINE);
    await page.route('**/api/lessons/*', (route) => {
      const id = route.request().url().split('/').pop();
      return route.fulfill(
        id === L(4)
          ? {
              status: 403,
              json: {
                error: {
                  code: 'lesson_locked',
                  reason: 'drip_locked',
                  releasesAt: '2026-10-18T03:00:00.000Z',
                },
              },
            }
          : { json: LESSON },
      );
    });
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Como estudar aqui' })).toBeVisible();
    await expect(page.getByText('Texto da aula sobre a rotina de estudo.')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navegação entre aulas' });
    await expect(nav.getByRole('link', { name: '← Boas-vindas' })).toBeVisible();
    // a próxima está bloqueada: abre e mostra só o motivo, sem conteúdo
    await nav.getByRole('link', { name: 'Conceito central →' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Aula bloqueada' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Libera em 18/10/2026.');
    await expect(page.getByText('Texto da aula')).toHaveCount(0);
    await page.getByRole('link', { name: '← Voltar ao curso' }).click();
    await expect(page).toHaveURL(new RegExp(`/estudar/${COURSE_ID}$`));
  });

  test('bloqueada por sequência: mensagem sem conteúdo', async ({ page }) => {
    await stub(page);
    await lessonApi(page, 403, {
      error: { code: 'lesson_locked', reason: 'sequence_locked', releasesAt: null },
    });
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(3)}`);
    await expect(page.getByRole('status')).toHaveText(
      'Conclua as aulas obrigatórias anteriores para abrir esta aula.',
    );
  });

  test('sem acesso ao curso na aula: mensagem de acesso', async ({ page }) => {
    await stub(page);
    await lessonApi(page, 403, denied('expired'));
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await expect(page.getByRole('alert')).toContainText('Seu acesso a este curso terminou.');
  });

  test('aula inexistente ou retirada (404): mensagem neutra', async ({ page }) => {
    await stub(page);
    await lessonApi(page, 404, { error: { code: 'not_found' } });
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(9)}`);
    await expect(page.getByRole('alert')).toHaveText(
      'Este conteúdo não existe ou não está disponível.',
    );
  });

  test('XSS no título e no texto da aula aparece como texto', async ({ page }) => {
    await stub(page);
    await lessonApi(page, 200, {
      ...LESSON,
      lesson: {
        ...LESSON.lesson,
        title: '<img src=x onerror=alert(1)>',
        body: doc('<script>alert(2)</script> texto'),
      },
    });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await expect(
      page.getByRole('heading', { level: 1, name: '<img src=x onerror=alert(1)>' }),
    ).toBeVisible();
    await expect(page.getByText('<script>alert(2)</script> texto')).toBeVisible();
    expect(await page.locator('main img, main script').count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });
});

test.describe('entradas e acessibilidade', () => {
  test('"Ir para o curso" aparece na página do curso para quem tem acesso e leva ao mapa', async ({
    page,
  }) => {
    await stub(page);
    await outlineApi(page, 200, OUTLINE);
    await page.route('**/cursos/*', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const shell = await route.fetch({ url: new URL('/', route.request().url()).toString() });
      return route.fulfill({ response: shell });
    });
    await page.route('**/api/public/courses/**', (route) =>
      route.fulfill({
        json: {
          id: COURSE_ID,
          slug: 'demo',
          title: 'Curso Demonstrativo',
          description: doc('Descrição.'),
          workloadHours: 3,
          sequenceMode: 'guided',
          availability: 'open',
          offer: { id: 'o1', kind: 'free', priceCents: 0, accessMonths: 3, maxInstallments: 1 },
          syllabus: ['Módulo 1'],
        },
      }),
    );
    await page.route('**/api/courses/*/access', (route) => route.fulfill({ json: OUTLINE.access }));
    await page.goto('/cursos/demo');
    await page.getByRole('link', { name: 'Ir para o curso' }).click();
    await expect(page).toHaveURL(new RegExp(`/estudar/${COURSE_ID}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações: mapa, aula, aula bloqueada e sem acesso (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stub(page);
      for (const [label, path, setup] of [
        ['mapa', `/estudar/${COURSE_ID}`, () => outlineApi(page, 200, OUTLINE)],
        ['aula', `/estudar/${COURSE_ID}/aulas/${L(2)}`, () => lessonApi(page, 200, LESSON)],
        [
          'aula bloqueada',
          `/estudar/${COURSE_ID}/aulas/${L(4)}`,
          () =>
            lessonApi(page, 403, {
              error: {
                code: 'lesson_locked',
                reason: 'drip_locked',
                releasesAt: '2026-10-18T03:00:00.000Z',
              },
            }),
        ],
        ['sem acesso', `/estudar/${COURSE_ID}`, () => outlineApi(page, 403, denied('expired'))],
      ] as const) {
        await page.unroute('**/api/courses/*/outline');
        await page.unroute('**/api/lessons/*');
        await setup();
        await page.goto(path);
        await page.getByRole('heading', { level: 1 }).waitFor();
        await expectNoViolations(page, `${label} (${scheme})`);
      }
    });
  }

  test('no celular (375 px) não há rolagem horizontal no mapa nem na aula', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stub(page);
    await outlineApi(page, 200, {
      ...OUTLINE,
      modules: [
        {
          ...OUTLINE.modules[0],
          title: 'Um módulo com um título bem longo para quebrar linha no celular',
        },
      ],
    });
    await lessonApi(page, 200, LESSON);
    for (const path of [`/estudar/${COURSE_ID}`, `/estudar/${COURSE_ID}/aulas/${L(2)}`]) {
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('progresso e conclusão (M3-04)', () => {
  test('o mapa mostra o progresso das obrigatórias e avisa que as opcionais não contam', async ({
    page,
  }) => {
    await stub(page);
    await outlineApi(page, 200, OUTLINE);
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(
      page.getByText('Progresso: 33% (1 de 3 aulas obrigatórias concluídas)'),
    ).toBeVisible();
    const bar = page.getByRole('progressbar', { name: /Progresso: 33%/ });
    await expect(bar).toHaveAttribute('value', '1');
    await expect(bar).toHaveAttribute('max', '3');
    await expect(page.getByText('As aulas opcionais não entram no progresso.')).toBeVisible();
    await expect(page.getByText(/Você concluiu este curso/)).toHaveCount(0);
  });

  test('curso concluído: mensagem com a data, mesmo se o percentual caiu depois', async ({
    page,
  }) => {
    await stub(page);
    await outlineApi(page, 200, {
      ...OUTLINE,
      progress: { completed: 3, total: 4, percent: 75 },
      completedAt: '2026-12-01T15:00:00.000Z',
    });
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(
      page.getByRole('status').filter({ hasText: 'Você concluiu este curso em 01/12/2026.' }),
    ).toBeVisible();
    await expect(
      page.getByText('Progresso: 75% (3 de 4 aulas obrigatórias concluídas)'),
    ).toBeVisible();
  });

  test('curso sem aulas obrigatórias: aviso em vez da barra', async ({ page }) => {
    await stub(page);
    await outlineApi(page, 200, { ...OUTLINE, progress: { completed: 0, total: 0, percent: 0 } });
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(page.getByText('Este curso ainda não tem aulas obrigatórias.')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
  });

  test('"Concluir aula": um pedido, mensagem e o botão some quando a aula passa a concluída', async ({
    page,
  }) => {
    await stub(page);
    await outlineApi(page, 200, OUTLINE);
    let completed = false;
    const calls: string[] = [];
    await page.route('**/api/lessons/*/complete', async (route) => {
      calls.push(route.request().url());
      await new Promise((resolve) => setTimeout(resolve, 400));
      completed = true;
      return route.fulfill({
        status: 201,
        json: {
          status: 'completed',
          progress: { completed: 2, total: 3, percent: 66 },
          courseCompleted: false,
          courseJustCompleted: false,
          courseCompletedAt: null,
        },
      });
    });
    await page.route('**/api/lessons/*', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { ...LESSON, completed } })
        : route.fallback(),
    );
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await page.getByRole('button', { name: 'Concluir aula' }).dblclick();
    await expect(page.getByRole('button', { name: 'Concluindo…' })).toBeDisabled();
    await expect(page.getByText('Aula concluída.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Concluir aula|Concluindo/ })).toHaveCount(0);
    expect(calls).toHaveLength(1);
  });

  test('a última obrigatória mostra os parabéns', async ({ page }) => {
    await stub(page);
    await lessonApi(page, 200, LESSON);
    await page.route('**/api/lessons/*/complete', (route) =>
      route.fulfill({
        status: 201,
        json: {
          status: 'completed',
          progress: { completed: 3, total: 3, percent: 100 },
          courseCompleted: true,
          courseJustCompleted: true,
          courseCompletedAt: '2026-12-01T15:00:00.000Z',
        },
      }),
    );
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await page.getByRole('button', { name: 'Concluir aula' }).click();
    await expect(page.getByText('Aula concluída. Parabéns, você concluiu o curso!')).toBeVisible();
  });

  test('aula já concluída: sem botão, só o aviso', async ({ page }) => {
    await stub(page);
    await lessonApi(page, 200, { ...LESSON, completed: true });
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await expect(page.getByText('Aula concluída.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Concluir/ })).toHaveCount(0);
  });

  for (const [status, json, text] of [
    [
      403,
      { error: { code: 'lesson_locked', reason: 'sequence_locked', releasesAt: null } },
      'Esta aula ainda não pode ser concluída.',
    ],
    [
      403,
      { error: { code: 'access_denied', reason: 'expired' } },
      'Seu acesso a este curso não permite concluir a aula.',
    ],
    [401, { error: { code: 'unauthenticated' } }, 'Sua sessão expirou. Entre novamente.'],
    [
      500,
      { error: { code: 'internal_error' } },
      'Não foi possível concluir a aula agora. Tente novamente.',
    ],
  ] as const) {
    test(`erro ${status} (${(json as { error: { code: string } }).error.code}) ao concluir aparece em português e libera o botão`, async ({
      page,
    }) => {
      await stub(page);
      await lessonApi(page, 200, LESSON);
      await page.route('**/api/lessons/*/complete', (route) => route.fulfill({ status, json }));
      await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
      await page.getByRole('button', { name: 'Concluir aula' }).click();
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Concluir aula' })).toBeEnabled();
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações: mapa com progresso e concluído, aula com botão (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stub(page);
      await outlineApi(page, 200, OUTLINE);
      await page.goto(`/estudar/${COURSE_ID}`);
      await page.getByRole('progressbar').waitFor();
      await expectNoViolations(page, `mapa com progresso (${scheme})`);
      await page.unroute('**/api/courses/*/outline');
      await outlineApi(page, 200, { ...OUTLINE, completedAt: '2026-12-01T15:00:00.000Z' });
      await page.reload();
      await page.getByText(/Você concluiu este curso/).waitFor();
      await expectNoViolations(page, `mapa concluído (${scheme})`);
      await lessonApi(page, 200, LESSON);
      await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
      await page.getByRole('button', { name: 'Concluir aula' }).waitFor();
      await expectNoViolations(page, `aula com botão (${scheme})`);
    });
  }
});
