import { expect, test, type Page } from '@playwright/test';

import {
  COURSE_ID,
  L,
  goOffline,
  mockApi,
  newBackend,
  openLesson,
  savedCount,
  storedLessons,
} from './support/offline-mock';

/**
 * Sair da conta, troca de conta e sessão encerrada (M8-05), contra o build de produção (`vite preview`) com o IndexedDB, a
 * Cache API e o armazenamento REAIS do Chromium. Cobre: sair online, sair SEM rede (purga na hora, revogação ao reconectar), aba
 * antiga depois de sair em outra, A→B, sessão expirada/revogada e o que sobra no aparelho. NÃO cobre Safari/iPhone (gate M8-04),
 * nem o `Clear-Site-Data` (a API é simulada: o cabeçalho é provado no teste do servidor) nem a outbox (M8-03).
 */

/** Tudo o que existe de armazenamento do site neste navegador: bancos, caches e chaves de storage. */
async function leftovers(page: Page) {
  return page.evaluate(async () => {
    const databases = (await indexedDB.databases()).map((info) => info.name ?? '');
    const cacheNames = await caches.keys();
    return {
      databases,
      userCaches: cacheNames.filter((name) => !name.startsWith('workbox-precache')),
      localKeys: Object.keys(localStorage).filter((key) => key !== 'hub-theme'),
      sessionKeys: Object.keys(sessionStorage),
    };
  });
}

async function seedStorage(page: Page) {
  await page.evaluate(async () => {
    const cache = await caches.open('dados-de-teste-da-pessoa');
    await cache.put('/qualquer', new Response('conteúdo da pessoa'));
    localStorage.setItem('dado-da-pessoa', 'x');
    sessionStorage.setItem('hub:tentativa-de-compra', 'y');
  });
}

async function openAccount(page: Page) {
  await page.goto('/conta');
  await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible();
}

test.describe('sair da conta', () => {
  test('online: o servidor encerra a sessão e o aparelho fica LIMPO (bancos, caches e storage)', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await seedStorage(page);
    expect((await leftovers(page)).databases.length).toBeGreaterThan(0);

    await openAccount(page);
    // Preferência de tema (interface, sem dado pessoal): NÃO é da pessoa e fica depois de sair.
    // (O perfil carregado reaplica o tema salvo; espera ele assentar antes de marcar o tema do teste.)
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.setItem('hub-theme', 'dark'));
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(backend.signOutCalls).toBe(1);

    const after = await leftovers(page);
    expect(after).toEqual({ databases: [], userCaches: [], localKeys: [], sessionKeys: [] });
    expect(await page.evaluate(() => localStorage.getItem('hub-theme'))).toBe('dark');
    // Sem rede, nada da pessoa abre.
    goOffline(backend);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/Entre online ao menos uma vez neste aparelho/)).toBeVisible();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toHaveCount(0);
  });

  test('o servidor falha online: NADA é apagado, a pessoa vê o erro e continua logada', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ signOutStatus: 500 });
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await openAccount(page);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível sair agora');
    expect(await savedCount(page)).toBe(1);
    expect((await leftovers(page)).databases.length).toBeGreaterThan(0);
  });

  test('SEM rede: o aparelho é limpo na hora; a sessão no servidor só é revogada quando a rede volta', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await seedStorage(page);
    await openAccount(page);

    goOffline(backend);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page.getByText(/Você saiu da conta neste aparelho/)).toBeVisible();
    expect(backend.signOutCalls).toBe(0); // a rede está fora: o servidor ainda não soube
    expect(backend.session).toBe(true);

    // O aparelho já está limpo; só o marcador "sair pendente" (sem dado da pessoa) existe.
    const offlineState = await leftovers(page);
    expect(offlineState.databases).toEqual(['hub-pending-signout']);
    expect(offlineState.userCaches).toEqual([]);
    expect(offlineState.localKeys).toEqual([]);
    expect(await savedCount(page)).toBe(0);

    // Reabrir a aula SEM rede não mostra nada da pessoa.
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/Entre online ao menos uma vez neste aparelho/)).toBeVisible();

    // A rede volta: a revogação acontece sozinha e o marcador some.
    backend.online = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => backend.signOutCalls).toBe(1);
    expect(backend.session).toBe(false);
    await expect.poll(async () => (await leftovers(page)).databases).toEqual([]);
  });

  test('sair pendente: enquanto a revogação não acontece, NADA novo é guardado (nem com o app aberto online)', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ signOutStatus: 503 }); // o servidor ainda não consegue revogar
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await openAccount(page);
    goOffline(backend);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page.getByText(/Você saiu da conta neste aparelho/)).toBeVisible();

    backend.online = true; // volta a rede, mas o sign-out ainda falha (503)
    await openLesson(page, 2);
    await page.waitForTimeout(500);
    expect(await savedCount(page)).toBe(0);
    expect(backend.session).toBe(true);
  });
});

test.describe('várias abas', () => {
  test('aba antiga de A aberta depois de sair em outra: volta para a página inicial e não mostra mais nada de A', async ({
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    const old = await context.newPage();
    await openLesson(old, 1);
    await expect.poll(() => savedCount(old)).toBe(1);
    const current = await context.newPage();
    await openAccount(current);

    await current.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(current).toHaveURL(/\/$/);
    await expect(old).toHaveURL(/\/$/);
    await expect(old.getByText('Conteúdo secreto da aula 1.')).toHaveCount(0);
    expect(await leftovers(old)).toEqual({
      databases: [],
      userCaches: [],
      localKeys: [],
      sessionKeys: [],
    });
  });
});

test.describe('troca de conta e sessão encerrada', () => {
  test('A estuda; B entra (online): o que era de A é apagado antes de B ver qualquer dado local', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ userId: 'aluna-a' });
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await seedStorage(page);

    // B entra neste navegador: a página abre já com a sessão de B.
    backend.userId = 'aluno-b';
    await page.goto('/');
    await expect
      .poll(async () => (await leftovers(page)).localKeys, { message: 'dado de A no storage' })
      .toEqual([]);
    expect(await savedCount(page)).toBe(0);
    expect((await leftovers(page)).userCaches).toEqual([]);

    goOffline(backend);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/Entre online ao menos uma vez|não foi guardada/)).toBeVisible();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toHaveCount(0);
  });

  test('sessão expirada ou revogada (conta suspensa): no próximo contato online o aparelho é limpo', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await seedStorage(page);

    backend.session = false; // o servidor derrubou a sessão
    await page.goto('/');
    await expect.poll(async () => (await leftovers(page)).databases).toEqual([]);
    expect((await leftovers(page)).userCaches).toEqual([]);
    expect((await leftovers(page)).localKeys).toEqual([]);

    goOffline(backend);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/Entre online ao menos uma vez neste aparelho/)).toBeVisible();
  });

  test('sem sessão e sem ninguém conhecido neste aparelho: visitar não cria nada nem chama o servidor', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ session: false });
    await mockApi(context, backend);
    await page.goto('/');
    await page.waitForTimeout(400);
    expect(backend.leaseCalls).toBe(0);
    expect((await leftovers(page)).databases).toEqual([]);
    expect(Object.keys(await storedLessons(page))).toEqual([]);
  });
});
