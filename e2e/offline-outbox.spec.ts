import { expect, test, type Page } from '@playwright/test';

import {
  COURSE_ID,
  L,
  goOffline,
  mockApi,
  newBackend,
  openLesson,
  outboxItems,
  savedCount,
  type Backend,
} from './support/offline-mock';

/**
 * Outbox offline (M8-03) e a confirmação ao sair (M8-05, passo 1), contra o build de produção (`vite preview`) com o IndexedDB REAL
 * do Chromium. Só "concluir aula de texto" entra na allowlist. Cobre: concluir sem rede, pendências à vista, envio ao reconectar,
 * recusa visível, reconexão intermitente (resposta perdida), sessão expirada, outra conta e sair com pendência. NÃO cobre
 * Safari/iPhone (gate M8-04).
 */

/** Estuda a aula, vai a offline e conclui a aula guardada. */
async function completeOffline(page: Page, backend: Backend, n = 1) {
  await openLesson(page, n);
  await expect.poll(() => savedCount(page)).toBeGreaterThan(0);
  goOffline(backend);
  await page.reload();
  await expect(page.getByText(/Você está sem conexão/)).toBeVisible();
  await page.getByRole('button', { name: 'Concluir aula' }).click();
  await expect(page.getByText(/Conclusão guardada neste aparelho/)).toBeVisible();
}

/** A rede volta e o app é avisado (como o navegador faz). */
async function reconnect(page: Page, backend: Backend) {
  backend.online = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test.describe('concluir aula sem rede', () => {
  test('guarda a conclusão, mostra a pendência em qualquer tela e envia ao reconectar (uma conclusão no servidor)', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await page.goto(`/estudar/${COURSE_ID}`); // o mapa também fica guardado para abrir sem rede
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    await completeOffline(page, backend, 1);
    expect(await outboxItems(page)).toMatchObject([{ lessonId: L(1), state: 'pending' }]);
    // A pendência fica à vista também fora da aula, e o botão não se repete.
    await expect(page.getByText('1 conclusão de aula aguardando envio.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Concluir aula' })).toHaveCount(0);

    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(page.getByText('conclusão aguardando envio')).toBeVisible();
    expect(backend.completedLessons).toEqual([]); // nada chegou ao servidor ainda

    await reconnect(page, backend);
    await expect.poll(() => backend.completedLessons).toEqual([L(1)]);
    await expect.poll(() => outboxItems(page)).toEqual([]);
    await expect(page.getByText(/aguardando envio/)).toHaveCount(0);
    expect(backend.syncCalls).toHaveLength(1);
    expect(backend.syncCalls[0]!.expectedUserId).toBe('aluna-a');
  });

  test('só aula de texto GUARDADA pode ser concluída offline: aula não guardada e quiz não oferecem nada', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    goOffline(backend);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await expect(page.getByText(/Esta aula não foi guardada para estudo offline/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Concluir aula' })).toHaveCount(0);
    expect(await outboxItems(page)).toEqual([]);
  });

  test('clicar duas vezes não duplica: um comando por aula', async ({ page, context }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    await page.reload();
    await expect(page.getByText(/Conclusão guardada neste aparelho/)).toBeVisible();
    expect(await outboxItems(page)).toHaveLength(1);
  });

  test('o servidor RECUSA (ex.: aula removida): o aviso fica visível com o motivo até a pessoa dispensar', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ syncMode: 'reject', syncReason: 'lesson_not_found' });
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    await reconnect(page, backend);
    const alert = page.getByRole('alert').filter({ hasText: 'não foi aceita' });
    await expect(alert).toContainText('“Aula 1”');
    await expect(alert).toContainText('A aula não existe mais');
    expect(backend.completedLessons).toEqual([]);
    expect(await outboxItems(page)).toMatchObject([
      { state: 'rejected', reason: 'lesson_not_found' },
    ]);
    // Sobrevive a recarregar; só some quando a pessoa dispensa.
    await page.reload();
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Entendi' }).click();
    await expect(alert).toHaveCount(0);
    await expect.poll(() => outboxItems(page)).toEqual([]);
  });
});

test.describe('reconexão e sessão', () => {
  test('reconexão intermitente: o servidor aplicou mas a resposta se perdeu; o reenvio volta como duplicate e a conclusão existe UMA vez', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ syncMode: 'lose_response' });
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    await reconnect(page, backend);
    await expect.poll(() => backend.syncCalls.length).toBe(1);
    expect(backend.completedLessons).toEqual([L(1)]);
    // O cliente não viu a resposta: continua pendente (com a tentativa contada).
    await expect.poll(async () => (await outboxItems(page))[0]?.attempts).toBe(1);
    await expect(page.getByText('1 conclusão de aula aguardando envio.')).toBeVisible();

    backend.syncMode = 'ok';
    await page.getByRole('button', { name: 'Enviar agora' }).click();
    await expect.poll(() => outboxItems(page)).toEqual([]);
    expect(backend.syncCalls).toHaveLength(2);
    expect(backend.syncCalls[1]!.ids).toEqual(backend.syncCalls[0]!.ids); // o MESMO id
    expect(backend.completedLessons).toEqual([L(1)]);
    expect(backend.processed.size).toBe(1);
  });

  test('erro 5xx do servidor: o outbox é mantido e o envio recomeça na próxima tentativa', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ syncMode: 'error' });
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    await reconnect(page, backend);
    await expect.poll(() => backend.syncCalls.length).toBe(1);
    await expect(page.getByText('1 conclusão de aula aguardando envio.')).toBeVisible();
    backend.syncMode = 'ok';
    await page.getByRole('button', { name: 'Enviar agora' }).click();
    await expect.poll(() => backend.completedLessons).toEqual([L(1)]);
  });

  test('sessão expirada (401): o outbox fica e NADA do estudo; ao entrar de novo como a MESMA pessoa, é enviado', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    backend.session = false; // a sessão acabou enquanto estava offline
    backend.online = true;
    await page.goto('/');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    // O estudo guardado foi apagado (sessão encerrada), mas a conclusão ainda não enviada NÃO.
    await expect.poll(() => savedCount(page)).toBe(0);
    expect(await outboxItems(page)).toMatchObject([{ lessonId: L(1), state: 'pending' }]);
    expect(backend.completedLessons).toEqual([]);

    backend.session = true; // a pessoa entrou de novo (mesma conta)
    await page.goto('/');
    await expect.poll(() => backend.completedLessons).toEqual([L(1)]);
    await expect.poll(() => outboxItems(page)).toEqual([]);
  });

  test('outra conta no mesmo aparelho: o outbox de A NUNCA é enviado na sessão de B; ao A voltar, é enviado', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ userId: 'aluna-a' });
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    backend.userId = 'aluno-b';
    backend.online = true;
    await page.goto('/');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(600);
    expect(backend.syncCalls).toEqual([]); // B não envia nada de A
    expect(backend.completedLessons).toEqual([]);
    expect(await outboxItems(page)).toMatchObject([{ lessonId: L(1), state: 'pending' }]);

    backend.userId = 'aluna-a';
    await page.goto('/');
    await expect.poll(() => backend.completedLessons).toEqual([L(1)]);
    expect(backend.syncCalls.every((call) => call.expectedUserId === 'aluna-a')).toBe(true);
  });
});

test.describe('sair com conclusão ainda não enviada (M8-05, passo 1)', () => {
  async function openAccount(page: Page) {
    await page.goto('/conta');
    await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible();
  }

  test('com a rede, o app tenta ENVIAR antes de sair: enviou tudo, sai sem perguntar', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    backend.online = true;
    await openAccount(page);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(backend.completedLessons).toEqual([L(1)]);
    expect(backend.signOutCalls).toBe(1);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  });

  test('não conseguiu enviar: PEDE confirmação; cancelar mantém tudo; "sair e descartar" apaga o outbox', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ syncMode: 'error' });
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    backend.online = true;
    await openAccount(page);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    const confirm = page.getByRole('alert').filter({ hasText: 'ainda não foi enviada' });
    await expect(confirm).toContainText('Se você sair agora, ela será perdida');
    expect(backend.signOutCalls).toBe(0);

    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible();
    expect(await outboxItems(page)).toHaveLength(1);

    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await page.getByRole('button', { name: 'Sair e descartar' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(backend.signOutCalls).toBe(1);
    expect(backend.completedLessons).toEqual([]);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  });

  test('SEM rede e com conclusão pendente: também pede confirmação; ao confirmar, limpa na hora e deixa só o marcador do "sair"', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await completeOffline(page, backend, 1);
    await openAccount(page);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page.getByRole('button', { name: 'Sair e descartar' })).toBeVisible();
    await page.getByRole('button', { name: 'Sair e descartar' }).click();
    await expect(page.getByText(/Você saiu da conta neste aparelho/)).toBeVisible();
    const names = await page.evaluate(async () =>
      (await indexedDB.databases()).map((info) => info.name),
    );
    expect(names).toEqual(['hub-pending-signout']);
  });
});
