import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const LESSON = '00000000-0000-4000-8000-000000000001';
const q = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const o = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;

/** Q1 (escolha única): opções 1 a 2; Q2 (múltipla): opções 3 a 5. O servidor NÃO manda o gabarito. */
const quizView = (
  overrides: {
    attemptsUsed?: number;
    attemptsLeft?: number | null;
    passed?: boolean;
    canAttempt?: boolean;
    last?: { number: number; scorePercent: number; passed: boolean } | null;
    preview?: boolean;
    completed?: boolean;
  } = {},
) => ({
  ...(overrides.preview ? { preview: true } : {}),
  course: { id: COURSE_ID, title: 'Curso Demonstrativo' },
  lesson: {
    id: LESSON,
    title: 'Quiz do módulo',
    isOptional: false,
    body: null,
    kind: 'quiz',
    quiz: {
      quiz: {
        minScorePercent: 70,
        maxAttempts: null,
        feedback: 'immediate',
        questions: [
          {
            id: q(1),
            prompt: 'Qual é a capital do Brasil?',
            kind: 'single',
            points: 1,
            options: [
              { id: o(1), text: 'Brasília' },
              { id: o(2), text: 'Rio de Janeiro' },
            ],
          },
          {
            id: q(2),
            prompt: 'Quais são cores primárias?',
            kind: 'multiple',
            points: 2,
            options: [
              { id: o(3), text: 'Vermelho' },
              { id: o(4), text: 'Verde' },
              { id: o(5), text: 'Azul' },
            ],
          },
        ],
      },
      attemptsUsed: overrides.attemptsUsed ?? 0,
      attemptsLeft: overrides.attemptsLeft === undefined ? null : overrides.attemptsLeft,
      passed: overrides.passed ?? false,
      canAttempt: overrides.canAttempt ?? true,
      last: overrides.last ?? null,
    },
  },
  completed: overrides.completed ?? false,
  previous: null,
  next: null,
});

const failed = {
  attempt: {
    number: 1,
    scorePercent: 33,
    earnedPoints: 1,
    totalPoints: 3,
    passed: false,
    minScorePercent: 70,
  },
  attemptsUsed: 1,
  attemptsLeft: null,
  review: [
    { questionId: q(1), correct: true, selected: [o(1)], correctOptionIds: [o(1)] },
    { questionId: q(2), correct: false, selected: [o(3)], correctOptionIds: [o(3), o(5)] },
  ],
};
const passedResponse = {
  attempt: {
    number: 2,
    scorePercent: 100,
    earnedPoints: 3,
    totalPoints: 3,
    passed: true,
    minScorePercent: 70,
  },
  attemptsUsed: 2,
  attemptsLeft: null,
  review: [
    { questionId: q(1), correct: true, selected: [o(1)], correctOptionIds: [o(1)] },
    { questionId: q(2), correct: true, selected: [o(3), o(5)], correctOptionIds: [o(3), o(5)] },
  ],
  completion: { status: 'completed', courseCompleted: false, courseJustCompleted: false },
};

async function stub(
  page: Page,
  options: {
    lesson?: () => unknown;
    attempt?: (body: Record<string, any>) => { status: number; json: unknown };
  } = {},
) {
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      json: {
        displayName: 'Ana',
        certificateName: null,
        certificateNameConfirmedAt: null,
        theme: 'system',
        autoAdvance: false,
      },
    }),
  );
  await page.route('**/api/lessons/*', (route) =>
    route.fulfill({ json: (options.lesson ?? quizView)() }),
  );
  const calls: Record<string, any>[] = [];
  await page.route('**/api/lessons/*/quiz-attempts', (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    calls.push(body);
    const answer = options.attempt?.(body) ?? { status: 201, json: failed };
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  await page.route('**/api/courses/*/outline', (route) => route.fulfill({ status: 404, json: {} }));
  return calls;
}

const open = async (page: Page) => {
  await page.goto(`/estudar/${COURSE_ID}/aulas/${LESSON}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Quiz do módulo' })).toBeVisible();
};

test.describe('quiz do aluno', () => {
  test('mostra as questões com controles nativos e rótulos, sem botão de concluir e sem pista do gabarito', async ({
    page,
  }) => {
    await stub(page);
    await open(page);
    await expect(
      page.getByRole('group', { name: /1\. Qual é a capital do Brasil\?/ }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Brasília' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Vermelho' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Concluir aula' })).toHaveCount(0);
    await expect(
      page.getByText('Nota mínima para aprovar: 70%. Tentativas ilimitadas.'),
    ).toBeVisible();
    expect(await page.locator('main').innerHTML()).not.toContain('correct');
  });

  test('envia SÓ as opções marcadas (nunca nota nem aprovação) e mostra a nota e as respostas certas', async ({
    page,
  }) => {
    const calls = await stub(page);
    await open(page);
    await page.getByRole('radio', { name: 'Brasília' }).check();
    await page.getByRole('checkbox', { name: 'Vermelho' }).check();
    await page.getByRole('button', { name: 'Enviar respostas' }).click();
    await expect(page.getByText('Tentativa 1: 33% (1 de 3 pontos).')).toBeVisible();
    await expect(
      page.getByText('Não aprovado (mínimo 70%). Você pode tentar de novo.'),
    ).toBeVisible();
    await expect(page.getByText('Resposta certa: Vermelho; Azul')).toBeVisible();
    expect(calls).toEqual([
      {
        answers: [
          { questionId: q(1), optionIds: [o(1)] },
          { questionId: q(2), optionIds: [o(3)] },
        ],
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/score|passed|correct/);
  });

  test('na escolha única só uma opção fica marcada; na múltipla várias', async ({ page }) => {
    await stub(page);
    await open(page);
    await page.getByRole('radio', { name: 'Brasília' }).check();
    await page.getByRole('radio', { name: 'Rio de Janeiro' }).check();
    await expect(page.getByRole('radio', { name: 'Brasília' })).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'Vermelho' }).check();
    await page.getByRole('checkbox', { name: 'Azul' }).check();
    await expect(page.getByRole('checkbox', { name: 'Vermelho' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Azul' })).toBeChecked();
  });

  test('aprovou: mostra o resultado, a aula fica concluída e o formulário some', async ({
    page,
  }) => {
    let done = false;
    await stub(page, {
      lesson: () =>
        done
          ? quizView({
              attemptsUsed: 2,
              passed: true,
              canAttempt: false,
              completed: true,
              last: { number: 2, scorePercent: 100, passed: true },
            })
          : quizView(),
      attempt: () => {
        done = true;
        return { status: 201, json: passedResponse };
      },
    });
    await open(page);
    await page.getByRole('button', { name: 'Enviar respostas' }).click();
    await expect(page.getByText('Aprovado!')).toBeVisible();
    await expect(page.getByText('Você foi aprovado neste quiz.')).toBeVisible();
    await expect(page.getByText('Aula concluída.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar respostas' })).toHaveCount(0);
  });

  test('sem conexão: recusa antes de enviar com uma mensagem clara e não perde as respostas', async ({
    page,
    context,
  }) => {
    const calls = await stub(page);
    await open(page);
    await page.getByRole('radio', { name: 'Brasília' }).check();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Enviar respostas' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'exige conexão com a internet' }),
    ).toBeVisible();
    expect(calls).toHaveLength(0);
    await expect(page.getByRole('radio', { name: 'Brasília' })).toBeChecked();
    await context.setOffline(false);
  });

  test('erros do servidor viram mensagens claras (tentativas esgotadas, resposta inválida)', async ({
    page,
  }) => {
    let code = 'attempts_exhausted';
    await stub(page, {
      attempt: () => ({
        status: code === 'attempts_exhausted' ? 409 : 400,
        json: { error: { code } },
      }),
    });
    await open(page);
    await page.getByRole('button', { name: 'Enviar respostas' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Você já usou todas as tentativas deste quiz.',
    );
    code = 'invalid_answers';
    await page.getByRole('button', { name: 'Enviar respostas' }).click();
    await expect(page.getByRole('alert')).toContainText('Recarregue a página');
  });

  test('tentativas esgotadas: a aula mostra o aviso e não oferece o formulário', async ({
    page,
  }) => {
    await stub(page, {
      lesson: () =>
        quizView({
          attemptsUsed: 2,
          attemptsLeft: 0,
          canAttempt: false,
          last: { number: 2, scorePercent: 40, passed: false },
        }),
    });
    await open(page);
    await expect(page.getByText('Última tentativa (nº 2): 40% — não aprovado.')).toBeVisible();
    await expect(page.getByText('Você já usou todas as tentativas deste quiz.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar respostas' })).toHaveCount(0);
  });

  test('na prévia da Staff o envio fica desabilitado e nada é enviado', async ({ page }) => {
    await stub(page);
    await page.route('**/api/staff/preview/courses/*/lessons/*', (route) =>
      route.fulfill({ json: quizView({ preview: true }) }),
    );
    await page.route('**/api/me/access', (route) =>
      route.fulfill({
        json: { roles: ['student', 'admin'], capabilities: ['staff.read'], recentAuth: false },
      }),
    );
    await page.goto(`/staff/previa/${COURSE_ID}/aulas/${LESSON}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Quiz do módulo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar respostas' })).toBeDisabled();
    await expect(page.getByText('Na prévia o quiz não pode ser enviado')).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`acessibilidade (WCAG 2.2 AA) no ${scheme === 'light' ? 'claro' : 'escuro'}, com resultado e sem rolagem horizontal no celular`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stub(page);
      await open(page);
      await page.getByRole('radio', { name: 'Brasília' }).check();
      await page.getByRole('button', { name: 'Enviar respostas' }).click();
      await expect(page.getByText('Tentativa 1: 33%')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations).toEqual([]);
      await page.setViewportSize({ width: 375, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
});
