import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';

/**
 * M9-04, CORS: a API é do MESMO ORIGEM e nunca se abre a outro site. Não existe configuração de CORS: nenhuma resposta (nem a
 * recusada) traz `Access-Control-Allow-*`, e o pré-voo (OPTIONS) de outra origem não é atendido. Um middleware de CORS
 * acrescentado por engano derruba este teste.
 */
const SELF = 'https://app.example.test';
const env = {
  APP_BASE_URL: SELF,
  BETTER_AUTH_SECRET: 'segredo-de-teste-somente-local-0123456789abcdef',
  TURNSTILE_SECRET_KEY: 'x',
} as unknown as Env;
const app = () =>
  createApp({ auth: { emailSender: createFakeEmailSender(), isStaffEmail: async () => false } });
const corsHeaders = (response: Response) =>
  [...response.headers.keys()].filter((name) => name.toLowerCase().startsWith('access-control-'));

describe('CORS', () => {
  it('uma página de outro site não recebe permissão para ler a API (GET com Origin estranha)', async () => {
    for (const origin of ['https://evil.example', 'null', SELF]) {
      const response = await app().request('/api/health/live', { headers: { origin } }, env);
      expect(corsHeaders(response), `origin ${origin}`).toEqual([]);
    }
  });

  it('o pré-voo (OPTIONS) de outra origem não é atendido e não anuncia método, cabeçalho nem origem permitidos', async () => {
    for (const path of [
      '/api/me',
      '/api/me/checkout',
      '/api/staff/operations',
      '/api/webhooks/asaas',
    ]) {
      const response = await app().request(
        path,
        {
          method: 'OPTIONS',
          headers: {
            origin: 'https://evil.example',
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type',
          },
        },
        env,
      );
      expect([200, 204], path).not.toContain(response.status);
      expect(corsHeaders(response), path).toEqual([]);
    }
  });

  it('a recusa por Origin errada também não abre CORS', async () => {
    const response = await app().request(
      '/api/me/checkout',
      {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(corsHeaders(response)).toEqual([]);
  });
});
