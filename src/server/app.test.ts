import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app';
import worker from './index';

/**
 * Testes de comportamento do app no Node, sem workerd: o que importa aqui é o contrato HTTP, o
 * registro estruturado (evlog) e a redação. O Worker real é testado em test/workers.
 */
const unreachableDatabase = { connectionString: 'postgres://u:p@127.0.0.1:1/db' } as Hyperdrive;
const env = { HYPERDRIVE: unreachableDatabase } as Env;

let output: string[];
beforeEach(() => {
  output = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(capture);
  }
});
afterEach(() => vi.restoreAllMocks());

describe('health/ready com o banco indisponível', () => {
  it('responde 503 com releaseId e registra o erro num evento legível', async () => {
    const response = await createApp().request('/api/health/ready', {}, env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable', releaseId: 'dev' });
    const logged = output.join('\n');
    expect(logged).toContain('/api/health/ready');
    expect(logged).toMatch(/ECONNREFUSED|connect/i);
    expect(logged).toContain('"level":"error"');
  });
});

describe('rotas de identidade', () => {
  it('um caminho /api desconhecido responde 404 sem abrir o banco (não acorda o Neon)', async () => {
    const response = await createApp().request('/api/nada-por-aqui', {}, env);
    expect(response.status).toBe(404);
    expect(output.join('\n')).not.toMatch(/ECONNREFUSED/);
  });

  it('pedido de link inválido ou de origem errada responde 400/403 sem abrir o banco', async () => {
    const app = createApp();
    const send = (body: unknown, origin?: string) =>
      app.request(
        '/api/auth/link/request',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
          body: JSON.stringify(body),
        },
        { ...env, APP_BASE_URL: 'https://app.example.test' } as unknown as Env,
      );
    expect(
      (await send({ email: 'sem-arroba', captchaToken: 'x' }, 'https://app.example.test')).status,
    ).toBe(400);
    expect((await send({ email: 'a@b.co', captchaToken: 'x' })).status).toBe(403);
    expect(
      (await send({ email: 'a@b.co', captchaToken: 'x' }, 'https://evil.example')).status,
    ).toBe(403);
    expect(output.join('\n')).not.toMatch(/ECONNREFUSED/);
  });

  it('/api/me e /api/auth abrem o banco (e falham de forma controlada se ele cai)', async () => {
    const response = await createApp().request('/api/me', {}, env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'internal_error' } });
  });
});

describe('pelo ponto de entrada do Worker (index.ts)', () => {
  it('não grava e-mail, token, cookie nem Authorization que chegam na requisição', async () => {
    const request = new Request(
      'http://example.com/api/health/live?email=pessoa@example.com&token=TOKEN_SECRETO',
      {
        headers: {
          cookie: 'session=COOKIE_SECRETO',
          authorization: 'Bearer TOKEN_SECRETO',
          'x-request-id': 'forjado',
        },
      },
    );
    const context = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const response = await worker.fetch(
      request as Parameters<typeof worker.fetch>[0],
      env,
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).not.toBe('forjado');
    const logged = output.join('\n');
    expect(logged).toContain('/api/health/live');
    expect(logged).not.toMatch(/pessoa@|TOKEN_SECRETO|COOKIE_SECRETO|forjado/);
  });

  it('o id de correlação sai INTACTO no log, mesmo com sequências de dígitos que lembram telefone ou cartão', async () => {
    // Regressão (M3-05): a redação embutida de "telefone" do evlog mascarava pedaços de UUIDs como
    // este ("****4806-8066-..."), e o suporte não conseguia achar no log o id que o cliente recebeu.
    const ids = [
      '66e43a01-3341-4806-8066-3120b7241215',
      '12345678-1234-4806-8066-123456789012',
      '00000000-0000-4000-8000-000000000000',
      '2026-1012-4806-8066-1234567890ab',
    ];
    const context = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    for (const id of ids) {
      output.length = 0;
      const spy = vi
        .spyOn(crypto, 'randomUUID')
        .mockReturnValue(id as `${string}-${string}-${string}-${string}-${string}`);
      const response = await worker.fetch(
        new Request('http://example.com/api/health/live') as Parameters<typeof worker.fetch>[0],
        env,
        context,
      );
      spy.mockRestore();
      expect(response.headers.get('x-request-id')).toBe(id);
      expect(output.join('\n'), id).toContain(id);
    }
  });

  it('o e-mail na mensagem de um erro não chega ao registro nem à resposta', async () => {
    const app = createApp();
    app.get('/api/_boom', () => {
      throw new Error('Falha ao enviar link para pessoa@example.com');
    });
    const response = await app.request('/api/_boom', {}, env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'internal_error' } });
    const logged = output.join('\n');
    expect(logged).toContain('Falha ao enviar link');
    expect(logged).not.toContain('pessoa@example.com');
  });
});

describe('época do cliente (M8-01)', () => {
  const app = () => createApp();

  it('cliente com época antiga recebe 409 client_outdated em qualquer /api, sem abrir o banco', async () => {
    for (const path of ['/api/health/ready', '/api/me/profile', '/api/qualquer-coisa']) {
      const response = await app().request(path, { headers: { 'x-client-epoch': '0' } }, env);
      expect(response.status, path).toBe(409);
      expect(await response.json()).toEqual({ error: { code: 'client_outdated' } });
    }
    expect(output.join('\n')).not.toMatch(/ECONNREFUSED/);
  });

  it('a época atual e a ausência do cabeçalho passam adiante', async () => {
    const current = await app().request(
      '/api/nada-por-aqui',
      { headers: { 'x-client-epoch': '1' } },
      env,
    );
    expect(current.status).toBe(404);
    const none = await app().request('/api/nada-por-aqui', {}, env);
    expect(none.status).toBe(404);
  });
});
