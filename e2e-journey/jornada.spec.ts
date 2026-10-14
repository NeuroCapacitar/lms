import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * PRIMEIRA JORNADA E2E GRATUITA (M3-05): navegador real, SPA real, API REAL (`createApp`) e Postgres 18
 * de teste com todas as migrations. Nenhuma resposta é simulada. Só as bordas externas são falsas: o
 * e-mail (o link vem de uma caixa em memória), o Turnstile (aprovado sem rede) e o relógio do servidor
 * (anda para o D+7 e o D+14 sem esperar). Aluna sintética e Suporte com grant; nenhum dado real.
 */
const RUN = Date.now().toString(36);
const STUDENT_EMAIL = `aluna.${RUN}@example.test`;
const SUPPORT_EMAIL = 'suporte.jornada@example.test';
const BETO_EMAIL = 'beto.jornada@example.test';

interface Ids {
  demoCourseId: string;
  demoOfferId: string;
  otherCourseId: string;
  otherLessonId: string;
}
interface Counts {
  entitlement: number;
  enrollment: number;
  lessonCompletion: number;
  courseCompletion: number;
}

test.describe.configure({ mode: 'serial' });

let studentContext: BrowserContext;
let supportContext: BrowserContext;
let student: Page;
let support: Page;
let control: APIRequestContext;
let ids: Ids;
/** Tempo de resposta (ms) das chamadas principais da API durante a jornada. */
const latencies: { call: string; ms: number }[] = [];

const WIDGET = `window.turnstile = { render: (el, o) => { setTimeout(() => o.callback("t"), 0); return "w"; }, remove: () => {} };`;

async function newActor(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext();
  // O widget real da Cloudflare não carrega no teste: um duble entrega o token na hora.
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: WIDGET }),
  );
  return context;
}

const counts = async () => (await (await control.get('/__test/counts')).json()) as Counts;

/** O último link de acesso na caixa falsa para o e-mail, ou `undefined` se ainda não há nenhum. */
async function latestLink(email: string): Promise<string | undefined> {
  const response = await control.get(`/__test/link?email=${encodeURIComponent(email)}`);
  return response.ok() ? ((await response.json()) as { link: string }).link : undefined;
}

/**
 * Pede o link pela tela, lê o link na caixa falsa e o confirma (o clique em "Entrar" consome o link). O e-mail sai
 * pela outbox, depois da resposta do pedido: quem já entrou antes tem um link ANTIGO (já consumido) na caixa, então
 * só vale um link DIFERENTE do que havia antes do pedido.
 */
async function signIn(page: Page, email: string) {
  const previous = await latestLink(email);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
  await expect(page.getByRole('status').first()).toBeVisible();
  let link: string | undefined;
  await expect
    .poll(async () => {
      const current = await latestLink(email);
      link = current !== previous ? current : undefined;
      return link;
    })
    .toBeTruthy();
  await page.goto(link!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
}

/**
 * Aceita os termos se a tela pedir. Espera a tela decidir (aceite OU a página já pronta) em vez de
 * olhar uma vez só: a consulta ao aceite chega depois do primeiro desenho.
 */
async function acceptTermsIfAsked(page: Page, ready: Locator) {
  const heading = page.getByRole('heading', { name: 'Antes de continuar' });
  const seen = await Promise.race([
    heading.waitFor().then(() => 'terms' as const),
    ready.waitFor().then(() => 'ready' as const),
  ]);
  if (seen === 'terms') {
    await page.getByLabel('Li e aceito os Termos de Uso e a Política de Privacidade.').check();
    await page.getByLabel('Declaro ter 18 anos ou mais.').check();
    await page.getByRole('button', { name: 'Aceitar e continuar' }).click();
    await expect(heading).toHaveCount(0);
  }
}

/** Mede a latência das chamadas da API que a tela faz. */
function measure(page: Page) {
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    const timing = request.timing();
    if (timing.responseEnd >= 0) {
      latencies.push({
        call: `${request.method()} ${url.pathname.replace(/[0-9a-f-]{36}|[0-9A-Za-z]{32}/g, ':id')}`,
        ms: Math.round(timing.responseEnd),
      });
    }
  });
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  control = await playwright.request.newContext({ baseURL: baseURL! });
  ids = (await (await control.get('/__test/ids')).json()) as Ids;
  studentContext = await newActor(browser);
  supportContext = await newActor(browser);
  student = await studentContext.newPage();
  support = await supportContext.newPage();
  measure(student);
  measure(support);
});
test.afterAll(async () => {
  await studentContext?.close();
  await supportContext?.close();
  await control?.dispose();
});

test('1. a aluna entra por link de acesso (magic link) e aceita os termos', async () => {
  await signIn(student, STUDENT_EMAIL);
  await student.goto('/cursos');
  await expect(student.getByRole('heading', { name: 'Antes de continuar' })).toBeVisible();
  await acceptTermsIfAsked(student, student.getByRole('heading', { level: 1, name: 'Cursos' }));
  await expect(student.getByRole('heading', { level: 1, name: 'Cursos' })).toBeVisible();
});

test('2. o catálogo mostra o curso gratuito e "Inscrever-se" dá acesso, sem pagamento', async () => {
  const card = student.getByRole('listitem').filter({ hasText: 'Curso Demonstrativo' });
  await expect(card).toContainText('Inscrições abertas · Gratuito · acesso por 3 meses');
  const before = await counts();
  await card.getByRole('button', { name: 'Inscrever-se' }).click();
  await expect(
    card.getByText(/Você está inscrito\. Acesso até \d{2}\/\d{2}\/\d{4}\./),
  ).toBeVisible();
  const after = await counts();
  expect(after.entitlement).toBe(before.entitlement + 1);
  expect(after.enrollment).toBe(before.enrollment + 1);
});

test('3. aula D+0 abre; módulos D+7 e D+14 ficam bloqueados e o conteúdo bloqueado nunca chega', async () => {
  await student
    .getByRole('listitem')
    .filter({ hasText: 'Curso Demonstrativo' })
    .getByRole('link', { name: 'Ir para o curso' })
    .click();
  await expect(
    student.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
  ).toBeVisible();
  await expect(
    student.getByText('Progresso: 0% (0 de 5 aulas obrigatórias concluídas)'),
  ).toBeVisible();
  await expect(
    student.getByRole('heading', {
      level: 2,
      name: /Módulo 2: .* \(libera em \d{2}\/\d{2}\/\d{4}\)/,
    }),
  ).toBeVisible();
  await expect(
    student.getByRole('heading', {
      level: 2,
      name: /Módulo 3: .* \(libera em \d{2}\/\d{2}\/\d{4}\)/,
    }),
  ).toBeVisible();
  await expect(student.getByRole('link', { name: /Conceito central/ })).toHaveCount(0);
  await expect(student.getByRole('link', { name: /Boas-vindas/ })).toBeVisible();

  // pelo servidor: a aula do módulo D+7 responde 403 SEM título nem corpo
  const outline = await student.evaluate(
    async (courseId) => (await fetch(`/api/courses/${courseId}/outline`)).json(),
    ids.demoCourseId,
  );
  const lessonIds = (
    outline as { modules: { lessons: { id: string; title: string }[] }[] }
  ).modules.flatMap((m) => m.lessons);
  const locked = lessonIds.find((l) => l.title === 'Conceito central')!;
  const result = await student.evaluate(async (id) => {
    const response = await fetch(`/api/lessons/${id}`);
    return { status: response.status, text: await response.text() };
  }, locked.id);
  expect(result.status).toBe(403);
  expect(result.text).toContain('drip_locked');
  expect(result.text).not.toContain('Conceito central');
  expect(result.text).not.toContain('Texto de exemplo');
  // e na tela, a mesma coisa
  await student.goto(`/estudar/${ids.demoCourseId}/aulas/${locked.id}`);
  await expect(student.getByRole('heading', { level: 1, name: 'Aula bloqueada' })).toBeVisible();
  await expect(student.getByRole('status')).toContainText('Libera em');
  await expect(student.getByText('Texto de exemplo')).toHaveCount(0);
});

test('4. conclui as aulas obrigatórias do módulo 1 (a segunda só abre depois da primeira)', async () => {
  await student.goto(`/estudar/${ids.demoCourseId}`);
  await student.getByRole('link', { name: /Boas-vindas/ }).click();
  await expect(student.getByText('Texto de exemplo da primeira aula.')).toBeVisible();
  await student.getByRole('button', { name: 'Concluir aula' }).click();
  await expect(student.getByText('Aula concluída.').first()).toBeVisible();
  await student.getByRole('link', { name: 'Como estudar aqui →' }).click();
  await student.getByRole('button', { name: 'Concluir aula' }).click();
  await expect(student.getByText('Aula concluída.').first()).toBeVisible();
  await student.goto(`/estudar/${ids.demoCourseId}`);
  await expect(
    student.getByText('Progresso: 40% (2 de 5 aulas obrigatórias concluídas)'),
  ).toBeVisible();
});

test('5. com o relógio em D+15 abrem os módulos 2 e 3; concluir a última obrigatória conclui o curso', async () => {
  const advanced = await control.post('/__test/advance?days=15');
  expect(advanced.ok()).toBe(true);
  await student.goto(`/estudar/${ids.demoCourseId}`);
  for (const title of ['Conceito central', 'Revisão', 'Próximos passos']) {
    await student.getByRole('link', { name: new RegExp(title) }).click();
    await student.getByRole('button', { name: 'Concluir aula' }).click();
    if (title === 'Próximos passos') {
      await expect(
        student.getByText('Aula concluída. Parabéns, você concluiu o curso!'),
      ).toBeVisible();
    } else {
      await expect(student.getByText('Aula concluída.').first()).toBeVisible();
    }
    await student.goto(`/estudar/${ids.demoCourseId}`);
  }
  await expect(
    student.getByText('Progresso: 100% (5 de 5 aulas obrigatórias concluídas)'),
  ).toBeVisible();
  await expect(
    student.getByText(/Você concluiu este curso em \d{2}\/\d{2}\/\d{4}\./),
  ).toBeVisible();
  // a aula opcional ficou de fora e o curso concluiu mesmo assim
  const totals = await counts();
  expect(totals.courseCompletion).toBe(1);
  expect(totals.lessonCompletion).toBe(5);
});

test('6. a aluna sai, perde o acesso à área logada e, ao reentrar, o progresso continua', async () => {
  await student.goto('/conta');
  await student.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(student).toHaveURL(/localhost:\d+\/$/);
  await student.goto(`/estudar/${ids.demoCourseId}`);
  await expect(student.getByRole('alert')).toContainText('Entre na sua conta para estudar.');
  await signIn(student, STUDENT_EMAIL);
  await student.goto(`/estudar/${ids.demoCourseId}`);
  await expect(
    student.getByText('Progresso: 100% (5 de 5 aulas obrigatórias concluídas)'),
  ).toBeVisible();
  await expect(student.getByText(/Você concluiu este curso em/)).toBeVisible();
});

test('7. negativos de autenticação e de acesso: sem sessão, aula de outro curso e sessão expirada', async ({
  browser,
}) => {
  // sem sessão: 401 em todas as rotas do aluno
  const anonymous = await newActor(browser);
  for (const [method, path] of [
    ['GET', `/api/courses/${ids.demoCourseId}/outline`],
    ['GET', `/api/lessons/${ids.otherLessonId}`],
    ['GET', '/api/catalog/courses'],
    ['GET', `/api/courses/${ids.demoCourseId}/access`],
  ] as const) {
    const response = await anonymous.request.fetch(`${path}`, { method });
    expect(response.status(), path).toBe(401);
  }
  await anonymous.close();

  // aula de OUTRO curso (em que ela não está inscrita): 403, sem dado nenhum
  const foreign = await student.evaluate(async (id) => {
    const response = await fetch(`/api/lessons/${id}`);
    return { status: response.status, text: await response.text() };
  }, ids.otherLessonId);
  expect(foreign).toEqual({
    status: 403,
    text: '{"error":{"code":"access_denied","reason":"no_access"}}',
  });
  const foreignComplete = await student.evaluate(async (id) => {
    const response = await fetch(`/api/lessons/${id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return response.status;
  }, ids.otherLessonId);
  expect(foreignComplete).toBe(403);

  // sessão expirada (o banco a vence): a API devolve 401 e a tela pede o login
  await control.post(`/__test/expire-session?email=${encodeURIComponent(STUDENT_EMAIL)}`);
  const expired = await student.evaluate(
    async (id) => (await fetch(`/api/courses/${id}/outline`)).status,
    ids.demoCourseId,
  );
  expect(expired).toBe(401);
  await student.goto(`/estudar/${ids.demoCourseId}`);
  await expect(student.getByRole('alert')).toContainText('Entre na sua conta para estudar.');
});

test('8. o Suporte com grant matricula manualmente, suspende, reativa e abre a prévia', async () => {
  await signIn(support, SUPPORT_EMAIL);
  await support.goto(`/staff/cursos/${ids.demoCourseId}`);
  await acceptTermsIfAsked(support, support.getByRole('tab', { name: 'Inscritos', exact: true }));
  await support.getByRole('tab', { name: 'Inscritos', exact: true }).click();
  const table = support.getByRole('table', { name: 'Pessoas inscritas neste curso' });
  await expect(table.getByRole('row').filter({ hasText: STUDENT_EMAIL })).toBeVisible();

  // matrícula manual de pessoa JÁ cadastrada (a Beto)
  await support.getByLabel('E-mail da pessoa').fill(BETO_EMAIL);
  await support.getByLabel('Prazo (meses)').fill('6');
  await support.getByLabel('Motivo').fill('Cortesia da turma piloto');
  await support.getByRole('button', { name: 'Matricular', exact: true }).click();
  await expect(
    support.getByText(/Pessoa matriculada\. Acesso até \d{2}\/\d{2}\/\d{4}\./),
  ).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: BETO_EMAIL })).toContainText('Ativa');
  // pessoa que NÃO tem conta: erro claro, nada criado
  await support.getByLabel('E-mail da pessoa').fill('ninguem.jornada@example.test');
  await support.getByLabel('Motivo').fill('Tentativa sem cadastro');
  await support.getByRole('button', { name: 'Matricular', exact: true }).click();
  await expect(
    support.getByRole('alert').filter({ hasText: 'Não há conta com este e-mail.' }),
  ).toBeVisible();

  // suspender a aluna: vale na requisição seguinte
  const studentRow = table.getByRole('row').filter({ hasText: STUDENT_EMAIL });
  await expect(studentRow).toContainText('100%');
  await studentRow.getByRole('button', { name: /^Suspender/ }).click();
  const suspendForm = support.getByRole('form', { name: /^Suspender/ });
  await suspendForm.getByLabel('Motivo').fill('Uso indevido do material');
  await suspendForm.getByRole('button', { name: 'Confirmar suspensão' }).click();
  await expect(support.getByText(/^Acesso de .* suspenso\.$/)).toBeVisible();
  await expect(studentRow).toContainText('Suspensa');
  // a aluna reentra (a sessão expirou no passo 7) e o servidor nega a suspensa
  await signIn(student, STUDENT_EMAIL);
  const blocked = await student.evaluate(async (id) => {
    const response = await fetch(`/api/courses/${id}/outline`);
    return { status: response.status, text: await response.text() };
  }, ids.demoCourseId);
  expect(blocked).toEqual({
    status: 403,
    text: '{"error":{"code":"access_denied","reason":"suspended"}}',
  });
  await student.goto(`/estudar/${ids.demoCourseId}`);
  await expect(student.getByRole('alert')).toContainText('Seu acesso a este curso está suspenso.');

  // reativar: o acesso volta, com a mesma âncora e o mesmo progresso
  await studentRow.getByRole('button', { name: /^Reativar/ }).click();
  await expect(support.getByText(/^Acesso de .* reativado\.$/)).toBeVisible();
  await student.goto(`/estudar/${ids.demoCourseId}`);
  await expect(
    student.getByText('Progresso: 100% (5 de 5 aulas obrigatórias concluídas)'),
  ).toBeVisible();

  // prévia: tudo liberado e NADA é gravado
  const before = await counts();
  await support.getByRole('link', { name: 'Ver como aluno (prévia do curso publicado)' }).click();
  await expect(support.getByRole('region', { name: 'Aviso de prévia' })).toHaveText(
    'Prévia — nada é gravado.',
  );
  await support.getByRole('link', { name: /Conceito central/ }).click();
  await expect(support.getByRole('button', { name: 'Concluir aula' })).toBeDisabled();
  await support.goto(`/staff/previa/${ids.demoCourseId}`);
  for (const title of ['Boas-vindas', 'Revisão', 'Próximos passos']) {
    await support.getByRole('link', { name: new RegExp(title) }).click();
    await expect(support.getByRole('region', { name: 'Aviso de prévia' })).toBeVisible();
    await support.goBack();
  }
  expect(await counts()).toEqual(before);
});

test('9. o Suporte expirado não escreve; a aluna comum não abre a prévia nem a área da equipe', async () => {
  const foreignPreview = await student.evaluate(
    async (id) => (await fetch(`/api/staff/preview/courses/${id}/outline`)).status,
    ids.demoCourseId,
  );
  expect(foreignPreview).toBe(403);
  const foreignList = await student.evaluate(
    async (id) => (await fetch(`/api/staff/courses/${id}/enrollments`)).status,
    ids.demoCourseId,
  );
  expect(foreignList).toBe(403);
  await control.post(`/__test/expire-session?email=${encodeURIComponent(SUPPORT_EMAIL)}`);
  const status = await support.evaluate(
    async (id) => (await fetch(`/api/staff/courses/${id}/enrollments`)).status,
    ids.demoCourseId,
  );
  expect(status).toBe(401);
});

test('10. latência das chamadas principais e logs com id de correlação, sem e-mail nem token', async () => {
  // latência: as chamadas da API do aluno e da Staff nesta jornada
  const byCall = new Map<string, number[]>();
  for (const item of latencies) byCall.set(item.call, [...(byCall.get(item.call) ?? []), item.ms]);
  const rows = [...byCall.entries()].map(([call, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      call,
      n: sorted.length,
      p50: sorted[Math.floor(sorted.length / 2)]!,
      max: sorted.at(-1)!,
    };
  });
  rows.sort((a, b) => b.max - a.max);
  test.info().annotations.push({
    type: 'latência (ms, local)',
    description: rows
      .slice(0, 8)
      .map((r) => `${r.call} n=${r.n} p50=${r.p50} max=${r.max}`)
      .join(' | '),
  });
  console.info('LATÊNCIA (ms, servidor local + Postgres de teste)');
  for (const row of rows)
    console.info(
      `  ${row.call.padEnd(46)} n=${String(row.n).padStart(2)}  p50=${String(row.p50).padStart(4)}  max=${String(row.max).padStart(4)}`,
    );
  expect(rows.length).toBeGreaterThan(5);
  expect(
    Math.max(...rows.map((r) => r.max)),
    'nenhuma chamada passa de 3 s no ambiente de teste',
  ).toBeLessThan(3000);

  // o id de correlação nasce no servidor: o que o cliente manda é ignorado
  const response = await control.get('/api/health/live', {
    headers: { 'x-request-id': 'forjado' },
  });
  const id = response.headers()['x-request-id'];
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(id).not.toBe('forjado');

  // logs: cada evento de /api tem requestId e nenhum traz e-mail, link ou token
  const { lines } = (await (await control.get('/__test/logs')).json()) as { lines: string[] };
  const events = lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return typeof parsed.path === 'string' ? [parsed] : [];
    } catch {
      return [];
    }
  });
  const api = events.filter((event) => String(event.path).startsWith('/api/'));
  expect(api.length).toBeGreaterThan(20);
  for (const event of api)
    expect(event.requestId, JSON.stringify(event).slice(0, 120)).toMatch(/^[0-9a-f-]{36}$/);
  const text = lines.join('\n');
  for (const secret of [
    STUDENT_EMAIL,
    SUPPORT_EMAIL,
    BETO_EMAIL,
    'entrar/confirmar',
    'token=',
    'sessionToken',
    'better-auth.session',
  ]) {
    expect(text, `o log não pode conter "${secret}"`).not.toContain(secret);
  }
});
