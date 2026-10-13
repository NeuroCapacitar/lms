import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/**
 * M4-07 no workerd, contra o Worker CONSTRUÍDO: o webhook do Resend responde sem sessão e sem Origin (fica
 * fora do CSRF) e recusa o que não tem assinatura válida ANTES de tocar no banco. Só caminhos sem banco.
 */
const post = (body: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(
    new Request('http://example.com/api/webhooks/resend', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    }),
  );

describe('POST /api/webhooks/resend (Worker construído)', () => {
  it('sem assinatura: 400 invalid_signature (e não 403 do CSRF: a rota está fora dele)', async () => {
    const response = await post('{"type":"email.delivered","data":{"email_id":"x"}}');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_signature' } });
  });

  it('assinatura forjada e carimbo antigo: 400', async () => {
    const response = await post('{"type":"email.delivered","data":{"email_id":"x"}}', {
      'svix-id': 'msg_forjado',
      'svix-timestamp': '1',
      'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    expect(response.status).toBe(400);
  });

  it('corpo gigante: 413 antes de verificar', async () => {
    const response = await post(`{"lixo":"${'x'.repeat(70_000)}"}`);
    expect(response.status).toBe(413);
  });

  it('GET não existe (404 em JSON)', async () => {
    const response = await exports.default.fetch(
      new Request('http://example.com/api/webhooks/resend'),
    );
    expect(response.status).toBe(404);
  });
});
