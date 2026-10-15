import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  COURSE_ID,
  HOUR,
  L,
  T0,
  goOffline,
  mockApi,
  newBackend,
  openLesson,
  savedCount,
  storedLessons,
  type Backend,
} from './support/offline-mock';

/**
 * Offline do aluno (M8-02) contra o build de produção (`vite preview`), com o IndexedDB REAL do Chromium e a API simulada.
 * "Sem rede" aqui é a API abortando com `internetdisconnected` (o app vê um `TypeError` do `fetch`, como na vida real).
 * Cobre: usuário A→B, relógio adiantado e atrasado, lease vencido, acesso revogado entre verificações, cache apagado,
 * duas abas, armazenamento cheio, Staff, aula que não é de texto e o conteúdo gravado. NÃO cobre Safari/iPhone (gate M8-04).
 */

test.describe('guardar e ler sem rede', () => {
  test('a aula de texto visitada abre sem rede, com a faixa "sem conexão" e conclusão guardada para enviar depois', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect(page.getByText('Você está sem conexão')).toHaveCount(0);
    await expect.poll(() => savedCount(page)).toBe(1);

    goOffline(backend);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Aula 1' })).toBeVisible();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible();
    await expect(
      page.getByText(/Você está sem conexão\. Esta é a cópia guardada em/),
    ).toBeVisible();
    // M8-03: sem rede dá para concluir (fica guardado no aparelho e é enviado depois); a leitura segue sem escrita no servidor.
    await expect(page.getByRole('button', { name: 'Concluir aula' })).toBeEnabled();
    await expect(page.getByText(/a conclusão fica guardada neste aparelho/)).toBeVisible();
    // Sem rede não há discussão (ela é online).
    await expect(page.getByRole('heading', { name: /Discussão/i })).toHaveCount(0);
  });

  test('o mapa do curso guardado mostra o que abre sem rede e o que precisa de internet', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Curso Demonstrativo' }),
    ).toBeVisible();
    await openLesson(page, 2);
    await expect.poll(() => savedCount(page)).toBe(1);

    goOffline(backend);
    await page.goto(`/estudar/${COURSE_ID}`);
    await expect(page.getByText(/Você está sem conexão/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Aula 2/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Aula 1/ })).toHaveCount(0);
    await expect(page.getByText('— precisa de internet')).toHaveCount(2);
  });

  test('aula que nunca foi guardada: mensagem clara, sem tela quebrada', async ({
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
    await expect(page.getByText('Conteúdo secreto da aula 2.')).toHaveCount(0);
  });

  test('quiz nunca é guardado (só online)', async ({ page, context }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(5)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Aula 5' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await savedCount(page)).toBe(0);
  });

  test('voltando a rede, a tela volta a mostrar a resposta do servidor (sem a faixa)', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    goOffline(backend);
    await page.reload();
    await expect(page.getByText(/Você está sem conexão/)).toBeVisible();
    backend.online = true;
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Aula 1' })).toBeVisible();
    await expect(page.getByText(/Você está sem conexão/)).toHaveCount(0);
  });
});

test.describe('isolamento entre contas', () => {
  test('A estuda; B entra no mesmo navegador: o que era de A é APAGADO e B não vê nada dele (nem sem rede)', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ userId: 'aluna-a' });
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);

    // B entra (online) e estuda outra aula.
    backend.userId = 'aluno-b';
    await openLesson(page, 2);
    // O que era de A saiu do aparelho; só a aula de B está guardada.
    await expect.poll(async () => Object.values(await storedLessons(page)).flat()).toEqual([L(2)]);

    goOffline(backend);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/Esta aula não foi guardada para estudo offline/)).toBeVisible();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toHaveCount(0);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await expect(page.getByText('Conteúdo secreto da aula 2.')).toBeVisible();

    // Os nomes dos bancos não carregam o identificador da pessoa.
    const names = Object.keys(await storedLessons(page));
    expect(names).toHaveLength(1);
    for (const name of names) expect(name).not.toMatch(/aluna|aluno/);
  });

  test('conta com papel de Staff: o servidor recusa o lease e nada é guardado', async ({
    page,
    context,
  }) => {
    const backend = newBackend({ staff: true });
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => backend.leaseCalls).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect(await savedCount(page)).toBe(0);
    goOffline(backend);
    await page.reload();
    await expect(page.getByText(/Entre online ao menos uma vez neste aparelho/)).toBeVisible();
  });

  test('só o necessário é gravado: nenhum token, cookie nem dado da Staff; nada de /api no Cache Storage', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    const dump = await page.evaluate(async () => {
      const text: string[] = [];
      for (const info of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open(info.name!);
          request.onsuccess = () => resolve(request.result);
        });
        for (const store of Array.from(db.objectStoreNames)) {
          const all = await new Promise<unknown[]>((resolve) => {
            const request = db.transaction(store).objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result);
          });
          text.push(JSON.stringify(all));
        }
        db.close();
      }
      const cached: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) cached.push(request.url);
      }
      return { text: text.join('\n'), cached };
    });
    expect(dump.text).not.toMatch(/token|cookie|set-cookie|session|authorization|staff/i);
    expect(dump.cached.filter((url) => url.includes('/api/'))).toEqual([]);
  });
});

test.describe('lease e relógio', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: T0 });
  });

  async function studied(page: Page, context: BrowserContext, overrides: Partial<Backend> = {}) {
    const backend = newBackend({ serverNow: () => new Date(T0), ...overrides });
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    goOffline(backend);
    return backend;
  }

  test('dentro do lease (72 h) abre; passado o fim, não abre mais', async ({ page, context }) => {
    await studied(page, context);
    await page.clock.setSystemTime(new Date(T0.getTime() + 71 * HOUR));
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible();
    await page.clock.setSystemTime(new Date(T0.getTime() + 73 * HOUR));
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/o prazo do estudo offline deste curso terminou/)).toBeVisible();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toHaveCount(0);
  });

  test('relógio adiantado só antecipa o fim do lease', async ({ page, context }) => {
    await studied(page, context);
    await page.clock.setSystemTime(new Date(T0.getTime() + 200 * HOUR));
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/o prazo do estudo offline deste curso terminou/)).toBeVisible();
  });

  test('relógio atrasado depois de já ter visto uma hora mais nova bloqueia até verificar online', async ({
    page,
    context,
  }) => {
    const backend = await studied(page, context);
    await page.clock.setSystemTime(new Date(T0.getTime() + 20 * HOUR));
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible();

    await page.clock.setSystemTime(new Date(T0.getTime() + 2 * HOUR)); // alguém voltou o relógio
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/O relógio deste aparelho está atrás/)).toBeVisible();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toHaveCount(0);

    // Verificou online: o relógio é aceito de novo.
    backend.online = true;
    backend.serverNow = () => new Date(T0.getTime() + 2 * HOUR);
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Aula 1' })).toBeVisible();
    await expect.poll(() => backend.leaseCalls).toBeGreaterThan(1);
    backend.online = false;
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible();
  });

  test('acesso revogado entre verificações: vale até o fim do lease; ao reverificar online, o curso sai do aparelho', async ({
    page,
    context,
  }) => {
    const backend = await studied(page, context);
    await page.clock.setSystemTime(new Date(T0.getTime() + 10 * HOUR));
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible(); // limite documentado

    // O servidor passa a não dar lease (acesso revogado) e a pessoa verifica online (volta a abrir o app).
    backend.leaseCourses = [];
    backend.online = true;
    backend.serverNow = () => new Date(T0.getTime() + 10 * HOUR);
    const calls = backend.leaseCalls;
    await page.goto('/');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => backend.leaseCalls).toBeGreaterThan(calls);
    await expect.poll(() => savedCount(page)).toBe(0);
    backend.online = false;
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByText(/ainda não foi liberado para estudo offline/)).toBeVisible();
  });
});

test.describe('cache apagado, abas e armazenamento cheio', () => {
  test('o navegador apagou os dados: mensagem clara e o app segue funcionando online', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await page.evaluate(async () => {
      for (const info of await indexedDB.databases()) {
        await new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(info.name!);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        });
      }
    });
    goOffline(backend);
    await page.reload();
    await expect(page.getByText(/Entre online ao menos uma vez neste aparelho/)).toBeVisible();
    backend.online = true;
    await page.reload();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible();
    await expect.poll(() => savedCount(page)).toBe(1); // guardou de novo
  });

  test('duas abas: o que uma guarda a outra lê sem rede; verificações simultâneas não se atropelam', async ({
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([openLesson(first, 1), openLesson(second, 2)]);
    await expect.poll(() => savedCount(first)).toBe(2);

    goOffline(backend);
    await second.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`); // guardada pela OUTRA aba
    await expect(second.getByText('Conteúdo secreto da aula 1.')).toBeVisible();
    await first.goto(`/estudar/${COURSE_ID}/aulas/${L(2)}`);
    await expect(first.getByText('Conteúdo secreto da aula 2.')).toBeVisible();
  });

  test('armazenamento cheio: a aula continua abrindo online, sem erro na tela; sem rede, mensagem clara', async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      IDBObjectStore.prototype.put = function put() {
        throw new DOMException('cheio', 'QuotaExceededError');
      };
    });
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    goOffline(backend);
    await page.reload();
    await expect(page.getByText(/Entre online ao menos uma vez neste aparelho/)).toBeVisible();
  });
});

test.describe('recarregar sem rede com o Service Worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('depois de instalado, o app inteiro abre sem rede e mostra a aula guardada', async ({
    page,
    context,
  }) => {
    const backend = newBackend();
    await mockApi(context, backend);
    await openLesson(page, 1);
    await expect.poll(() => savedCount(page)).toBe(1);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    goOffline(backend);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Aula 1' })).toBeVisible();
    await expect(page.getByText('Conteúdo secreto da aula 1.')).toBeVisible();
    await expect(page.getByText(/Você está sem conexão/)).toBeVisible();
    await context.setOffline(false);
  });
});
