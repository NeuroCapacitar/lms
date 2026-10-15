import { createHash } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { goOffline, mockApi, newBackend, type Backend } from './support/offline-mock';

/**
 * Certificados offline (M8-06), contra o build de produção (`vite preview`) com IndexedDB real e a API simulada. Cobre: lista
 * guardada com "verificado em" (nunca "válido" sem a data), PDF guardado SÓ quando a pessoa pede, conferência do SHA-256,
 * cache adulterado, revogado depois do download, A→B, sair e o que a UI avisa. NÃO cobre Safari/iPhone (gate M8-04).
 */
const CERT = {
  id: '5eaf0000-0000-4000-8000-000000000001',
  courseTitle: 'Curso Demonstrativo',
  status: 'ready',
  code: 'ABCDEFGHJKMNPQRSTUVWXY',
  readyAt: '2026-10-10T12:00:00.000Z',
  canDownload: true,
};

function withCertificate(overrides: Partial<Backend> = {}) {
  return newBackend({ certificates: [CERT], ...overrides });
}

async function openAccount(page: Page) {
  await page.goto('/conta');
  await expect(page.getByRole('heading', { name: 'Meus certificados' })).toBeVisible();
}

/** O PDF guardado no aparelho (todas as contas): id, hash e bytes. */
async function storedPdfs(page: Page) {
  return page.evaluate(async () => {
    const out: { id: string; sha256: string; length: number }[] = [];
    for (const info of await indexedDB.databases()) {
      const name = info.name ?? '';
      if (!name.startsWith('hub-offline-') || name === 'hub-offline-index') continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(name);
        // Se o banco sumiu entre a listagem e a abertura, NÃO deixa o teste criar um banco vazio no lugar.
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      const rows = await new Promise<any[]>((resolve) => {
        const request = db.transaction('certificatePdfs').objectStore('certificatePdfs').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      for (const row of rows) {
        out.push({ id: row.id, sha256: row.sha256, length: (row.bytes as ArrayBuffer).byteLength });
      }
    }
    return out;
  });
}

async function listSaved(page: Page) {
  return page.evaluate(async () => {
    let total = 0;
    for (const info of await indexedDB.databases()) {
      const name = info.name ?? '';
      if (!name.startsWith('hub-offline-') || name === 'hub-offline-index') continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(name);
        // Se o banco sumiu entre a listagem e a abertura, NÃO deixa o teste criar um banco vazio no lugar.
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      total += await new Promise<number>((resolve) => {
        const request = db.transaction('certificates').objectStore('certificates').count();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
    }
    return total;
  });
}

test.describe('a lista de certificados sem rede', () => {
  test('guardada online, abre sem rede com "verificado em" e SEM dizer "válido" ou "Pronto"', async ({
    page,
    context,
  }) => {
    const backend = withCertificate();
    await mockApi(context, backend);
    await openAccount(page);
    await expect(page.getByText('Pronto')).toBeVisible(); // online o servidor confirma
    await expect.poll(() => listSaved(page)).toBe(1);

    goOffline(backend);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Meus certificados' })).toBeVisible();
    await expect(page.getByText('Curso Demonstrativo')).toBeVisible();
    await expect(
      page.getByText(/Sem conexão\. Esta lista foi guardada neste aparelho e verificada em/),
    ).toBeVisible();
    await expect(
      page.getByText(/Sem internet não é possível confirmar que um certificado continua válido/),
    ).toBeVisible();
    await expect(page.getByText(/Emitido · verificado em/)).toBeVisible();
    await expect(page.getByText('Pronto')).toHaveCount(0);
    await expect(
      page.getByText('PDF não guardado neste aparelho: precisa de internet.'),
    ).toBeVisible();
    // Sem rede não há link de download do servidor.
    await expect(page.getByRole('link', { name: /Baixar o PDF/ })).toHaveCount(0);
  });

  test('revogado aparece como revogado na cópia guardada, sem botão de PDF', async ({
    page,
    context,
  }) => {
    const backend = withCertificate({
      certificates: [{ ...CERT, status: 'revoked', canDownload: false }],
    });
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    goOffline(backend);
    await page.reload();
    await expect(page.getByText(/Revogado · verificado em/)).toBeVisible();
    await expect(page.getByRole('button', { name: /PDF|cópia/ })).toHaveCount(0);
  });
});

test.describe('o PDF guardado de propósito', () => {
  test('nada é guardado sozinho: só depois de "Guardar para ler offline"; depois abre sem rede e o arquivo confere', async ({
    page,
    context,
  }) => {
    const backend = withCertificate();
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    expect(await storedPdfs(page)).toEqual([]);
    expect(backend.pdfDownloads).toBe(0);

    await page.getByRole('button', { name: /Guardar para ler offline/ }).click();
    await expect(page.getByRole('button', { name: /Baixar a cópia guardada/ })).toBeVisible();
    const [pdf] = await storedPdfs(page);
    expect(pdf).toMatchObject({
      id: CERT.id,
      sha256: createHash('sha256').update(backend.pdf).digest('hex'),
      length: backend.pdf.length,
    });
    // Aviso do limite da cópia.
    await expect(page.getByText(/A cópia guardada não se atualiza sem internet/)).toBeVisible();

    goOffline(backend);
    await page.reload();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Baixar a cópia guardada/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('certificado-ABCDEFGHJKMNPQRSTUVWXY.pdf');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(backend.pdf)).toBe(true);
  });

  test('o hash recebido não bate com o do servidor: NADA é guardado e a pessoa é avisada', async ({
    page,
    context,
  }) => {
    const backend = withCertificate({ pdfHashHeader: 'b'.repeat(64) });
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    await page.getByRole('button', { name: /Guardar para ler offline/ }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'não passou na conferência de integridade' }),
    ).toBeVisible();
    expect(await storedPdfs(page)).toEqual([]);
  });

  test('CACHE ADULTERADO: o hash diverge, a cópia é descartada e a mensagem diz o que fazer', async ({
    page,
    context,
  }) => {
    const backend = withCertificate();
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    await page.getByRole('button', { name: /Guardar para ler offline/ }).click();
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(1);

    // Alguém troca os bytes guardados (o hash guardado continua o antigo).
    await page.evaluate(async () => {
      for (const info of await indexedDB.databases()) {
        const name = info.name ?? '';
        if (!name.startsWith('hub-offline-') || name === 'hub-offline-index') continue;
        const db = await new Promise<IDBDatabase | null>((resolve) => {
          const request = indexedDB.open(name);
          // Se o banco sumiu entre a listagem e a abertura, NÃO deixa o teste criar um banco vazio no lugar.
          request.onupgradeneeded = () => request.transaction?.abort();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        if (!db) continue;
        const store = db.transaction('certificatePdfs', 'readwrite').objectStore('certificatePdfs');
        const row = await new Promise<any>((resolve) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result[0]);
        });
        if (row) {
          row.bytes = new TextEncoder().encode('%PDF-1.7 ADULTERADO').buffer;
          await new Promise<void>((resolve) => {
            const request = store.put(row);
            request.onsuccess = () => resolve();
          });
        }
        db.close();
      }
    });

    goOffline(backend);
    await page.reload();
    await page.getByRole('button', { name: /Baixar a cópia guardada/ }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'foi alterado e foi descartado' }),
    ).toBeVisible();
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(0);
    await expect(
      page.getByText('PDF não guardado neste aparelho: precisa de internet.'),
    ).toBeVisible();
  });

  test('REVOGADO depois do download offline: ao reconectar a lista é renovada e a cópia do PDF SAI', async ({
    page,
    context,
  }) => {
    const backend = withCertificate();
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    await page.getByRole('button', { name: /Guardar para ler offline/ }).click();
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(1);

    // O Admin revoga enquanto a pessoa está offline: a cópia ainda existe (limite dito na tela)...
    backend.certificates = [{ ...CERT, status: 'revoked', canDownload: false }];
    goOffline(backend);
    await page.reload();
    await expect(page.getByRole('button', { name: /Baixar a cópia guardada/ })).toBeVisible();
    await expect(page.getByText(/continua neste aparelho até a próxima conexão/)).toBeVisible();

    // ...e some assim que a rede volta e o app renova a lista.
    backend.online = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(0);
    await page.reload();
    await expect(page.getByText('Revogado')).toBeVisible();
    await expect(page.getByRole('button', { name: /cópia guardada/ })).toHaveCount(0);
  });

  test('"Remover a cópia guardada" apaga o PDF deste aparelho', async ({ page, context }) => {
    const backend = withCertificate();
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    await page.getByRole('button', { name: /Guardar para ler offline/ }).click();
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(1);
    await page.getByRole('button', { name: /Remover a cópia guardada/ }).click();
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(0);
    await expect(page.getByRole('button', { name: /Guardar para ler offline/ })).toBeVisible();
  });
});

test.describe('outra conta e sair', () => {
  test('A guarda; B entra no mesmo aparelho: a lista e o PDF de A são APAGADOS e B não vê nada', async ({
    page,
    context,
  }) => {
    const backend = withCertificate();
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    await page.getByRole('button', { name: /Guardar para ler offline/ }).click();
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(1);

    backend.userId = 'aluno-b';
    backend.certificates = [];
    await page.goto('/');
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(0);
    expect(await listSaved(page)).toBe(0);
    goOffline(backend);
    await page.goto('/conta');
    await expect(page.getByRole('heading', { name: 'Meus certificados' })).toHaveCount(0);
  });

  test('sair da conta apaga a lista e o PDF guardados', async ({ page, context }) => {
    const backend = withCertificate();
    await mockApi(context, backend);
    await openAccount(page);
    await expect.poll(() => listSaved(page)).toBe(1);
    await page.getByRole('button', { name: /Guardar para ler offline/ }).click();
    await expect.poll(async () => (await storedPdfs(page)).length).toBe(1);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).map((info) => info.name)),
    ).toEqual([]);
  });
});
