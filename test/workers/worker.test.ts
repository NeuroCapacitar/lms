import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/**
 * Testes do Worker CONSTRUÍDO (dist/hub, gerado por `bun run build`) no workerd. O arquivo de teste
 * não importa código do projeto: tudo passa pelo `fetch` do Worker, como em produção.
 */
describe('Worker no workerd', () => {
  it('GET /api/health/live devolve 200 JSON', async () => {
    const response = await exports.default.fetch(new Request('http://example.com/api/health/live'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok', releaseId: expect.any(String) });
  });

  it('gera o id de correlação no servidor e ignora o x-request-id do cliente', async () => {
    const response = await exports.default.fetch(
      new Request('http://example.com/api/health/live', { headers: { 'x-request-id': 'forjado' } }),
    );
    const id = response.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe('forjado');
  });

  it('GET /api/nada devolve 404 JSON, nunca o HTML da SPA', async () => {
    const response = await exports.default.fetch(new Request('http://example.com/api/nada'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found' } });
  });

  it('o binding Hyperdrive alcança o Postgres de teste (health/ready)', async () => {
    const response = await exports.default.fetch(
      new Request('http://example.com/api/health/ready'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', releaseId: expect.any(String) });
  });
});
