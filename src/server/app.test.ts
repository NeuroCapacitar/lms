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
