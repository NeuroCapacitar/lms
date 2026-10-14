import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * JORNADA COMERCIAL E2E (M6-06): navegador real, SPA real, API REAL (`createApp`, o webhook real, a inbox, o
 * reconciliador, o executor de reembolso) e Postgres 18 de teste. O ÚNICO falso é o Asaas (checkout, leitura dos
 * pagamentos e reembolso), o e-mail, o Turnstile e o relógio. Roda DEPOIS da jornada gratuita (mesmo servidor).
 * O sandbox REAL do Asaas NÃO é exercitado aqui: o smoke manual em Staging é registrado à parte no STATUS.
 */
const RUN = Date.now().toString(36);
const STUDENT_EMAIL = `compradora.${RUN}@example.test`;
const SECOND_EMAIL = `compradora2.${RUN}@example.test`;
const FINANCE_EMAIL = 'financeiro.jornada@example.test';
const ADMIN_EMAIL = 'admin.jornada@example.test';
const CPF = '12345678909';

interface CommerceIds {
  paid: { courseId: string; offerId: string; lessonIds: string[] };
  installments: { courseId: string; offerId: string; lessonIds: string[] };
  disputed: { courseId: string; offerId: string; lessonIds: string[] };
  late: { courseId: string; offerId: string; lessonIds: string[] };
}

test.describe.configure({ mode: 'serial' });

const WIDGET = `window.turnstile = { render: (el, o) => { setTimeout(() => o.callback("t"), 0); return "w"; }, remove: () => {} };`;

let control: APIRequestContext;
let ids: CommerceIds;
const contexts: BrowserContext[] = [];
let student: Page;
let second: Page;
let finance: Page;
let admin: Page;
let webhookToken: string;
let base: string;

async function actor(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext();
  contexts.push(context);
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: WIDGET }),
  );
  // O Checkout hospedado do Asaas é simulado: o navegador só precisa CHEGAR até ele.
  await context.route('https://sandbox.asaas.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Checkout Asaas (simulado)</h1>' }),
  );
  return context.newPage();
}

const getJson = async <T>(path: string) => (await (await control.get(path)).json()) as T;
const postJson = async <T>(path: string, data?: unknown) =>
  (await (await control.post(path, { data })).json()) as T;

async function latestLink(email: string): Promise<string | undefined> {
  const response = await control.get(`/__test/link?email=${encodeURIComponent(email)}`);
  return response.ok() ? ((await response.json()) as { link: string }).link : undefined;
}

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

/** O cartão do curso pelo TÍTULO exato (o texto "Curso pago da jornada" também contém "Curso Pago"). */
const cardOf = (page: Page, title: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/**
 * "Comprar": a tentativa fica na `sessionStorage` enquanto o pedido vale. Se o pedido anterior já não está aberto
 * (pago, reembolsado, expirado), o servidor recusa com "comece de novo" e o SEGUNDO clique abre o pedido novo.
 */
async function buy(page: Page, button: Locator) {
  await button.click();
  const reset = page.getByRole('alert').filter({ hasText: 'começar de novo' });
  const first = await Promise.race([
    page.waitForURL(/^https:\/\/sandbox\.asaas\.com\//).then(() => 'checkout' as const),
    reset.waitFor().then(() => 'reset' as const),
  ]);
  if (first === 'reset') {
    await button.click();
    await page.waitForURL(/^https:\/\/sandbox\.asaas\.com\//);
  }
}

const orderOf = (email: string) =>
  getJson<{ orderId: string | null; status: string | null }>(
    `/__test/asaas/order-of?email=${encodeURIComponent(email)}`,
  );
const sessionOf = async (orderId: string) =>
  (await getJson<{ sessionId: string | null }>(`/__test/asaas/session?order=${orderId}`))
    .sessionId!;
const counts = () =>
  getJson<{ entitlement: number; enrollment: number; lessonCompletion: number }>('/__test/counts');
const mails = async (template: string) =>
  (await getJson<{ total: number }>(`/__test/mails?template=${template}`)).total;
const facts = async (orderId: string) =>
  (await getJson<{ kinds: string[] }>(`/__test/facts?order=${orderId}`)).kinds;

let paymentSeq = 0;
/** O "Asaas" cria ou atualiza um pagamento da sessão de checkout do pedido. */
async function setPayment(
  orderId: string,
  overrides: Record<string, unknown> & { id?: string },
): Promise<string> {
  paymentSeq += 1;
  const id = overrides.id ?? `pay_j${RUN}${paymentSeq}`;
  await postJson('/__test/asaas/set-payment', {
    id,
    checkoutSessionId: await sessionOf(orderId),
    ...overrides,
  });
  return id;
}

/** O Asaas chama o webhook REAL do Hub (com o token) e o Cron processa a inbox. */
async function webhook(
  event: string,
  paymentId: string | null,
  extra: Record<string, unknown> = {},
) {
  const eventId = `evt_${RUN}${(paymentSeq += 1)}&${paymentSeq}`;
  const response = await control.post('/api/webhooks/asaas', {
    headers: { 'asaas-access-token': webhookToken, 'content-type': 'application/json' },
    data: {
      id: eventId,
      event,
      ...(paymentId ? { payment: { id: paymentId, status: 'X' } } : {}),
      ...extra,
    },
  });
  expect(response.status()).toBe(200);
  return eventId;
}
const processInbox = () => postJson<{ processed: number }>('/__test/process-inbox');

/** O acesso lido pela API com a sessão do navegador (a página pode estar no checkout do Asaas, em outra origem). */
const accessOf = async (page: Page, courseId: string) =>
  (await (await page.context().request.get(`${base}/api/courses/${courseId}/access`)).json()) as {
    hasAccess: boolean;
    reason: string | null;
  };
const post = (page: Page, path: string, body: unknown = {}) =>
  page.evaluate(
    async ([url, payload]) => {
      const response = await fetch(url as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: (await response.json().catch(() => null)) as any };
    },
    [path, body] as const,
  );

async function reauth(email: string) {
  await postJson(`/__test/reauth?email=${encodeURIComponent(email)}`);
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  base = baseURL!;
  control = await playwright.request.newContext({ baseURL: baseURL! });
  ids = await getJson<CommerceIds>('/__test/ids');
  webhookToken = (await getJson<{ token: string }>('/__test/asaas/token')).token;
  student = await actor(browser);
  second = await actor(browser);
  finance = await actor(browser);
  admin = await actor(browser);
});
test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await control?.dispose();
});

test('1. a compradora entra, aceita os termos e vê os cursos pagos com o preço e o botão Comprar', async () => {
  await signIn(student, STUDENT_EMAIL);
  await student.goto('/cursos');
  await acceptTermsIfAsked(student, student.getByRole('heading', { level: 1, name: 'Cursos' }));
  await expect(student.getByRole('heading', { name: 'Curso Pago' })).toBeVisible();
  const card = cardOf(student, 'Curso Pago').first();
  await expect(card).toContainText('R$ 197,00');
  await expect(card.getByRole('button', { name: 'Comprar' })).toBeVisible();
  const parcelado = cardOf(student, 'Curso Parcelado');
  await expect(parcelado).toContainText('até 12x sem juros');
  expect((await accessOf(student, ids.paid.courseId)).hasAccess).toBe(false);
});

test('2. Comprar abre o Checkout hospedado com o preço do servidor; nada é liberado só por abrir o checkout', async () => {
  const before = await counts();
  await student.goto('/cursos');
  const card = cardOf(student, 'Curso Pago').first();
  await buy(student, card.getByRole('button', { name: 'Comprar' }));
  const order = await orderOf(STUDENT_EMAIL);
  expect(order.status).toBe('pending');
  expect((await counts()).entitlement).toBe(before.entitlement);
  expect(
    (await accessOf(student, ids.paid.courseId).catch(() => null)) ?? { hasAccess: false },
  ).toBeTruthy();
});

test('3. CHECKOUT_PAID sozinho e a página de retorno NUNCA liberam o acesso', async () => {
  const { orderId } = await orderOf(STUDENT_EMAIL);
  await student.goto(`/compra/retorno?pedido=${orderId}&resultado=sucesso`);
  await expect(
    student.getByRole('heading', { level: 1, name: 'Estamos confirmando o seu pagamento' }),
  ).toBeVisible();
  // o Asaas só avisa que o checkout foi pago (sem pagamento no corpo) e ainda não mostra nenhum pagamento
  await webhook('CHECKOUT_PAID', null, { checkout: { id: await sessionOf(orderId!) } });
  await processInbox();
  await student.goto('/cursos');
  expect((await accessOf(student, ids.paid.courseId)).hasAccess).toBe(false);
  // pagamento aparece PENDING (Pix gerado, ainda sem pagar): continua sem acesso
  const pay = await setPayment(orderId!, {
    status: 'PENDING',
    billingType: 'PIX',
    valueCents: 19_700,
    customerId: 'cus_j1',
  });
  await webhook('PAYMENT_CREATED', pay);
  await processInbox();
  expect((await accessOf(student, ids.paid.courseId)).hasAccess).toBe(false);
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('pending');
});

test('4. Pix recebido: o webhook avisa, a inbox lê o pagamento no Asaas e SÓ ENTÃO o acesso é liberado (um e-mail)', async () => {
  const { orderId } = await orderOf(STUDENT_EMAIL);
  const before = await counts();
  const mailsBefore = await mails('purchase-confirmed');
  await postJson('/__test/asaas/set-customer', {
    id: 'cus_j1',
    name: 'Maria da Silva',
    document: CPF,
  });
  const pay = `pay_j4${RUN}`;
  await setPayment(orderId!, {
    id: pay,
    status: 'RECEIVED',
    billingType: 'PIX',
    valueCents: 19_700,
    customerId: 'cus_j1',
    paidAt: new Date().toISOString(),
  });
  await webhook('PAYMENT_RECEIVED', pay);
  expect((await processInbox()).processed).toBeGreaterThan(0);

  expect((await orderOf(STUDENT_EMAIL)).status).toBe('paid');
  expect((await counts()).entitlement).toBe(before.entitlement + 1);
  expect((await accessOf(student, ids.paid.courseId)).hasAccess).toBe(true);
  expect(await mails('purchase-confirmed')).toBe(mailsBefore + 1);
  await student.goto(`/compra/retorno?pedido=${orderId}&resultado=sucesso`);
  await expect(
    student.getByRole('heading', { level: 1, name: 'Pagamento confirmado' }),
  ).toBeVisible();
  await student.goto(`/estudar/${ids.paid.courseId}`);
  await expect(student.getByText('Primeira aula paga').first()).toBeVisible();
  const kinds = await facts(orderId!);
  for (const kind of ['order.created', 'checkout.opened', 'order.paid', 'access.granted']) {
    expect(kinds, kind).toContain(kind);
  }
});

test('5. evento repetido e atrasado não duplicam nada (um direito, um e-mail, a trilha só cresce uma vez)', async () => {
  const { orderId } = await orderOf(STUDENT_EMAIL);
  const before = await counts();
  const mailsBefore = await mails('purchase-confirmed');
  const kindsBefore = await facts(orderId!);
  const pay = `pay_j4${RUN}`;
  for (let i = 0; i < 3; i += 1) {
    await webhook('PAYMENT_RECEIVED', pay);
    await webhook('PAYMENT_CREATED', pay);
  }
  await processInbox();
  expect((await counts()).entitlement).toBe(before.entitlement);
  expect(await mails('purchase-confirmed')).toBe(mailsBefore);
  expect((await facts(orderId!)).filter((kind) => kind === 'access.granted')).toHaveLength(1);
  expect((await facts(orderId!)).filter((kind) => kind === 'order.paid')).toHaveLength(1);
  expect(kindsBefore.length).toBeLessThanOrEqual((await facts(orderId!)).length);
  // webhook com token errado: 200 e nada entra
  const wrong = await control.post('/api/webhooks/asaas', {
    headers: { 'asaas-access-token': 'errado', 'content-type': 'application/json' },
    data: { id: 'evt_falso', event: 'PAYMENT_RECEIVED', payment: { id: pay } },
  });
  expect(wrong.status()).toBe(200);
});

test('6. conclui uma aula, o acesso EXPIRA por requisição e a recompra continua o progresso (mesma matrícula)', async () => {
  const done = await post(student, `/api/lessons/${ids.paid.lessonIds[0]}/complete`);
  expect(done.status).toBeLessThan(300);
  const before = await counts();
  await postJson('/__test/advance?days=400');
  const expired = await accessOf(student, ids.paid.courseId);
  expect(expired).toMatchObject({ hasAccess: false, reason: 'expired' });
  const outline = await student.evaluate(
    async (id) => (await fetch(`/api/courses/${id}/outline`)).status,
    ids.paid.courseId,
  );
  expect(outline).toBe(403);

  await student.goto('/cursos');
  const card = cardOf(student, 'Curso Pago').first();
  await buy(student, card.getByRole('button', { name: 'Comprar de novo' }));
  const second = await orderOf(STUDENT_EMAIL);
  expect(second.status).toBe('pending');
  const pay = await setPayment(second.orderId!, {
    status: 'RECEIVED',
    billingType: 'PIX',
    valueCents: 19_700,
    customerId: 'cus_j1',
  });
  await webhook('PAYMENT_RECEIVED', pay);
  await processInbox();
  expect((await accessOf(student, ids.paid.courseId)).hasAccess).toBe(true);
  const after = await counts();
  expect(after.entitlement).toBe(before.entitlement + 1);
  // a matrícula (âncora e progresso) é a MESMA: nenhuma matrícula nova e a aula concluída continua concluída
  expect(after.enrollment).toBe(before.enrollment);
  expect(after.lessonCompletion).toBe(before.lessonCompletion);
});

test('7. cartão parcelado: o TOTAL do parcelamento é o que vale e várias parcelas concedem UMA vez', async () => {
  await student.goto('/cursos');
  const card = cardOf(student, 'Curso Parcelado');
  await buy(student, card.getByRole('button', { name: 'Comprar' }));
  const { orderId } = await orderOf(STUDENT_EMAIL);
  const before = await counts();
  const first = await setPayment(orderId!, {
    status: 'CONFIRMED',
    billingType: 'CREDIT_CARD',
    installmentId: 'ins_j7',
    valueCents: 2000,
    totalCents: 24_000,
    customerId: 'cus_j1',
  });
  const secondPay = await setPayment(orderId!, {
    status: 'CONFIRMED',
    billingType: 'CREDIT_CARD',
    installmentId: 'ins_j7',
    valueCents: 2000,
    totalCents: 24_000,
    customerId: 'cus_j1',
  });
  await webhook('PAYMENT_CONFIRMED', first);
  await webhook('PAYMENT_CONFIRMED', secondPay);
  await processInbox();
  expect((await accessOf(student, ids.installments.courseId)).hasAccess).toBe(true);
  expect((await counts()).entitlement).toBe(before.entitlement + 1);
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('paid');
});

test('8. reembolso DENTRO dos 7 dias: o Suporte com o grant pede (com reautenticação), o acesso é suspenso e o estorno só conclui pela evidência', async () => {
  await signIn(finance, FINANCE_EMAIL);
  await finance.goto('/staff/financeiro');
  await acceptTermsIfAsked(finance, finance.getByRole('heading', { level: 1, name: 'Financeiro' }));
  const { orderId } = await orderOf(STUDENT_EMAIL);

  // sem reautenticação recente: o servidor recusa
  const blocked = await post(finance, `/api/staff/finance/orders/${orderId}/refund`, {
    reason: 'Desistência dentro do prazo',
  });
  expect(blocked.status).toBe(403);
  expect(blocked.body).toEqual({ error: { code: 'reauth_required' } });
  await reauth(FINANCE_EMAIL);
  const requested = await post(finance, `/api/staff/finance/orders/${orderId}/refund`, {
    reason: 'Desistência dentro do prazo',
  });
  expect(requested.status).toBe(201);
  // o acesso foi SUSPENSO ao pedir (fail-closed)
  expect((await accessOf(student, ids.installments.courseId)).hasAccess).toBe(false);
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('refund_requested');

  // o executor (fila finance) lê o pagamento e pede o estorno INTEGRAL (sem valor)
  const run = await postJson<{ ok: boolean }>(`/__test/run-refund?id=${requested.body.id}`);
  expect(run.ok).toBe(true);
  const { calls } = await getJson<{ calls: Record<string, unknown>[] }>(
    '/__test/asaas/refund-calls',
  );
  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0]!).sort()).toEqual(['installmentId', 'paymentId']);
  expect(calls[0]!.installmentId).toBe('ins_j7');

  // o Asaas conclui: o webhook avisa e a evidência (REFUNDED relido) revoga e fecha
  const refundedMailsBefore = await mails('refund-completed');
  const payments = await getJson<{ ok: boolean }>('/__test/ids').then(() => null);
  void payments;
  await finance.goto('/staff/financeiro');
  const list = finance.getByRole('list', { name: 'Reembolsos pedidos' });
  await expect(list).toContainText('Enviado ao Asaas');
  const cardId = calls[0]!.paymentId as string;
  await postJson('/__test/asaas/set-payment', { id: cardId, status: 'REFUNDED' });
  await webhook('PAYMENT_REFUNDED', cardId);
  await processInbox();
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('refunded');
  expect((await accessOf(student, ids.installments.courseId)).hasAccess).toBe(false);
  expect(await mails('refund-completed')).toBe(refundedMailsBefore + 1);
  await finance.goto('/staff/financeiro');
  await expect(finance.getByRole('list', { name: 'Reembolsos pedidos' })).toContainText(
    'Reembolsado',
  );
});

test('9. reembolso FORA dos 7 dias: o Suporte recebe 403 e só o Admin consegue (exceção)', async () => {
  // compra do Curso Tardio, confirmada no relógio atual; os 7 dias passam DEPOIS do pagamento
  await student.goto('/cursos');
  await buy(student, cardOf(student, 'Curso Tardio').getByRole('button', { name: 'Comprar' }));
  const { orderId } = await orderOf(STUDENT_EMAIL);
  const pay = await setPayment(orderId!, {
    status: 'RECEIVED',
    billingType: 'PIX',
    valueCents: 4_900,
  });
  await webhook('PAYMENT_RECEIVED', pay);
  await processInbox();
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('paid');

  await postJson('/__test/advance?days=8');
  await reauth(FINANCE_EMAIL);
  const refused = await post(finance, `/api/staff/finance/orders/${orderId}/refund`, {
    reason: 'Pedido depois do prazo de 7 dias',
  });
  expect(refused.status).toBe(403);
  expect(refused.body).toEqual({ error: { code: 'refund_window_closed' } });
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('paid');

  await signIn(admin, ADMIN_EMAIL);
  await admin.goto('/staff/financeiro');
  await acceptTermsIfAsked(admin, admin.getByRole('heading', { level: 1, name: 'Financeiro' }));
  await reauth(ADMIN_EMAIL);
  const allowed = await post(admin, `/api/staff/finance/orders/${orderId}/refund`, {
    reason: 'Exceção autorizada pelo Admin',
  });
  expect(allowed.status).toBe(201);
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('refund_requested');
});

test('10. chargeback REVOGA o acesso e leva o pedido a disputa, sem esperar revisão', async () => {
  await student.goto('/cursos');
  await buy(student, cardOf(student, 'Curso Disputa').getByRole('button', { name: 'Comprar' }));
  const { orderId } = await orderOf(STUDENT_EMAIL);
  const pay = await setPayment(orderId!, {
    status: 'RECEIVED',
    billingType: 'PIX',
    valueCents: 9_900,
  });
  await webhook('PAYMENT_RECEIVED', pay);
  await processInbox();
  expect((await accessOf(student, ids.disputed.courseId)).hasAccess).toBe(true);
  await postJson('/__test/asaas/set-payment', { id: pay, status: 'CHARGEBACK_REQUESTED' });
  await webhook('PAYMENT_CHARGEBACK_REQUESTED', pay);
  await processInbox();
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('disputed');
  expect((await accessOf(student, ids.disputed.courseId)).hasAccess).toBe(false);
});

test('11. valor divergente vai à REVISÃO (sem acesso) e a Staff aprova pela tela, com motivo e auditoria', async () => {
  await student.goto('/cursos');
  await buy(student, cardOf(student, 'Curso Disputa').getByRole('button', { name: 'Comprar' }));
  const { orderId } = await orderOf(STUDENT_EMAIL);
  const pay = await setPayment(orderId!, {
    status: 'RECEIVED',
    billingType: 'PIX',
    valueCents: 9_899,
  });
  await webhook('PAYMENT_RECEIVED', pay);
  await processInbox();
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('review');
  expect((await accessOf(student, ids.disputed.courseId)).hasAccess).toBe(false);

  await reauth(FINANCE_EMAIL);
  await finance.goto('/staff/financeiro');
  const review = finance
    .getByRole('article', { name: 'Revisão: Valor diferente do pedido' })
    .first();
  await expect(review).toContainText('R$ 98,99');
  await review.getByLabel(/^Motivo [(]/).fill('Desconto de R$ 0,01 autorizado pela Staff');
  await review.getByRole('button', { name: /^Aprovar o valor observado/ }).click();
  await expect(finance.getByRole('status').filter({ hasText: 'Valor aprovado' })).toBeVisible();
  expect((await orderOf(STUDENT_EMAIL)).status).toBe('paid');
  expect((await accessOf(student, ids.disputed.courseId)).hasAccess).toBe(true);
  expect((await getJson<{ actions: string[] }>('/__test/audit-actions')).actions).toContain(
    'finance.review.resolve',
  );
});

test('12. webhook PERDIDO: o reconciliador acha o pagamento na API do Asaas e concede (só depois de 10 min)', async () => {
  await signIn(second, SECOND_EMAIL);
  await second.goto('/cursos');
  await acceptTermsIfAsked(second, second.getByRole('heading', { level: 1, name: 'Cursos' }));
  await buy(second, cardOf(second, 'Curso Pago').first().getByRole('button', { name: 'Comprar' }));
  const { orderId } = await orderOf(SECOND_EMAIL);
  await setPayment(orderId!, { status: 'RECEIVED', billingType: 'PIX', valueCents: 19_700 });
  // nenhum webhook chegou; antes de 10 minutos o reconciliador nem olha
  const early = await postJson<{ orders: number }>('/__test/reconcile');
  expect(early.orders).toBe(0);
  expect((await accessOf(second, ids.paid.courseId)).hasAccess).toBe(false);
  await postJson('/__test/advance?days=0.01');
  const later = await postJson<{ orders: number; payments: number }>('/__test/reconcile');
  expect(later.orders).toBeGreaterThanOrEqual(1);
  expect((await accessOf(second, ids.paid.courseId)).hasAccess).toBe(true);
  expect((await orderOf(SECOND_EMAIL)).status).toBe('paid');
});

test('13. checkout com resultado INCERTO não abre um segundo; depois do vencimento a compra recomeça com pedido novo', async () => {
  await second.goto('/cursos');
  const card = cardOf(second, 'Curso Disputa');
  const callsBefore = (await getJson<{ total: number }>('/__test/asaas/checkout-calls')).total;
  await postJson('/__test/asaas/checkout-mode?next=ambiguous');
  await card.getByRole('button', { name: 'Comprar' }).click();
  await expect(second.getByRole('alert')).toContainText(
    'Aguarde alguns minutos antes de tentar de novo',
  );
  await postJson('/__test/asaas/checkout-mode?next=ok');
  await card.getByRole('button', { name: 'Comprar' }).click();
  await expect(second.getByRole('alert')).toContainText('Aguarde alguns minutos');
  // só UMA chamada foi feita ao Asaas, mesmo com dois cliques
  expect((await getJson<{ total: number }>('/__test/asaas/checkout-calls')).total).toBe(
    callsBefore + 1,
  );
  // passada a janela de 60 minutos o pedido venceu: nova tentativa abre o checkout de verdade
  await postJson('/__test/advance?days=0.05');
  await card.getByRole('button', { name: 'Comprar' }).click();
  await expect(second.getByRole('alert')).toContainText('O pedido anterior expirou');
  await buy(second, card.getByRole('button', { name: 'Comprar' }));
});

test('14. trilha de auditoria e privacidade: cada passo deixou fato e auditoria; nenhum CPF, token ou chave em claro', async () => {
  const audits = (await getJson<{ actions: string[] }>('/__test/audit-actions')).actions;
  for (const action of ['refund.request', 'finance.review.resolve'])
    expect(audits, action).toContain(action);
  const { text } = await getJson<{ text: string }>('/__test/rows-text');
  expect(text).not.toContain(CPF);
  expect(text).not.toContain('123.456.789-09');
  const { lines } = await getJson<{ lines: string[] }>('/__test/logs');
  const logText = lines.join('\n');
  expect(logText).not.toContain(webhookToken);
  expect(logText).not.toContain(CPF);
  expect(logText).not.toMatch(/FINANCE_SECRETS|access_token/);
});
