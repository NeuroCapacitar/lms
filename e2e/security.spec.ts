import { expect, test, type Page } from '@playwright/test';

const TOKEN = 'token-de-teste-com-mais-de-16-caracteres';
const PROFILE = {
  displayName: 'Maria',
  certificateName: null,
  certificateNameConfirmed: false,
  theme: 'system',
  autoAdvance: false,
};

async function stubExternal(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'window.turnstile = { render: (el, o) => { setTimeout(() => o.callback("t"), 0); return "w"; }, remove: () => {} };',
    }),
  );
  await page.route('**/api/me/profile', (route) => route.fulfill({ json: PROFILE }));
}

test.describe('cabeçalhos das páginas (public/_headers)', () => {
  for (const path of ['/', '/sobre', '/entrar', '/conta', '/base-visual']) {
    test(`${path}: CSP restrita, HSTS, nosniff, sem moldura`, async ({ page }) => {
      const response = await page.goto(path);
      const headers = response?.headers() ?? {};
      const csp = headers['content-security-policy'] ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
      expect(csp, 'sem script inline nem eval').not.toMatch(
        /script-src[^;]*'unsafe-(inline|eval)'/,
      );
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(headers['strict-transport-security']).toContain('max-age=31536000');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['permissions-policy']).toContain('camera=()');
    });
  }

  test('Referrer-Policy: padrão nas páginas comuns e UM valor só (no-referrer) em /entrar/confirmar', async ({
    page,
  }) => {
    const home = await page.goto('/');
    expect(home?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const confirm = await page.goto('/entrar/confirmar');
    expect(confirm?.headers()['referrer-policy']).toBe('no-referrer');
    expect(confirm?.headers()['cache-control']).toContain('no-store');
    // o CSP continua valendo nessa rota (os cabeçalhos de /* se somam aos de /entrar/*)
    expect(confirm?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  test('os arquivos em /assets são imutáveis (nome com hash)', async ({ page }) => {
    const css = await page.goto('/').then(async () => {
      const href = await page.locator('link[rel="stylesheet"]').first().getAttribute('href');
      return page.request.get(href ?? '/');
    });
    expect(css.headers()['cache-control']).toContain('immutable');
  });
});

test.describe('cabeçalhos e CSRF da API (Worker real)', () => {
  test('a API responde com CSP fechada, no-store e nosniff', async ({ request }) => {
    const response = await request.get('/api/health/live');
    const headers = response.headers();
    expect(headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['strict-transport-security']).toContain('max-age=31536000');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });

  test('POST sem Origin, com text/plain ou de origem estranha é recusado antes de qualquer rota', async ({
    request,
  }) => {
    // Sem corpo: o proxy do `vite preview` falha de forma intermitente quando a resposta chega antes
    // de o corpo ser lido (só no ambiente de teste local).
    const base = {};
    const noOrigin = await request.post('/api/auth/link/request', {
      ...base,
      headers: { 'content-type': 'application/json' },
    });
    expect(noOrigin.status()).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: { code: 'csrf_rejected' } });
    const foreign = await request.post('/api/auth/link/request', {
      ...base,
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
    });
    expect(foreign.status()).toBe(403);
    const wrongType = await request.post('/api/auth/link/request', {
      ...base,
      headers: { 'content-type': 'text/plain', origin: 'http://localhost:4173' },
    });
    expect([403, 415]).toContain(wrongType.status());
  });
});

test.describe('a CSP não é violada nas telas existentes', () => {
  const pages = [
    '/',
    '/sobre',
    '/base-visual',
    '/entrar',
    `/entrar/confirmar#token=${TOKEN}`,
    '/conta',
    '/cursos',
  ];
  for (const path of pages) {
    test(`${path.split('#')[0]}: nenhuma violação de CSP, com o widget e o Sentry simulados`, async ({
      page,
    }) => {
      const consoleViolations: string[] = [];
      page.on('console', (message) => {
        if (/content security policy/i.test(message.text())) consoleViolations.push(message.text());
      });
      await page.addInitScript(() => {
        (window as unknown as { __csp: string[] }).__csp = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          (window as unknown as { __csp: string[] }).__csp.push(
            `${event.violatedDirective} ${event.blockedURI}`,
          );
        });
      });
      await stubExternal(page);
      await page.goto(path);
      await page.locator('main').waitFor();
      await page.waitForTimeout(800);
      const violations = await page.evaluate(
        () => (window as unknown as { __csp: string[] }).__csp,
      );
      expect(violations, 'eventos securitypolicyviolation').toEqual([]);
      expect(consoleViolations, 'avisos de CSP no console').toEqual([]);
    });
  }
});
