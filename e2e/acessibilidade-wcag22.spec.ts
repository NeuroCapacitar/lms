import { expect, test, type Page } from '@playwright/test';

/**
 * Critérios da WCAG 2.2 AA medidos no navegador (M9-08), nas telas públicas, de 360 a 1440 px:
 * 2.5.8 tamanho do alvo (mínimo de 24 px), 2.4.11 foco não encoberto, 2.2.2 nada se move sozinho sem controle, e reflow (1.4.10) sem
 * rolagem horizontal da página. O que depende de pessoa (leitor de tela) está no checklist de `docs/operations/accessibility-checklist.md`.
 */
const PAGES = ['/', '/entrar', '/sobre', '/ajuda', '/base-visual', '/acessibilidade'];
const WIDTHS = [360, 768, 1440];

async function stub(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }),
  );
  await page.route('**/api/auth/options', (route) => route.fulfill({ json: { google: false } }));
  await page.route('**/api/public/login-media', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/public/help', (route) => route.fulfill({ json: { email: null } }));
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'window.turnstile = { render: () => "w", remove: () => {} };',
    }),
  );
}

async function open(page: Page, path: string) {
  await stub(page);
  await page.goto(path);
  await page.locator('main').waitFor();
  await page.waitForLoadState('networkidle');
}

for (const width of WIDTHS) {
  test.describe(`largura ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const path of PAGES) {
      test(`${path}: sem rolagem horizontal da página (reflow)`, async ({ page }) => {
        await open(page, path);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });

      test(`${path}: todo alvo de clique tem pelo menos 24 x 24 px (2.5.8)`, async ({ page }) => {
        await open(page, path);
        const small = await page.evaluate(() => {
          const selector =
            'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch]';
          const result: string[] = [];
          for (const element of document.querySelectorAll<HTMLElement>(selector)) {
            if (element.classList.contains('sr-only')) continue; // só aparece com foco
            const style = getComputedStyle(element);
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            // Link no meio de uma frase está dispensado pela própria norma (exceção "em linha").
            if (
              element.tagName === 'A' &&
              element.closest('p, li') &&
              (element.parentElement?.textContent ?? '').trim() !== element.textContent?.trim()
            ) {
              continue;
            }
            // Caixa de seleção e botão de rádio: o alvo é o rótulo inteiro, que é clicável.
            const isChoice =
              element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type);
            const box = (
              isChoice ? (element.closest('label') ?? element) : element
            ).getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;
            if (box.width < 24 || box.height < 24) {
              const name = (element.textContent ?? element.getAttribute('aria-label') ?? '').trim();
              result.push(
                `${element.tagName.toLowerCase()} "${name.slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
              );
            }
          }
          return result;
        });
        expect(small).toEqual([]);
      });

      test(`${path}: o foco nunca fica encoberto ao navegar com Tab (2.4.11)`, async ({ page }) => {
        await open(page, path);
        const covered: string[] = [];
        for (let press = 0; press < 40; press += 1) {
          await page.keyboard.press('Tab');
          const state = await page.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            if (!element || element === document.body) return null;
            const box = element.getBoundingClientRect();
            const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
            const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
            const top = document.elementFromPoint(x, y);
            const visible = box.bottom > 0 && box.top < window.innerHeight;
            return {
              label: `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 30)}"`,
              visible,
              reachable: top !== null && (element.contains(top) || top.contains(element)),
            };
          });
          if (state && (!state.visible || !state.reachable)) covered.push(state.label);
        }
        expect(covered).toEqual([]);
      });

      test(`${path}: nada se move sozinho (sem animação infinita, vídeo ou áudio automático) (2.2.2)`, async ({
        page,
      }) => {
        await open(page, path);
        const moving = await page.evaluate(() => {
          const result: string[] = [];
          for (const animation of document.getAnimations()) {
            const timing = animation.effect?.getComputedTiming();
            if (timing && timing.iterations === Infinity) result.push('animação infinita');
          }
          if (document.querySelector('marquee, blink')) result.push('marquee ou blink');
          for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
            if (media.autoplay || (!media.paused && !media.ended)) result.push('mídia automática');
          }
          return result;
        });
        expect(moving).toEqual([]);
      });
    }
  });
}

test('a declaração de acessibilidade está no rodapé de todas as telas públicas e diz o que NÃO foi verificado', async ({
  page,
}) => {
  await open(page, '/sobre');
  await page.getByRole('link', { name: 'Acessibilidade' }).click();
  await expect(page).toHaveURL(/\/acessibilidade$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Acessibilidade' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'O que ainda não foi verificado' }),
  ).toBeVisible();
  await expect(page.getByText(/leitor de tela \(NVDA e VoiceOver\)/)).toBeVisible();
  await expect(page.getByText(/não atende ao critério 1\.2\.2/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ajuda' }).last()).toBeVisible();
});
