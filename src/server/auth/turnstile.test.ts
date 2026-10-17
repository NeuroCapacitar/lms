import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyTurnstile } from './turnstile';

const SECRET = 'segredo-de-teste-que-nao-pode-vazar';
const TOKEN = 'token-de-teste-que-nao-pode-vazar';

function respond(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

describe('verifyTurnstile', () => {
  it('aprova só quando a Cloudflare diz success: true', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      await verifyTurnstile({
        secret: SECRET,
        token: TOKEN,
        fetchImpl: respond({ success: true }),
      }),
    ).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('recusa e registra SÓ o motivo (códigos de erro), nunca o token nem o segredo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = await verifyTurnstile({
      secret: SECRET,
      token: TOKEN,
      ip: '203.0.113.9',
      fetchImpl: respond({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    });
    expect(ok).toBe(false);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      level: 'warn',
      source: 'turnstile',
      reason: 'rejected',
      errorCodes: ['timeout-or-duplicate'],
    });
    for (const secret of [SECRET, TOKEN, '203.0.113.9']) expect(line).not.toContain(secret);
  });

  it('erro HTTP e falha de rede fecham por padrão e dizem o motivo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      await verifyTurnstile({ secret: SECRET, token: TOKEN, fetchImpl: respond({}, 503) }),
    ).toBe(false);
    expect(
      await verifyTurnstile({
        secret: SECRET,
        token: TOKEN,
        fetchImpl: (async () => {
          throw new TypeError('rede');
        }) as typeof fetch,
      }),
    ).toBe(false);
    expect(warn.mock.calls.map((call) => JSON.parse(String(call[0])).reason)).toEqual([
      'http_503',
      'network_or_timeout',
    ]);
  });
});
