import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

const PAGE = {
  id: COURSE_ID,
  slug: 'demo',
  title: 'Curso Demonstrativo',
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Descrição.' }] }],
  },
  workloadHours: 3,
  sequenceMode: 'guided',
  availability: 'open',
  offer: { id: OFFER_ID, kind: 'free', priceCents: 0, accessMonths: 3, maxInstallments: 1 },
  syllabus: ['Módulo 1'],
};
const CATALOG_ITEM = {
  id: COURSE_ID,
  slug: 'demo',
  title: 'Curso Demonstrativo',
  summary: 'Resumo.',
  workloadHours: 3,
  sequenceMode: 'guided',
  availability: 'open',
  offer: PAGE.offer,
};

type Access = { hasAccess: boolean; reason: string; expiresAt: string | null };
const NONE: Access = { hasAccess: false, reason: 'no_access', expiresAt: null };
const ACTIVE: Access = { hasAccess: true, reason: 'ok', expiresAt: '2027-01-10T12:00:00.000Z' };
const EXPIRED: Access = {
  hasAccess: false,
  reason: 'expired',
  expiresAt: '2026-03-05T12:00:00.000Z',
};
const SUSPENDED: Access = {
  hasAccess: false,
  reason: 'suspended',
  expiresAt: '2027-01-10T12:00:00.000Z',
};

interface Stub {
  access: Access | 'anonymous' | 'terms';
  enrollCalls: unknown[];
  /** Resposta do POST de inscrição; `delay` em ms antes de responder. */
  enroll: { status: number; json: unknown; delay?: number };
}

async function stub(page: Page, initial: Partial<Stub> = {}) {
  const state: Stub = {
    access: NONE,
    enrollCalls: [],
    enroll: { status: 201, json: { status: 'enrolled', access: ACTIVE } },
    ...initial,
  };
  await page.route('**/api/me/legal', (route) =>
    route.fulfill({ json: { accepted: true, documents: [] } }),
  );
  await page.route('**/cursos/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const shell = await route.fetch({ url: new URL('/', route.request().url()).toString() });
    return route.fulfill({ response: shell });
  });
  await page.route('**/api/public/courses/**', (route) => route.fulfill({ json: PAGE }));
  await page.route('**/api/courses/*/access', (route) => {
    if (state.access === 'anonymous') {
      return route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } });
    }
    if (state.access === 'terms') {
      return route.fulfill({ status: 403, json: { error: { code: 'terms_required' } } });
    }
    return route.fulfill({ json: state.access });
  });
  await page.route('**/api/courses/*/enroll', async (route) => {
    state.enrollCalls.push(route.request().postDataJSON());
    if (state.enroll.delay) await new Promise((resolve) => setTimeout(resolve, state.enroll.delay));
    if (state.enroll.status === 201) state.access = ACTIVE;
    return route.fulfill({ status: state.enroll.status, json: state.enroll.json });
  });
  await page.route('**/api/catalog/courses', (route) =>
    route.fulfill({
      json: {
        courses: [
          {
            ...CATALOG_ITEM,
            access: state.access === 'anonymous' || state.access === 'terms' ? NONE : state.access,
          },
        ],
      },
    }),
  );
  return state;
}

async function expectNoViolations(page: Page, context: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `violações axe em ${context}`,
  ).toEqual([]);
}

test.describe('página do curso', () => {
  test('sem sessão: convite para entrar com retorno à própria página', async ({ page }) => {
    await stub(page, { access: 'anonymous' });
    await page.goto('/cursos/demo');
    const link = page.getByRole('link', { name: 'Entrar para se inscrever' });
    await expect(link).toHaveAttribute('href', '/entrar?returnTo=%2Fcursos%2Fdemo');
    await expect(page.getByRole('button', { name: 'Inscrever-se' })).toHaveCount(0);
  });

  test('logada e sem acesso: "Inscrever-se" envia a oferta que a pessoa viu e mostra o acesso', async ({
    page,
  }) => {
    const state = await stub(page);
    await page.goto('/cursos/demo');
    await page.getByRole('button', { name: 'Inscrever-se' }).click();
    await expect(page.getByText('Você está inscrito. Acesso até 10/01/2027.')).toBeVisible();
    expect(state.enrollCalls).toEqual([{ offerId: OFFER_ID }]);
    await expect(page.getByRole('button', { name: /Inscrever-se/ })).toHaveCount(0);
  });

  test('duplo clique: o botão desabilita e só UM pedido sai', async ({ page }) => {
    const state = await stub(page, {
      enroll: { status: 201, json: { status: 'enrolled', access: ACTIVE }, delay: 600 },
    });
    await page.goto('/cursos/demo');
    const button = page.getByRole('button', { name: 'Inscrever-se' });
    await button.dblclick();
    await expect(page.getByRole('button', { name: 'Inscrevendo…' })).toBeDisabled();
    await expect(page.getByText(/Você está inscrito/)).toBeVisible();
    expect(state.enrollCalls).toHaveLength(1);
  });

  test('já tem acesso: mostra até quando e não oferece o botão', async ({ page }) => {
    await stub(page, { access: ACTIVE });
    await page.goto('/cursos/demo');
    await expect(page.getByText('Você está inscrito. Acesso até 10/01/2027.')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  });

  test('acesso expirado: avisa a data e oferece "Inscrever-se de novo" (o progresso continua)', async ({
    page,
  }) => {
    await stub(page, { access: EXPIRED });
    await page.goto('/cursos/demo');
    await expect(page.getByText('Seu acesso anterior terminou em 05/03/2026.')).toBeVisible();
    await expect(page.getByText(/continua de onde parou/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inscrever-se de novo' })).toBeVisible();
  });

  test('acesso suspenso: sem botão, com orientação', async ({ page }) => {
    await stub(page, { access: SUSPENDED });
    await page.goto('/cursos/demo');
    await expect(
      page.getByText('Seu acesso a este curso está suspenso. Fale com o suporte.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Inscrever/ })).toHaveCount(0);
  });

  test('termos não aceitos: orienta a aceitar em "Minha conta", sem botão', async ({ page }) => {
    await stub(page, { access: 'terms' });
    await page.goto('/cursos/demo');
    await expect(page.getByRole('alert')).toContainText('aceite os Termos de Uso');
    await expect(page.getByRole('link', { name: 'Minha conta' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: /Inscrever/ })).toHaveCount(0);
  });

  for (const [code, status, text] of [
    ['offer_unavailable', 409, 'Esta oferta não está mais disponível.'],
    ['offer_not_free', 409, 'Esta oferta não é gratuita e não pode ser iniciada por aqui.'],
    ['enrollment_suspended', 403, 'Seu acesso a este curso está suspenso. Fale com o suporte.'],
    ['account_suspended', 403, 'Sua conta está suspensa. Fale com o suporte.'],
    ['terms_required', 403, 'Aceite os Termos de Uso e a Política de Privacidade para continuar.'],
    ['unauthenticated', 401, 'Sua sessão expirou. Entre novamente.'],
    ['internal_error', 500, 'Não foi possível fazer a inscrição agora. Tente novamente.'],
  ] as const) {
    test(`erro do servidor "${code}" aparece em português e libera o botão de novo`, async ({
      page,
    }) => {
      await stub(page, { enroll: { status, json: { error: { code } } } });
      await page.goto('/cursos/demo');
      await page.getByRole('button', { name: 'Inscrever-se' }).click();
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Inscrever-se' })).toBeEnabled();
    });
  }
});

test.describe('catálogo', () => {
  test('o curso gratuito aberto tem "Inscrever-se"; depois mostra o acesso na própria carta', async ({
    page,
  }) => {
    const state = await stub(page);
    await page.goto('/cursos');
    const card = page.getByRole('listitem').filter({ hasText: 'Curso Demonstrativo' });
    await card.getByRole('button', { name: 'Inscrever-se' }).click();
    await expect(card.getByText('Você está inscrito. Acesso até 10/01/2027.')).toBeVisible();
    expect(state.enrollCalls).toEqual([{ offerId: OFFER_ID }]);
  });

  test('quem já está inscrito vê o acesso e nenhum botão', async ({ page }) => {
    await stub(page, { access: ACTIVE });
    await page.goto('/cursos');
    const card = page.getByRole('listitem').filter({ hasText: 'Curso Demonstrativo' });
    await expect(card.getByText(/Você está inscrito/)).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
  });
});

test.describe('login com retorno', () => {
  test('entrar com returnTo guarda o caminho; a confirmação do link volta para a página do curso', async ({
    page,
  }) => {
    await stub(page, { access: 'anonymous' });
    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: false } }));
    await page.route('**/api/auth/link/confirm', (route) =>
      route.fulfill({ json: { status: 'ok' } }),
    );
    await page.goto('/cursos/demo');
    await page.getByRole('link', { name: 'Entrar para se inscrever' }).click();
    await expect(page).toHaveURL(/\/entrar\?returnTo=%2Fcursos%2Fdemo/);
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('hub:return-to')))
      .toContain('/cursos/demo');

    await page.goto('/entrar/confirmar#token=abc');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/cursos\/demo$/);
    // uso único: o destino foi consumido
    expect(await page.evaluate(() => window.localStorage.getItem('hub:return-to'))).toBeNull();
  });

  test('returnTo externo ou perigoso é ignorado: nada é guardado e o login vai para a página inicial', async ({
    page,
  }) => {
    await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: false } }));
    await page.route('**/api/auth/link/confirm', (route) =>
      route.fulfill({ json: { status: 'ok' } }),
    );
    for (const bad of [
      'https://evil.example/x',
      '//evil.example',
      '/api/me',
      'javascript:alert(1)',
    ]) {
      await page.goto(`/entrar?returnTo=${encodeURIComponent(bad)}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => window.localStorage.getItem('hub:return-to')),
        bad,
      ).toBeNull();
    }
    await page.goto('/entrar/confirmar#token=abc');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  });

  test('destino adulterado no armazenamento (URL externa) é recusado na volta', async ({
    page,
  }) => {
    await page.route('**/api/auth/link/confirm', (route) =>
      route.fulfill({ json: { status: 'ok' } }),
    );
    await page.goto('/sobre');
    await page.evaluate(() =>
      window.localStorage.setItem(
        'hub:return-to',
        JSON.stringify({ path: 'https://evil.example/', at: Date.now() }),
      ),
    );
    await page.goto('/entrar/confirmar#token=abc');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  });
});

test.describe('acessibilidade', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações nos estados da inscrição (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [label, access] of [
        ['sem sessão', 'anonymous'],
        ['sem acesso', NONE],
        ['inscrito', ACTIVE],
        ['expirado', EXPIRED],
        ['suspenso', SUSPENDED],
        ['termos', 'terms'],
      ] as const) {
        await page.unrouteAll();
        await stub(page, { access });
        await page.goto('/cursos/demo');
        await page.getByRole('heading', { level: 1 }).waitFor();
        await expect(page.getByText('Verificando o seu acesso…')).toHaveCount(0);
        await expectNoViolations(page, `${label} (${scheme})`);
      }
    });
  }
});
