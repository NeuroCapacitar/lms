import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const L = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const ASSET_ID = '22222222-2222-4222-8222-222222222222';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const videoLesson = (
  overrides: {
    provider?: string;
    maxPosition?: number;
    completed?: boolean;
    durationSeconds?: number | null;
    preview?: boolean;
  } = {},
) => ({
  ...(overrides.preview ? { preview: true } : {}),
  course: { id: COURSE_ID, title: 'Curso Demonstrativo' },
  lesson: {
    id: L(1),
    title: 'Aula em vídeo',
    isOptional: false,
    body: doc('Texto de apoio da aula em vídeo.'),
    kind: 'video',
    video: {
      assetId: ASSET_ID,
      provider: overrides.provider ?? 'fake',
      externalId: 'demo',
      durationSeconds: overrides.durationSeconds === undefined ? 600 : overrides.durationSeconds,
      capabilities: { reportsTime: true, reportsEnded: true, resume: true },
      maxPosition: overrides.maxPosition ?? 0,
      completionPercent: 90,
    },
  },
  completed: overrides.completed ?? false,
  previous: null,
  next: { id: L(2), title: 'Próxima aula de texto' },
});

const nextLesson = {
  course: { id: COURSE_ID, title: 'Curso Demonstrativo' },
  lesson: {
    id: L(2),
    title: 'Próxima aula de texto',
    isOptional: false,
    body: doc('Texto seguinte.'),
  },
  completed: false,
  previous: { id: L(1), title: 'Aula em vídeo' },
  next: null,
};

interface Call {
  body: Record<string, any>;
  headers: Record<string, string>;
}

async function stub(
  page: Page,
  options: {
    lesson?: unknown;
    autoAdvance?: boolean;
    /** Resposta do servidor ao progresso. */
    progress?: (body: Record<string, any>) => { status: number; json: unknown };
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
        autoAdvance: options.autoAdvance ?? false,
      },
    }),
  );
  await page.route('**/api/lessons/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ json: id === L(2) ? nextLesson : (options.lesson ?? videoLesson()) });
  });
  const calls: Call[] = [];
  await page.route('**/api/lessons/*/video-progress', (route) => {
    const request: Request = route.request();
    const body = request.postDataJSON() as Record<string, any>;
    calls.push({ body, headers: request.headers() });
    const answer = options.progress
      ? options.progress(body)
      : {
          status: 200,
          json: {
            status: 'updated',
            maxPosition: body.position,
            durationSeconds: 600,
            completed: body.position >= 540,
            ...(body.position >= 540
              ? { completion: { status: 'completed', courseJustCompleted: false } }
              : {}),
          },
        };
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return calls;
}

const player = (page: Page) => page.frameLocator('iframe[title="Vídeo da aula"]');
const open = async (page: Page) => {
  await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Aula em vídeo' })).toBeVisible();
  await expect(player(page).locator('#total')).toHaveText('600');
};

test.describe('aula de vídeo (adapter falso)', () => {
  test('mostra o player e o texto de apoio, SEM botão de concluir; retoma de onde parou', async ({
    page,
  }) => {
    await stub(page, { lesson: videoLesson({ maxPosition: 321 }) });
    await open(page);
    await expect(page.getByText('Texto de apoio da aula em vídeo.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Concluir aula' })).toHaveCount(0);
    const iframe = page.locator('iframe[title="Vídeo da aula"]');
    await expect(iframe).toHaveAttribute('src', /^\/fake-video\?.*start=321/);
    await expect(player(page).locator('#time')).toHaveText('321');
  });

  test('89% não conclui; 90% conclui e a tela avisa; depois disso para de enviar', async ({
    page,
  }) => {
    const calls = await stub(page);
    await open(page);
    await player(page).getByRole('button', { name: 'Ir a 89%' }).click();
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.at(-1)!.body.position).toBe(534);
    await expect(page.getByText('Aula concluída.')).toHaveCount(0);

    await player(page).getByRole('button', { name: 'Ir a 90%' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Aula concluída.' }).first(),
    ).toBeVisible();
    const before = calls.length;
    await player(page).getByRole('button', { name: 'Início' }).click();
    await page.waitForTimeout(300);
    expect(calls.length).toBe(before); // concluída: o reporter parou
  });

  test('cada envio leva o vídeo, a sessão, seq crescente e posição; JSON com credenciais da mesma origem', async ({
    page,
  }) => {
    const calls = await stub(page);
    await open(page);
    await player(page).getByRole('button', { name: 'Tocar' }).click();
    await player(page).getByRole('button', { name: 'Ir a 89%' }).click();
    await player(page).getByRole('button', { name: 'Pausar' }).click();
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
    const seqs = calls.map((call) => call.body.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(new Set(calls.map((call) => call.body.playbackSessionId)).size).toBe(1);
    expect(calls[0]!.body).toMatchObject({ videoAssetId: ASSET_ID });
    expect(calls[0]!.headers['content-type']).toContain('application/json');
    expect(calls[0]!.body.playbackSessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('aba oculta e saída da página enviam a posição na hora', async ({ page }) => {
    const calls = await stub(page);
    await open(page);
    await player(page).getByRole('button', { name: 'Ir a 89%' }).click();
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    const before = calls.length;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => calls.length).toBeGreaterThan(before);
    const afterHidden = calls.length;
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => calls.length).toBeGreaterThan(afterHidden);
  });

  test('mensagem de OUTRA origem ou de OUTRA janela é ignorada (origin e source)', async ({
    page,
  }) => {
    const calls = await stub(page, { autoAdvance: true });
    await open(page);
    // A mesma origem, mas vinda da própria janela (não do iframe): descartada.
    await page.evaluate(() =>
      window.postMessage({ source: 'fake-video', type: 'ended' }, window.location.origin),
    );
    // Do iframe certo, mas com origem forjada: descartada.
    await page.evaluate(() => {
      const frame = document.querySelector('iframe[title="Vídeo da aula"]') as HTMLIFrameElement;
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'fake-video', type: 'seeked', t: 590 },
          origin: 'https://evil.example',
          source: frame.contentWindow,
        }),
      );
    });
    await page.waitForTimeout(500);
    expect(calls).toHaveLength(0);
    await expect(page.getByText(/Próxima aula em/)).toHaveCount(0);
  });

  test('o servidor nega o acesso no meio: o aviso aparece e o player para de enviar', async ({
    page,
  }) => {
    const calls = await stub(page, {
      progress: () => ({
        status: 403,
        json: { error: { code: 'access_denied', reason: 'expired' } },
      }),
    });
    await open(page);
    await player(page).getByRole('button', { name: 'Ir a 89%' }).click();
    await expect(page.getByRole('alert')).toContainText('Seu acesso a esta aula mudou');
    const before = calls.length;
    await player(page).getByRole('button', { name: 'Ir a 90%' }).click();
    await page.waitForTimeout(300);
    expect(calls.length).toBe(before);
  });
});

test.describe('autoavanço', () => {
  test('desligado por padrão: o fim do vídeo NÃO avança nem conta', async ({ page }) => {
    await stub(page);
    await open(page);
    await player(page).getByRole('button', { name: 'Terminar' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText(/Próxima aula em/)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/aulas/${L(1)}$`));
  });

  test('ligado: contagem cancelável; sem cancelar, vai para a próxima aula (sem autoplay)', async ({
    page,
  }) => {
    await stub(page, { autoAdvance: true });
    await page.clock.install();
    await open(page);
    await player(page).getByRole('button', { name: 'Terminar' }).click();
    const countdown = page.getByRole('status').filter({ hasText: 'Próxima aula em 5 s' });
    await expect(countdown).toBeVisible();
    await expect(countdown).toContainText('Próxima aula de texto');
    await countdown.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText(/Próxima aula em/)).toHaveCount(0);
    await page.clock.runFor(8000);
    await expect(page).toHaveURL(new RegExp(`/aulas/${L(1)}$`));

    await player(page).getByRole('button', { name: 'Terminar' }).click();
    await expect(page.getByText('Próxima aula em 5 s')).toBeVisible();
    await page.clock.runFor(6000);
    await expect(page).toHaveURL(new RegExp(`/aulas/${L(2)}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Próxima aula de texto' }),
    ).toBeVisible();
  });

  test('provider SEM `ended` confiável: nunca avança sozinho, mesmo ligado; há o botão manual', async ({
    page,
  }) => {
    await stub(page, { autoAdvance: true, lesson: videoLesson({ provider: 'fake-no-ended' }) });
    await open(page);
    await player(page).getByRole('button', { name: 'Terminar' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText(/Próxima aula em/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Próxima aula' }).click();
    await expect(page).toHaveURL(new RegExp(`/aulas/${L(2)}$`));
  });
});

test.describe('prévia, provider sem adapter e acessibilidade', () => {
  test('prévia da Staff: o vídeo toca, mas NADA é enviado', async ({ page }) => {
    const calls = await stub(page, { lesson: videoLesson({ preview: true }) });
    await page.route('**/api/staff/preview/courses/*/lessons/*', (route) =>
      route.fulfill({ json: videoLesson({ preview: true }) }),
    );
    await page.route('**/api/me/access', (route) =>
      route.fulfill({
        json: { roles: ['student', 'support'], capabilities: ['staff.read'], recentAuth: false },
      }),
    );
    await page.goto(`/staff/previa/${COURSE_ID}/aulas/${L(1)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Aula em vídeo' })).toBeVisible();
    await expect(page.getByText('Na prévia o progresso não é gravado.').first()).toBeVisible();
    await expect(player(page).locator('#total')).toHaveText('600');
    await player(page).getByRole('button', { name: 'Ir a 90%' }).click();
    await player(page).getByRole('button', { name: 'Terminar' }).click();
    await page.waitForTimeout(500);
    expect(calls).toHaveLength(0);
  });

  test('provider sem adapter nesta build: aviso claro e NENHUM iframe', async ({ page }) => {
    await stub(page, { lesson: videoLesson({ provider: 'mux' }) });
    await page.goto(`/estudar/${COURSE_ID}/aulas/${L(1)}`);
    await expect(
      page.getByRole('status').filter({ hasText: 'ainda não está disponível' }),
    ).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe sem violações na aula de vídeo (${scheme}), com o iframe`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stub(page);
      await open(page);
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([]);
    });
  }
});
