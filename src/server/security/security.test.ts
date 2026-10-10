import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { csrfProtection } from './csrf';
import { API_SECURITY_HEADERS, securityHeaders } from './headers';

const BASE = 'https://app.example.test';
const env = { APP_BASE_URL: BASE } as unknown as Env;

/** App mínimo: uma rota que ALTERA ESTADO (contador) para provar que a requisição recusada não chega nela. */
function build() {
  let mutations = 0;
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', securityHeaders());
  app.use('/api/*', csrfProtection());
  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    app[method]('/api/x', (c) => {
      mutations += 1;
      return c.json({ ok: true });
    });
  }
  app.get('/api/x', (c) => c.json({ ok: true }));
  return { app, mutations: () => mutations };
}

const send = (
  app: Hono<{ Bindings: Env }>,
  method: string,
  headers: Record<string, string>,
  body = '{}',
) => app.request('/api/x', { method, headers, body }, env);

describe('CSRF próprio', () => {
  it('mutação legítima (origem do app e JSON) passa, em todos os métodos', async () => {
    const { app, mutations } = build();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await send(app, method, {
        origin: BASE,
        'content-type': 'application/json',
      });
      expect(response.status, method).toBe(200);
    }
    expect(mutations()).toBe(4);
  });

  it('aceita application/json com parâmetros (charset) e em maiúsculas', async () => {
    const { app } = build();
    const ok = await send(app, 'POST', {
      origin: BASE,
      'content-type': 'Application/JSON; charset=utf-8',
    });
    expect(ok.status).toBe(200);
  });

  it('fetch entre origens com text/plain (requisição "simples" sem pré-verificação) é recusado', async () => {
    const { app, mutations } = build();
    const response = await send(app, 'POST', {
      origin: 'https://evil.example',
      'content-type': 'text/plain',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'csrf_rejected' } });
    expect(mutations()).toBe(0);
  });

  it('formulário cruzado (urlencoded e multipart) é recusado', async () => {
    const { app, mutations } = build();
    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const response = await send(app, 'POST', {
        origin: 'https://evil.example',
        'content-type': type,
      });
      expect(response.status, type).toBe(403);
    }
    expect(mutations()).toBe(0);
  });

  it('origem do app mas corpo que não é JSON: 415 (formulário da própria origem também não vale)', async () => {
    const { app, mutations } = build();
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', '']) {
      const response = await send(app, 'POST', {
        origin: BASE,
        ...(type ? { 'content-type': type } : {}),
      });
      expect(response.status, type || '(sem content-type)').toBe(415);
    }
    expect(mutations()).toBe(0);
  });

  it('Origin: null, origem parecida e origem com outra porta ou esquema são recusadas', async () => {
    const { app, mutations } = build();
    for (const origin of [
      'null',
      'https://app.example.test.evil.example',
      'http://app.example.test',
      'https://app.example.test:8443',
      'https://APP.example.test',
    ]) {
      const response = await send(app, 'POST', { origin, 'content-type': 'application/json' });
      expect(response.status, origin).toBe(403);
    }
    expect(mutations()).toBe(0);
  });

  it('sem Origin e sem Sec-Fetch-Site (cliente que não é navegador) é recusado', async () => {
    const { app, mutations } = build();
    const response = await send(app, 'POST', { 'content-type': 'application/json' });
    expect(response.status).toBe(403);
    expect(mutations()).toBe(0);
  });

  it('sem Origin, só Sec-Fetch-Site: same-origin vale; cross-site, same-site e none não', async () => {
    const { app } = build();
    const json = { 'content-type': 'application/json' };
    expect((await send(app, 'POST', { ...json, 'sec-fetch-site': 'same-origin' })).status).toBe(
      200,
    );
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect((await send(app, 'POST', { ...json, 'sec-fetch-site': site })).status, site).toBe(403);
    }
  });

  it('com Origin errado, Sec-Fetch-Site: same-origin NÃO compensa', async () => {
    const { app } = build();
    const response = await send(app, 'POST', {
      origin: 'https://evil.example',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    });
    expect(response.status).toBe(403);
  });

  it('GET e HEAD passam sem verificação (e nenhuma rota GET altera estado)', async () => {
    const { app, mutations } = build();
    expect((await app.request('/api/x', {}, env)).status).toBe(200);
    expect((await app.request('/api/x', { method: 'HEAD' }, env)).status).toBe(200);
    expect(mutations()).toBe(0);
  });
});

describe('cabeçalhos de segurança da API', () => {
  it('toda resposta da API leva os cabeçalhos, inclusive as recusadas e as 404', async () => {
    const { app } = build();
    const responses = [
      await app.request('/api/x', {}, env),
      await send(app, 'POST', { origin: 'https://evil.example', 'content-type': 'text/plain' }),
      await app.request('/api/nao-existe', {}, env),
    ];
    for (const response of responses) {
      for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
        expect(response.headers.get(name), `${name} em ${response.status}`).toBe(value);
      }
    }
  });

  it('a CSP da API é a mais fechada e a API nunca é cacheável', () => {
    expect(API_SECURITY_HEADERS['Content-Security-Policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(API_SECURITY_HEADERS['Cache-Control']).toBe('no-store');
    expect(API_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(API_SECURITY_HEADERS['Strict-Transport-Security']).not.toMatch(/includeSubDomains/i);
  });
});
