import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker no workerd', () => {
  it('GET /api/health/live devolve 200 JSON', async () => {
    const res = await exports.default.fetch(new Request('http://example.com/api/health/live'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/nada devolve 404 JSON', async () => {
    const res = await exports.default.fetch(new Request('http://example.com/api/nada'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found' } });
  });

  it('roda em workerd (navigator.userAgent)', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers');
  });
});
